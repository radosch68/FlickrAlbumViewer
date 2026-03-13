#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

function readAppConfig() {
  const cfgPath = path.resolve(__dirname, '..', 'app-config.js');
  try {
    const txt = fs.readFileSync(cfgPath, 'utf8');
    const keyMatch = txt.match(/flickrApiKey:\s*["']([^"']+)["']/);
    const userMatch = txt.match(/userId:\s*["']([^"']+)["']/);
    const defaultMatch = txt.match(/defaultAlbumName:\s*["']([^"']+)["']/);
    const baseMatch = txt.match(/flickrApiBaseUrl:\s*["']([^"']+)["']/);
    return {
      flickrApiKey: keyMatch ? keyMatch[1] : null,
      userId: userMatch ? userMatch[1] : null,
      defaultAlbumName: defaultMatch ? defaultMatch[1] : null,
      flickrApiBaseUrl: baseMatch ? baseMatch[1] : 'https://www.flickr.com/services/rest/'
    };
  } catch (e) {
    return {};
  }
}

function buildUrl(base, method, apiKey, params = {}) {
  const url = new URL(base);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('nojsoncallback', '1');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function resolveAlbumByName(base, apiKey, userId, albumName) {
  const payload = await fetchJson(buildUrl(base, 'flickr.photosets.getList', apiKey, { user_id: userId }));
  const photosets = payload.photosets?.photoset || [];
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  const matched = photosets.find((ps) => norm(ps.title?._content || ps.title) === norm(albumName));
  if (!matched) throw new Error('Album not found: ' + albumName);
  return { id: matched.id, title: matched.title?._content || matched.title };
}

async function fetchRepresentativePhoto(base, apiKey, userId, photosetId) {
  // Request a range of size urls and their widths/heights so we can pick the best <=1024px
  const sizeKeys = ['o','k','h','l','b','c','z','n','m'];
  const extras = [];
  sizeKeys.forEach((k) => {
    extras.push(`url_${k}`);
    extras.push(`width_${k}`);
    extras.push(`height_${k}`);
  });
  const payload = await fetchJson(buildUrl(base, 'flickr.photosets.getPhotos', apiKey, { user_id: userId, photoset_id: photosetId, per_page: 1, extras: extras.join(',') }));
  const photo = payload.photoset?.photo?.[0];
  if (!photo) return null;

  // Build candidate list of available sizes
  const candidates = [];
  sizeKeys.forEach((k) => {
    const url = photo[`url_${k}`];
    const w = photo[`width_${k}`] ? parseInt(photo[`width_${k}`], 10) : null;
    const h = photo[`height_${k}`] ? parseInt(photo[`height_${k}`], 10) : null;
    if (url) candidates.push({ key: k, url, width: w, height: h });
  });

  if (candidates.length === 0) return null;

  // Prefer the largest image with width <= 1024. If none, pick the smallest available.
  const underOrEqual = candidates.filter((c) => c.width && c.width <= 1024);
  let chosen;
  if (underOrEqual.length) {
    chosen = underOrEqual.reduce((a, b) => ( (a.width || 0) > (b.width || 0) ? a : b ));
  } else {
    // Fallback: choose the smallest width available
    chosen = candidates.reduce((a, b) => ((a.width || Infinity) < (b.width || Infinity) ? a : b));
  }

  return { url: chosen.url, width: chosen.width || null, height: chosen.height || null };
}

function slugifyFilename(s) {
  return String(s || '').replace(/[^a-z0-9-_]/gi, '-').replace(/-+/g, '-').toLowerCase();
}

function renderShareHtml({ title, description, image, imageWidth, imageHeight, url, shareUrl }) {
  const img = image || 'https://via.placeholder.com/1200x630?text=Album+Preview';
  const desc = description || '';
  const ogUrl = shareUrl || url;
  const w = imageWidth;
  const h = imageHeight;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(desc)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(ogUrl)}" />
    <meta property="og:image" content="${escapeHtml(img)}" />
    ${w ? `<meta property="og:image:width" content="${escapeHtml(String(w))}" />` : ''}
    ${h ? `<meta property="og:image:height" content="${escapeHtml(String(h))}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeHtml(img)}" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}" />
    <script>window.location.replace('${escapeJs(url)}');</script>
  </head>
  <body>
    <p>Redirecting to <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
  </body>
</html>`;
}

function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escapeJs(s) { return String(s || '').replace(/'/g, "\\'"); }

async function main() {
  const cfg = readAppConfig();
  const argv = process.argv.slice(2);
  const args = {};
  argv.forEach((a, i) => { if (a.startsWith('--')) args[a.replace(/^--/, '')] = argv[i+1]; });

  const apiKey = process.env.FLICKR_API_KEY || cfg.flickrApiKey;
  const userId = process.env.FLICKR_USER_ID || cfg.userId;
  const base = cfg.flickrApiBaseUrl || 'https://www.flickr.com/services/rest/';

  if (!apiKey || !userId) {
    console.error('Missing Flickr API key or userId. Set FLICKR_API_KEY/FLICKR_USER_ID or update app-config.js');
    process.exit(2);
  }

  let albumId = args.albumId || '';
  let albumName = args.albumName || args.album || '';
  if (!albumId && !albumName) {
    albumName = cfg.defaultAlbumName || '';
  }

  try {
    let title = albumName || 'Album';
    if (!albumId) {
      const resolved = await resolveAlbumByName(base, apiKey, userId, albumName);
      albumId = resolved.id;
      title = resolved.title || title;
    }

    const photo = await fetchRepresentativePhoto(base, apiKey, userId, albumId);
    const siteBaseRaw = process.env.SITE_BASE || cfg.siteBase || 'https://radosch68.github.io/FlickrAlbumViewer';
    const siteBase = String(siteBaseRaw).replace(/\/$/, '');
    const shareUrl = `${siteBase}/share/album-${slugifyFilename(albumId)}.html`;
    // Use a relative redirect from the share page into the site root (keeps OG absolute)
    const targetAppUrl = `../?albumId=${encodeURIComponent(albumId)}`;
    const html = renderShareHtml({ title, description: '', image: photo?.url, imageWidth: photo?.width, imageHeight: photo?.height, url: targetAppUrl, shareUrl });

    const outDir = path.resolve(process.cwd(), 'share');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `album-${slugifyFilename(albumId)}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log('Wrote', outPath);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

if (require.main === module) main();
