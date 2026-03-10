/* Albums list page script */
(function () {
  const config = window.APP_CONFIG || {};
  const PHOTO_URL_EXTRAS = ["url_q", "url_m", "url_n"];

  function setStateMessage(msg) {
    const p = document.getElementById("albums-loading");
    if (p) p.textContent = msg;
  }

  async function fetchWithRetries(method, params = {}, maxRetries = 3) {
    let attempt = 0;
    let lastError = null;
    const base = (config.flickrApiBaseUrl && String(config.flickrApiBaseUrl).trim()) || "https://www.flickr.com/services/rest/";

    while (attempt <= maxRetries) {
      attempt++;
      try {
        const endpoint = new URL(base);
        endpoint.searchParams.set("method", method);
        endpoint.searchParams.set("api_key", config.flickrApiKey);
        endpoint.searchParams.set("format", "json");
        endpoint.searchParams.set("nojsoncallback", "1");
        Object.entries(params).forEach(([k, v]) => endpoint.searchParams.set(k, v));

        if (attempt > 1) {
          setStateMessage(`Network error, retrying (${attempt}/${maxRetries})...`);
        }

        const res = await fetch(endpoint.toString(), { method: "GET" });
        if (!res.ok) throw new Error(`Request failed ${res.status}`);
        const payload = await res.json();
        if (payload.stat !== "ok") throw new Error(payload.message || "API error");
        setStateMessage("Loading albums...");
        return payload;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt > maxRetries) break;
        const delay = Math.min(8000, 500 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 300);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError || new Error("Unknown network error");
  }

  function pickBestUrl(photo, keys) {
    for (const k of keys) {
      if (photo[k]) return photo[k];
    }
    return null;
  }

  function renderAlbums(albums) {
    const container = document.getElementById("albums-list");
    const state = document.getElementById("albums-state");
    if (state) state.classList.add("hidden");
    if (!container) return;
    container.classList.remove("hidden");
    container.innerHTML = "";

    // render as a thumbnail table: rows of cells containing thumb + title
    const columns = (() => {
      const w = window.innerWidth;
      if (w >= 1200) return 5;
      if (w >= 900) return 4;
      if (w >= 600) return 3;
      return 2;
    })();

    const table = document.createElement("table");
    table.className = "albums-thumb-table";
    const tbody = document.createElement("tbody");

    for (let i = 0; i < albums.length; i += columns) {
      const tr = document.createElement("tr");
      for (let c = 0; c < columns; c++) {
        const idx = i + c;
        const td = document.createElement("td");
        if (idx >= albums.length) {
          td.className = "empty-cell";
          tr.appendChild(td);
          continue;
        }

        const a = albums[idx];
        const link = document.createElement("a");
        link.href = `../index.html?albumId=${encodeURIComponent(a.id)}&fromAlbums=1`;
        link.className = "thumb-cell";

        const img = document.createElement("img");
        img.src = a.thumb;
        img.alt = a.title;
        img.loading = "lazy";
        img.className = "thumb-image";

        const caption = document.createElement("div");
        caption.className = "thumb-caption";
        caption.textContent = a.title;

        link.appendChild(img);
        link.appendChild(caption);
        td.appendChild(link);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    container.appendChild(table);
  }

  async function loadAlbums() {
    try {
      setStateMessage("Loading albums...");
      const listPayload = await fetchWithRetries("flickr.photosets.getList", { user_id: config.userId });
      const photosets = listPayload.photosets?.photoset || [];

      // Fetch one thumbnail for each album (primary photo) and require it
      const albumPromises = photosets.map(async (set) => {
        try {
          const photosPayload = await fetchWithRetries("flickr.photosets.getPhotos", {
            user_id: config.userId,
            photoset_id: set.id,
            per_page: 1,
            extras: PHOTO_URL_EXTRAS.join(","),
          });

          const photo = photosPayload.photoset?.photo?.[0] || null;
          const thumb = photo ? pickBestUrl(photo, PHOTO_URL_EXTRAS) : null;
          if (!thumb) return null; // thumbnail mandatory

          return {
            id: set.id,
            title: typeof set.title === "string" ? set.title : set.title?._content || "Untitled",
            thumb,
            count: Number(set.photos) || (photosPayload.photoset?.total ? Number(photosPayload.photoset.total) : 0),
          };
        } catch {
          return null;
        }
      });

      const albums = (await Promise.all(albumPromises)).filter(Boolean);
      if (!albums.length) {
        setStateMessage("No albums with public thumbnails were found.");
        return;
      }

      renderAlbums(albums);
    } catch (err) {
      setStateMessage(err?.message || "Failed to load albums.");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadAlbums();
  });
})();
