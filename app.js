const config = window.APP_CONFIG || {};
const PHOTO_URL_EXTRAS = [
  "url_q",
  "url_t",
  "url_s",
  "url_m",
  "url_n",
  "url_z",
  "url_c",
  "url_l",
  "url_h",
  "url_k",
  "url_o",
];

const appState = {
  photos: [],
  albumTitle: "",
  selectedIndex: -1,
};

const elements = {
  albumTitle: document.getElementById("album-title"),
  photoCount: document.getElementById("photo-count"),
  loadingState: document.getElementById("loading-state"),
  errorState: document.getElementById("error-state"),
  errorMessage: document.getElementById("error-message"),
  retryButton: document.getElementById("retry-button"),
  emptyState: document.getElementById("empty-state"),
  galleryGrid: document.getElementById("gallery-grid"),
  lightbox: document.getElementById("lightbox"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxCaption: document.getElementById("lightbox-caption"),
  lightboxCounter: document.getElementById("lightbox-counter"),
  closeLightbox: document.getElementById("close-lightbox"),
  prevPhoto: document.getElementById("prev-photo"),
  nextPhoto: document.getElementById("next-photo"),
  flickrLink: document.getElementById("lightbox-flickr-link"),
};

let touchStartX = null;
let previouslyFocusedElement = null;
let eventsBound = false;

function validateConfig() {
  const requiredKeys = ["flickrApiKey", "userId"];
  const missing = requiredKeys.filter((key) => {
    const value = config[key];
    return !value || String(value).startsWith("REPLACE_WITH");
  });

  if (missing.length > 0) {
    showError("Update app-config.js with your Flickr API key and user ID before loading photos.");
    return false;
  }

  return true;
}

function normalizeAlbumName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function getAlbumSelection() {
  const params = new URLSearchParams(window.location.search);
  const albumIdFromUrl = params.get("albumId");
  const albumFromUrl = params.get("album");

  if (albumIdFromUrl && albumIdFromUrl.trim()) {
    return {
      albumId: albumIdFromUrl.trim(),
      albumName: albumFromUrl ? albumFromUrl.trim() : "",
    };
  }

  if (albumFromUrl && albumFromUrl.trim()) {
    return {
      albumId: "",
      albumName: albumFromUrl.trim(),
    };
  }

  if (config.defaultAlbumName && !String(config.defaultAlbumName).startsWith("REPLACE_WITH")) {
    return {
      albumId: "",
      albumName: String(config.defaultAlbumName).trim(),
    };
  }

  return {
    albumId: "",
    albumName: "",
  };
}

async function callFlickrApi(method, params = {}) {
  const endpoint = new URL("https://www.flickr.com/services/rest/");
  endpoint.searchParams.set("method", method);
  endpoint.searchParams.set("api_key", config.flickrApiKey);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("nojsoncallback", "1");

  Object.entries(params).forEach(([key, value]) => {
    endpoint.searchParams.set(key, value);
  });

  const response = await fetch(endpoint, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Flickr request failed with ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.stat !== "ok") {
    const reason = payload.message || "Unknown Flickr API error.";
    throw new Error(reason);
  }

  return payload;
}

function extractPhotosetTitle(photoset) {
  if (typeof photoset?.title === "string") {
    return photoset.title;
  }

  if (typeof photoset?.title?._content === "string") {
    return photoset.title._content;
  }

  return "Untitled Album";
}

async function resolveAlbumByName(albumName) {
  if (!albumName) {
    throw new Error(
      "No album selected. Add ?album=Your%20Album%20Name in the URL or set defaultAlbumName in app-config.js."
    );
  }

  const payload = await callFlickrApi("flickr.photosets.getList", {
    user_id: config.userId,
  });

  const photosets = payload.photosets?.photoset;
  if (!Array.isArray(photosets) || photosets.length === 0) {
    throw new Error("No public albums were found for this Flickr user.");
  }

  const target = normalizeAlbumName(albumName);
  const matched = photosets.find((set) => normalizeAlbumName(extractPhotosetTitle(set)) === target);

  if (!matched) {
    throw new Error(`Album '${albumName}' was not found. Check the URL parameter exactly.`);
  }

  return {
    id: matched.id,
    title: extractPhotosetTitle(matched),
  };
}

function setViewState(state) {
  const states = [elements.loadingState, elements.errorState, elements.emptyState, elements.galleryGrid];
  states.forEach((node) => node.classList.add("hidden"));

  if (state === "loading") {
    elements.loadingState.classList.remove("hidden");
  } else if (state === "error") {
    elements.errorState.classList.remove("hidden");
  } else if (state === "empty") {
    elements.emptyState.classList.remove("hidden");
  } else {
    elements.galleryGrid.classList.remove("hidden");
  }
}

function showError(message) {
  elements.errorMessage.textContent = message;
  setViewState("error");
}

function getPhotoPageUrl(ownerNsid, photoId) {
  return `https://www.flickr.com/photos/${ownerNsid}/${photoId}`;
}

function pickBestUrl(photo, preferredKeys) {
  for (const key of preferredKeys) {
    const value = photo[key];
    if (value) {
      return value;
    }
  }
  return null;
}

function mapPhoto(photo, ownerNsid) {
  const thumbUrl = pickBestUrl(photo, ["url_z", "url_n", "url_m", "url_q", "url_s", "url_t"]);
  const displayUrl = pickBestUrl(photo, ["url_k", "url_h", "url_o", "url_l", "url_c", "url_z", "url_n", "url_m", "url_q"]);
  const fullUrl = pickBestUrl(photo, ["url_o", "url_k", "url_h", "url_l", "url_c", "url_z", "url_n", "url_m"]);

  return {
    id: photo.id,
    title: photo.title?.trim() || "Untitled",
    thumbUrl: thumbUrl || displayUrl,
    displayUrl,
    fullUrl: fullUrl || displayUrl,
    flickrUrl: getPhotoPageUrl(ownerNsid, photo.id),
  };
}

async function fetchAlbumPhotos(photosetId) {
  const payload = await callFlickrApi("flickr.photosets.getPhotos", {
    user_id: config.userId,
    photoset_id: photosetId,
    extras: PHOTO_URL_EXTRAS.join(","),
  });

  if (!payload.photoset || !Array.isArray(payload.photoset.photo)) {
    throw new Error("Album response did not contain valid photo data.");
  }

  const ownerNsid = payload.photoset.owner;
  const mappedPhotos = payload.photoset.photo
    .map((photo) => mapPhoto(photo, ownerNsid))
    .filter((photo) => photo.thumbUrl && photo.displayUrl);

  return {
    albumTitle: payload.photoset.title || config.albumTitleFallback || "Flickr Album",
    photos: mappedPhotos,
  };
}

function renderGallery(photos) {
  elements.galleryGrid.innerHTML = "";

  photos.forEach((photo, index) => {
    const tile = document.createElement("button");
    tile.className = "photo-tile";
    tile.type = "button";
    tile.setAttribute("aria-label", `Open photo ${index + 1}: ${photo.title}`);

    const img = document.createElement("img");
    img.src = photo.thumbUrl;
    img.alt = photo.title;
    img.loading = "lazy";
    img.decoding = "async";

    tile.appendChild(img);
    tile.addEventListener("click", () => openLightbox(index, tile));

    elements.galleryGrid.appendChild(tile);
  });
}

function updateLightbox() {
  const photo = appState.photos[appState.selectedIndex];
  if (!photo) {
    return;
  }

  elements.lightboxImage.src = photo.displayUrl;
  elements.lightboxImage.alt = photo.title;
  elements.lightboxCaption.textContent = photo.title;
  elements.lightboxCounter.textContent = `${appState.selectedIndex + 1} / ${appState.photos.length}`;
  elements.flickrLink.href = photo.flickrUrl;

  const prevIndex = appState.selectedIndex - 1;
  const nextIndex = appState.selectedIndex + 1;

  if (appState.photos[prevIndex]) {
    const preloadPrev = new Image();
    preloadPrev.src = appState.photos[prevIndex].displayUrl;
  }

  if (appState.photos[nextIndex]) {
    const preloadNext = new Image();
    preloadNext.src = appState.photos[nextIndex].displayUrl;
  }
}

function openLightbox(index, triggerElement) {
  appState.selectedIndex = index;
  previouslyFocusedElement = triggerElement || document.activeElement;
  updateLightbox();
  elements.lightbox.classList.remove("hidden");
  document.body.classList.add("no-scroll");
  elements.closeLightbox.focus();
}

function closeLightbox() {
  elements.lightbox.classList.add("hidden");
  elements.lightboxImage.src = "";
  document.body.classList.remove("no-scroll");

  if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === "function") {
    previouslyFocusedElement.focus();
  }
}

function showNext() {
  if (!appState.photos.length) {
    return;
  }
  appState.selectedIndex = (appState.selectedIndex + 1) % appState.photos.length;
  updateLightbox();
}

function showPrev() {
  if (!appState.photos.length) {
    return;
  }
  appState.selectedIndex =
    (appState.selectedIndex - 1 + appState.photos.length) % appState.photos.length;
  updateLightbox();
}

function handleKeyDown(event) {
  const lightboxVisible = !elements.lightbox.classList.contains("hidden");
  if (!lightboxVisible) {
    return;
  }

  if (event.key === "Escape") {
    closeLightbox();
  } else if (event.key === "ArrowRight") {
    showNext();
  } else if (event.key === "ArrowLeft") {
    showPrev();
  }
}

function handleTouchStart(event) {
  touchStartX = event.changedTouches[0].screenX;
}

function handleTouchEnd(event) {
  if (touchStartX === null) {
    return;
  }

  const deltaX = event.changedTouches[0].screenX - touchStartX;
  const threshold = 50;

  if (deltaX > threshold) {
    showPrev();
  } else if (deltaX < -threshold) {
    showNext();
  }

  touchStartX = null;
}

async function initializeApp() {
  if (!eventsBound) {
    elements.retryButton.addEventListener("click", initializeApp);
    elements.closeLightbox.addEventListener("click", closeLightbox);
    elements.nextPhoto.addEventListener("click", showNext);
    elements.prevPhoto.addEventListener("click", showPrev);
    document.addEventListener("keydown", handleKeyDown);
    elements.lightbox.addEventListener("click", (event) => {
      if (event.target === elements.lightbox) {
        closeLightbox();
      }
    });
    elements.lightbox.addEventListener("touchstart", handleTouchStart, { passive: true });
    elements.lightbox.addEventListener("touchend", handleTouchEnd, { passive: true });
    eventsBound = true;
  }

  if (!validateConfig()) {
    return;
  }

  setViewState("loading");

  try {
    const selection = getAlbumSelection();
    let selectedAlbum;

    if (selection.albumId) {
      selectedAlbum = {
        id: selection.albumId,
        title: selection.albumName || config.albumTitleFallback || "Flickr Album",
      };
    } else {
      selectedAlbum = await resolveAlbumByName(selection.albumName);
    }

    const result = await fetchAlbumPhotos(selectedAlbum.id);
    appState.albumTitle = result.albumTitle || selectedAlbum.title;
    appState.photos = result.photos;

    elements.albumTitle.textContent = appState.albumTitle;
    elements.photoCount.textContent = `${appState.photos.length} photos`;

    if (!appState.photos.length) {
      setViewState("empty");
      return;
    }

    renderGallery(appState.photos);
    setViewState("gallery");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error loading album.";
    showError(message);
  }
}

initializeApp();
