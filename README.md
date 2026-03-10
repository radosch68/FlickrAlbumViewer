# Flickr Album Viewer

Mobile-friendly static web app for viewing a public Flickr album without Flickr's default album UI friction.

## Viewer experience

- Theatre layout by default: selected photo fills the main area.
- Filmstrip placement is responsive:
   - Portrait screens: filmstrip at the bottom.
   - Landscape screens: filmstrip on the right side.
- Navigation options:
   - Arrow keys (left/right)
   - Swipe left/right on the main preview
   - On-screen previous/next buttons
   - Tap/click thumbnails in the filmstrip
- Filmstrip size is adjustable with the slider in the header; thumbnail size follows automatically.

## Project files

- `index.html` – app shell
- `styles.css` – responsive theatre/filmstrip layout
- `app-config.js` – Flickr API key + album identifiers
- `app.js` – Flickr fetch, rendering, and theatre interactions
 - `albums/index.html` + `albums/albums.js` – hidden albums browser (see below)

## Configuration

Edit `app-config.js` and replace the placeholder values:

- `flickrApiKey`
- `userId` (NSID)
- `defaultAlbumName` (fallback album title when URL parameter is not provided)

New/advanced configuration options (added):

- `flickrApiBaseUrl` (optional) — override the Flickr REST endpoint. Default: `https://www.flickr.com/services/rest/`.
- `maxRetries` (optional) — number of retry attempts on network/API failures. Default: `3`.


You can find your NSID from Flickr URLs/tools:
- Photo page URLs include owner NSID context.

## Select album by URL

Album selection precedence:

1. `albumId` (direct Flickr album ID)
2. `album` (album title lookup)
3. `defaultAlbumName` in `app-config.js`

If `albumId` is provided, it is used directly.
If `albumId` is missing, the app resolves album title to album ID automatically.

Use this URL format:

`https://radosch68.github.io/FlickrAlbumViewer/?albumId=<FLICKR_ALBUM_ID>`

or

`https://radosch68.github.io/FlickrAlbumViewer/?album=Your%20Album%20Name`

Examples:
- `https://radosch68.github.io/FlickrAlbumViewer/?albumId=72177720312345678`
- `https://radosch68.github.io/FlickrAlbumViewer/?album=Summer%20Trip%202025`
- `https://radosch68.github.io/FlickrAlbumViewer/?album=Family`

If `album` is not provided, `defaultAlbumName` from `app-config.js` is used.

Hidden albums browser

- Add `/albums` to the site path to open a hidden, minimal albums browser: `/albums`.
- The albums page lists public photosets (albums) for the configured `userId`. Each entry shows a thumbnail and title; clicking one redirects to `index.html?albumId=<ID>&fromAlbums=1`.
- When opened via the albums browser, the viewer shows a back button (left of the album title) to return to `/albums`.

Progressive loading

- The albums page shows placeholder cells immediately and progressively fills thumbnails as the app fetches each album's primary photo. This improves perceived load time for users with many albums.

## Run locally

Start a simple static server from the project root and open the app in a browser (recommended):

```bash
# from project root
python3 -m http.server 8000
```

Open in your browser:
- Viewer: `http://localhost:8000/index.html` (or `/?albumId=...`)
- Albums browser: `http://localhost:8000/albums`

When updating config or code, do a hard-refresh (Cmd+Shift+R) to ensure the browser loads the latest assets.

## Deploy to GitHub Pages

1. Push your branch and merge to `main`:

```bash
git add .
git commit -m "Initial Flickr album viewer"
git push -u origin InitialVersion
```

2. Open a PR from `InitialVersion` to `main` and merge.

3. In GitHub repo settings, enable Pages:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/ (root)`

4. Your site URL:

`https://radosch68.github.io/FlickrAlbumViewer/`

## Notes

- This app is designed for **public photos only**.
- Client-side API key is visible in browser source, which is acceptable for this read-only public use case.

Other notes

- The app exposes a small version badge in the UI (`meta[name="app-html-version"]`) to help confirm which HTML/assets the browser has loaded.
- Network errors use a small retry/backoff strategy controlled by `maxRetries` in `app-config.js`.
