const config = window.APP_CONFIG || {};
const JS_VERSION = "2026.03.04.10";
const STRIP_SIZE_STORAGE_KEY = "flickrFilmstripSize";
const DOUBLE_TAP_MS = 420;
const DOUBLE_TAP_MOVE_PX = 40;
const MIN_STRIP_SIZE = 92;
const MAX_STRIP_SIZE = 260;
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
  selectedIndex: 0,
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  albumTitle: document.getElementById("album-title"),
  photoCount: document.getElementById("photo-count"),
  loadingState: document.getElementById("loading-state"),
  errorState: document.getElementById("error-state"),
  errorMessage: document.getElementById("error-message"),
  retryButton: document.getElementById("retry-button"),
  emptyState: document.getElementById("empty-state"),
  theatreView: document.getElementById("theatre-view"),
  filmstripResizer: document.getElementById("filmstrip-resizer"),
  previewPane: document.getElementById("preview-pane"),
  previewMedia: document.querySelector(".preview-media"),
  previewFullscreenToggle: document.getElementById("preview-fullscreen-toggle"),
  previewImage: document.getElementById("preview-image"),
  previewCaption: document.getElementById("preview-caption"),
  previewCounter: document.getElementById("preview-counter"),
  prevPhoto: document.getElementById("prev-photo"),
  nextPhoto: document.getElementById("next-photo"),
  flickrLink: document.getElementById("preview-flickr-link"),
  filmstrip: document.getElementById("filmstrip"),
  appVersion: document.getElementById("app-version"),
};

let touchStartX = null;
let touchStartY = null;
let lastTapTime = 0;
let lastTapX = null;
let lastTapY = null;
let pseudoFullscreenActive = false;
let stripResizeActive = false;
let stripResizeTouchId = null;
let eventsBound = false;

function renderLoadedVersion() {
  const htmlVersion =
    document.querySelector('meta[name="app-html-version"]')?.getAttribute("content") || "unknown";
  const label = `Loaded HTML ${htmlVersion} · JS ${JS_VERSION}`;

  if (elements.appVersion) {
    elements.appVersion.textContent = label;
  }

  window.APP_RUNTIME_VERSION = { html: htmlVersion, js: JS_VERSION };
  console.info("[FlickrAlbumViewer]", window.APP_RUNTIME_VERSION);
}

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
  const states = [elements.loadingState, elements.errorState, elements.emptyState, elements.theatreView];
  states.forEach((node) => node.classList.add("hidden"));

  if (state === "loading") {
    elements.loadingState.classList.remove("hidden");
  } else if (state === "error") {
    elements.errorState.classList.remove("hidden");
  } else if (state === "empty") {
    elements.emptyState.classList.remove("hidden");
  } else {
    elements.theatreView.classList.remove("hidden");
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
  const thumbUrl = pickBestUrl(photo, ["url_n", "url_m", "url_q", "url_s", "url_t"]);
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

function normalizeStripSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 132;
  }
  return Math.min(MAX_STRIP_SIZE, Math.max(MIN_STRIP_SIZE, parsed));
}

function applyStripSize(size, persist = true) {
  const normalized = normalizeStripSize(size);
  if (elements.appShell) {
    elements.appShell.style.setProperty("--filmstrip-size", `${normalized}px`);
  }

  if (persist) {
    localStorage.setItem(STRIP_SIZE_STORAGE_KEY, String(normalized));
  }
}

function initializeStripSize() {
  const saved = localStorage.getItem(STRIP_SIZE_STORAGE_KEY);
  if (saved) {
    applyStripSize(saved, false);
    return;
  }

  applyStripSize(132, false);
}

function isLandscapeOrientation() {
  return window.matchMedia("(orientation: landscape)").matches;
}

function updateResizerOrientation() {
  if (!elements.filmstripResizer) {
    return;
  }

  elements.filmstripResizer.setAttribute(
    "aria-orientation",
    isLandscapeOrientation() ? "vertical" : "horizontal"
  );
}

function updateStripSizeFromPointer(clientX, clientY) {
  const bounds = elements.theatreView.getBoundingClientRect();
  const rawSize = isLandscapeOrientation() ? bounds.right - clientX : bounds.bottom - clientY;
  applyStripSize(rawSize);
}

function handleResizerPointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  stripResizeActive = true;
  document.body.classList.add("resizing-filmstrip");
  elements.filmstripResizer.classList.add("is-active");
  if (typeof elements.filmstripResizer.setPointerCapture === "function") {
    elements.filmstripResizer.setPointerCapture(event.pointerId);
  }
  updateStripSizeFromPointer(event.clientX, event.clientY);
  event.preventDefault();
}

function handleResizerPointerMove(event) {
  if (!stripResizeActive) {
    return;
  }

  updateStripSizeFromPointer(event.clientX, event.clientY);
}

function stopResizerInteraction(event) {
  if (!stripResizeActive) {
    return;
  }

  stripResizeActive = false;
  stripResizeTouchId = null;
  document.body.classList.remove("resizing-filmstrip");
  elements.filmstripResizer.classList.remove("is-active");
  if (event && typeof elements.filmstripResizer.releasePointerCapture === "function") {
    try {
      elements.filmstripResizer.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer may already be released.
    }
  }
}

function getTrackedTouch(touchList) {
  if (stripResizeTouchId === null) {
    return null;
  }

  for (const touch of touchList) {
    if (touch.identifier === stripResizeTouchId) {
      return touch;
    }
  }

  return null;
}

function handleResizerTouchStart(event) {
  const touch = event.changedTouches[0];
  if (!touch) {
    return;
  }

  stripResizeActive = true;
  stripResizeTouchId = touch.identifier;
  document.body.classList.add("resizing-filmstrip");
  elements.filmstripResizer.classList.add("is-active");
  updateStripSizeFromPointer(touch.clientX, touch.clientY);
  event.preventDefault();
}

function handleResizerTouchMove(event) {
  if (!stripResizeActive) {
    return;
  }

  const touch = getTrackedTouch(event.changedTouches) || getTrackedTouch(event.touches);
  if (!touch) {
    return;
  }

  updateStripSizeFromPointer(touch.clientX, touch.clientY);
  event.preventDefault();
}

function handleResizerTouchEnd(event) {
  if (!stripResizeActive) {
    return;
  }

  const touch = getTrackedTouch(event.changedTouches);
  if (touch) {
    stopResizerInteraction();
    event.preventDefault();
  }
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

function renderFilmstrip(photos) {
  elements.filmstrip.innerHTML = "";

  photos.forEach((photo, index) => {
    const item = document.createElement("button");
    item.className = "strip-item";
    item.type = "button";
    item.dataset.index = String(index);
    item.setAttribute("aria-label", `Show photo ${index + 1}: ${photo.title}`);
    item.setAttribute("aria-pressed", "false");

    const img = document.createElement("img");
    img.src = photo.thumbUrl;
    img.alt = photo.title;
    img.loading = "lazy";
    img.decoding = "async";

    item.appendChild(img);
    item.addEventListener("click", () => selectPhoto(index));

    elements.filmstrip.appendChild(item);
  });
}

function updatePreview() {
  const photo = appState.photos[appState.selectedIndex];
  if (!photo) {
    return;
  }

  elements.previewImage.src = photo.displayUrl;
  elements.previewImage.alt = photo.title;
  elements.previewCaption.textContent = photo.title;
  elements.previewCounter.textContent = `${appState.selectedIndex + 1} / ${appState.photos.length}`;
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

function updateSelectedStripItem(scrollIntoView = true) {
  const items = elements.filmstrip.querySelectorAll(".strip-item");
  items.forEach((item, idx) => {
    const isActive = idx === appState.selectedIndex;
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-pressed", isActive ? "true" : "false");

    if (isActive && scrollIntoView) {
      item.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  });
}

function selectPhoto(index, shouldScroll = true) {
  if (!appState.photos.length) {
    return;
  }

  const boundedIndex = Math.min(appState.photos.length - 1, Math.max(0, index));
  appState.selectedIndex = boundedIndex;
  updatePreview();
  updateSelectedStripItem(shouldScroll);
}

function setActivePhotoByStep(step) {
  if (!appState.photos.length) {
    return;
  }

  const next = (appState.selectedIndex + step + appState.photos.length) % appState.photos.length;
  selectPhoto(next);
}

function showNext() {
  setActivePhotoByStep(1);
}

function showPrev() {
  setActivePhotoByStep(-1);
}

function updateFullscreenToggleUi() {
  if (!elements.previewFullscreenToggle) {
    return;
  }

  const nativeFullscreenActive = document.fullscreenElement === elements.previewPane;
  const fullscreenActive = nativeFullscreenActive || pseudoFullscreenActive;

  elements.previewFullscreenToggle.textContent = fullscreenActive ? "⤡" : "⤢";
  elements.previewFullscreenToggle.setAttribute(
    "aria-label",
    fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"
  );
  elements.previewFullscreenToggle.setAttribute("aria-pressed", fullscreenActive ? "true" : "false");
}

async function toggleFullscreenPreview() {
  if (pseudoFullscreenActive) {
    document.body.classList.remove("pseudo-fullscreen");
    pseudoFullscreenActive = false;
    updateFullscreenToggleUi();
    return;
  }

  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      document.body.classList.remove("pseudo-fullscreen");
      pseudoFullscreenActive = false;
      updateFullscreenToggleUi();
    }
    return;
  }

  if (elements.previewPane?.requestFullscreen && document.fullscreenEnabled) {
    try {
      await elements.previewPane.requestFullscreen();
      updateFullscreenToggleUi();
      return;
    } catch {
      // Fallback below for browsers like iOS Safari with limited fullscreen support.
    }
  }

  document.body.classList.add("pseudo-fullscreen");
  pseudoFullscreenActive = true;
  updateFullscreenToggleUi();
}

function handleKeyDown(event) {
  const theatreVisible = !elements.theatreView.classList.contains("hidden");
  if (!theatreVisible) {
    return;
  }

  if (event.key === "ArrowRight") {
    showNext();
  } else if (event.key === "ArrowLeft") {
    showPrev();
  }
}

function handleTouchStart(event) {
  touchStartX = event.changedTouches[0].screenX;
  touchStartY = event.changedTouches[0].screenY;
}

async function handleTouchEnd(event) {
  if (touchStartX === null) {
    return;
  }

  const point = event.changedTouches[0];
  const deltaX = point.screenX - touchStartX;
  const deltaY = point.screenY - touchStartY;
  const threshold = 50;
  const isSwipe = Math.abs(deltaX) > threshold && Math.abs(deltaX) > Math.abs(deltaY);

  if (isSwipe && deltaX > threshold) {
    showPrev();
  } else if (isSwipe && deltaX < -threshold) {
    showNext();
  } else {
    const now = Date.now();
    const sinceLastTap = now - lastTapTime;
    const movedSinceLastTap =
      lastTapX === null || lastTapY === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(point.screenX - lastTapX, point.screenY - lastTapY);

    if (sinceLastTap <= DOUBLE_TAP_MS && movedSinceLastTap <= DOUBLE_TAP_MOVE_PX) {
      await toggleFullscreenPreview();
      lastTapTime = 0;
      lastTapX = null;
      lastTapY = null;
    } else {
      lastTapTime = now;
      lastTapX = point.screenX;
      lastTapY = point.screenY;
    }
  }

  touchStartX = null;
  touchStartY = null;
  elements.previewPane.classList.remove("is-touching");
}

async function initializeApp() {
  renderLoadedVersion();

  if (!eventsBound) {
    elements.retryButton.addEventListener("click", initializeApp);
    elements.nextPhoto.addEventListener("click", showNext);
    elements.prevPhoto.addEventListener("click", showPrev);
    elements.previewFullscreenToggle.addEventListener("click", () => {
      void toggleFullscreenPreview();
    });
    elements.filmstripResizer.addEventListener("pointerdown", handleResizerPointerDown);
    elements.filmstripResizer.addEventListener("pointermove", handleResizerPointerMove);
    elements.filmstripResizer.addEventListener("pointerup", stopResizerInteraction);
    elements.filmstripResizer.addEventListener("pointercancel", stopResizerInteraction);
    elements.filmstripResizer.addEventListener("touchstart", handleResizerTouchStart, { passive: false });
    elements.filmstripResizer.addEventListener("touchmove", handleResizerTouchMove, { passive: false });
    elements.filmstripResizer.addEventListener("touchend", handleResizerTouchEnd, { passive: false });
    elements.filmstripResizer.addEventListener("touchcancel", () => {
      stopResizerInteraction();
    }, { passive: true });
    elements.previewMedia.addEventListener("dblclick", () => {
      void toggleFullscreenPreview();
    });
    document.addEventListener("keydown", handleKeyDown);
    elements.previewPane.addEventListener("touchstart", (event) => {
      elements.previewPane.classList.add("is-touching");
      handleTouchStart(event);
    }, { passive: true });
    elements.previewPane.addEventListener("touchend", (event) => {
      void handleTouchEnd(event);
    }, { passive: true });
    elements.previewPane.addEventListener("touchcancel", () => {
      touchStartX = null;
      touchStartY = null;
      elements.previewPane.classList.remove("is-touching");
    }, { passive: true });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        pseudoFullscreenActive = false;
      }
      updateFullscreenToggleUi();
    });
    window.addEventListener("resize", updateResizerOrientation);
    window.addEventListener("orientationchange", updateResizerOrientation);
    eventsBound = true;
  }

  initializeStripSize();
  updateResizerOrientation();
  updateFullscreenToggleUi();

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

    renderFilmstrip(appState.photos);
    selectPhoto(0, false);
    setViewState("gallery");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error loading album.";
    showError(message);
  }
}

initializeApp();
