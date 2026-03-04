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

## Configuration

Edit `app-config.js` and replace the placeholder values:

- `flickrApiKey`
- `userId` (NSID)
- `defaultAlbumName` (fallback album title when URL parameter is not provided)

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

## Run locally

Open `index.html` in a browser.

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
