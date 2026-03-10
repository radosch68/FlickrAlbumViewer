const config = window.APP_CONFIG || {};
const STRIP_SIZE_STORAGE_KEY = "flickrFilmstripSize";
const DEFAULT_STRIP_SIZE = 132;
const COLLAPSED_STRIP_SIZE = 0;
const MIN_STRIP_SIZE = 92;
const MAX_STRIP_SIZE = 260;
const FOCUS_MODE_THRESHOLD = MIN_STRIP_SIZE / 2;
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
  focusMode: false,
  lastExpandedStripSize: DEFAULT_STRIP_SIZE,
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
  prevPhoto: document.getElementById("prev-photo"),
  nextPhoto: document.getElementById("next-photo"),
  filmstrip: document.getElementById("filmstrip"),
  appVersion: document.getElementById("app-version"),
};

let touchStartX = null;
let touchStartY = null;
let stripResizeActive = false;
let stripResizeTouchId = null;
let eventsBound = false;
let resizerTouchStartedAt = 0;
let resizerTouchMoved = false;
let resizerLastTap = 0;
let resizerLastTapX = 0;
let resizerLastTapY = 0;

function setResizeVisualCue(active) {
  if (!elements.filmstrip || !elements.filmstripResizer) {
    return;
  }

  if (active) {
    elements.filmstrip.style.background = "#1f2937";
    elements.filmstripResizer.style.background = "#1f2937";
  } else {
    elements.filmstrip.style.background = "";
    elements.filmstripResizer.style.background = "";
  }
}

let microFeedbackTimer = null;
function playMicroFeedback() {
  if (!elements.filmstrip) return;
  if (microFeedbackTimer) {
    clearTimeout(microFeedbackTimer);
    elements.filmstrip.classList.remove('micro-feedback');
    microFeedbackTimer = null;
  }
  elements.filmstrip.classList.add('micro-feedback');
  microFeedbackTimer = setTimeout(() => {
    elements.filmstrip.classList.remove('micro-feedback');
    microFeedbackTimer = null;
  }, 260);
}

function renderLoadedVersion() {
  const htmlVersion =
    document.querySelector('meta[name="app-html-version"]')?.getAttribute("content") || "unknown";
  const label = htmlVersion;

  if (elements.appVersion) {
    elements.appVersion.textContent = label;
  }

  window.APP_RUNTIME_VERSION = { html: htmlVersion };
  console.info("[FlickrAlbumViewer]", window.APP_RUNTIME_VERSION);
  appState.versionDisplayed = true;
}

function renderBackButtonIfNeeded() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromAlbums = params.get("fromAlbums");
    if (!fromAlbums) return;

    const titleRow = document.querySelector(".title-row");
    if (!titleRow) return;

    // avoid adding twice
    if (document.getElementById("back-to-albums")) return;

    const btn = document.createElement("button");
    btn.id = "back-to-albums";
    btn.className = "back-btn";
    btn.type = "button";
    btn.textContent = "← Albums";
    btn.addEventListener("click", () => {
      // go to the hidden albums listing
      const base = window.location.origin + window.location.pathname.replace(/index\.html$/, "");
      window.location.href = (base || "./") + "albums/";
    });

    titleRow.insertBefore(btn, titleRow.firstChild);
  } catch (e) {
    // ignore
  }
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
  const maxRetries = Number.isFinite(config.maxRetries) ? config.maxRetries : 3;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    attempt++;

    try {
      // build endpoint (allow override via `flickrApiBaseUrl` in app-config.js)
      const base = (config.flickrApiBaseUrl && String(config.flickrApiBaseUrl).trim()) || "https://www.flickr.com/services/rest/";

      const endpoint = new URL(base);
      endpoint.searchParams.set("method", method);
      endpoint.searchParams.set("api_key", config.flickrApiKey);
      endpoint.searchParams.set("format", "json");
      endpoint.searchParams.set("nojsoncallback", "1");

      Object.entries(params).forEach(([key, value]) => {
        endpoint.searchParams.set(key, value);
      });

      // show informative loading message when retrying
      if (attempt > 1) {
        setLoadingMessage(`Network error, retrying (${attempt}/${maxRetries})...`);
      }

      const response = await fetch(endpoint, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Flickr request failed with ${response.status}.`);
      }

      const payload = await response.json();
      if (payload.stat !== "ok") {
        const reason = payload.message || "Unknown Flickr API error.";
        throw new Error(reason);
      }

      // reset loading message to default when successful
      setLoadingMessage("Loading album photos...");
      return payload;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt > maxRetries) {
        break;
      }

      // exponential backoff with jitter
      const baseDelay = 500;
      const backoff = Math.min(8000, baseDelay * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 300);
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      // continue to next attempt
    }
  }

  // final failure
  throw lastError || new Error("Unknown network error.");
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

function setLoadingMessage(message) {
  try {
    const p = elements.loadingState?.querySelector("p");
    if (p) {
      p.textContent = message;
    } else if (elements.loadingState) {
      elements.loadingState.textContent = message;
    }
  } catch (e) {
    // ignore
  }
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
    return DEFAULT_STRIP_SIZE;
  }
  return Math.min(MAX_STRIP_SIZE, Math.max(MIN_STRIP_SIZE, parsed));
}

function normalizeCollapsedSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return COLLAPSED_STRIP_SIZE;
  }
  return Math.min(MAX_STRIP_SIZE, Math.max(COLLAPSED_STRIP_SIZE, parsed));
}

function applyStripSize(size, persist = true, allowCollapsed = false) {
  const normalized = allowCollapsed ? normalizeCollapsedSize(size) : normalizeStripSize(size);

  if (normalized > 0) {
    appState.lastExpandedStripSize = normalized;
  }

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

  applyStripSize(DEFAULT_STRIP_SIZE, false);
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

  if (rawSize < FOCUS_MODE_THRESHOLD) {
    setFocusMode(true, false);
    return;
  }

  if (appState.focusMode) {
    setFocusMode(false, false);
  }

  applyStripSize(rawSize);
}

function handleResizerPointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  stripResizeActive = true;
  document.body.classList.add("resizing-filmstrip");
  elements.filmstripResizer.classList.add("is-active");
  setResizeVisualCue(true);
  playMicroFeedback();
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

  // pointer moved -> this is a resize gesture, not a tap
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
  setResizeVisualCue(false);
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

  // start tracking this touch to distinguish taps vs. drags
  resizerTouchStartedAt = Date.now();
  resizerTouchMoved = false;

  stripResizeActive = true;
  stripResizeTouchId = touch.identifier;
  document.body.classList.add("resizing-filmstrip");
  elements.filmstripResizer.classList.add("is-active");
  setResizeVisualCue(true);
  playMicroFeedback();
  updateStripSizeFromPointer(touch.clientX, touch.clientY);
  event.preventDefault();
}

function handleResizerTouchMove(event) {
  if (!stripResizeActive) {
    return;
  }

  // movement detected -> mark as move so it's not considered a tap
  resizerTouchMoved = true;

  const touch = getTrackedTouch(event.changedTouches) || getTrackedTouch(event.touches);
  if (!touch) {
    return;
  }

  updateStripSizeFromPointer(touch.clientX, touch.clientY);
  event.preventDefault();
}

function handleResizerTouchEnd(event) {
  // Handle quick taps even if stripResizeActive was cleared elsewhere.
  const touch = getTrackedTouch(event.changedTouches) || event.changedTouches[0];
  if (!touch) return;

  const now = Date.now();
  const duration = now - (resizerTouchStartedAt || 0);
  // Loosen thresholds slightly for mobile
  const isQuickTap = !resizerTouchMoved && duration < 300;

  if (isQuickTap) {
    const dx = Math.abs(touch.clientX - (resizerLastTapX || 0));
    const dy = Math.abs(touch.clientY - (resizerLastTapY || 0));
    if (resizerLastTap && now - resizerLastTap < 400 && dx < 40 && dy < 40) {
      // double-tap detected
      resizerLastTap = 0;
      stopResizerInteraction();
      if (appState.focusMode) {
        toggleFocusMode();
      }
      event.preventDefault();
      return;
    }

    // record this tap for possible double-tap
    resizerLastTap = now;
    resizerLastTapX = touch.clientX;
    resizerLastTapY = touch.clientY;
  }

  // always end the interaction
  stopResizerInteraction();
  event.preventDefault();
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
  elements.photoCount.textContent = `${appState.selectedIndex + 1}/${appState.photos.length}`;

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

    if (isActive && scrollIntoView && !appState.focusMode) {
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
  // If the version badge is visible, clear it once the user navigates.
  if (appState.versionDisplayed && shouldScroll) {
    if (elements.appVersion) {
      elements.appVersion.textContent = "";
    }
    appState.versionDisplayed = false;
  }

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

function updateFocusToggleUi() {
  if (!elements.previewFullscreenToggle) {
    return;
  }

  // Render paired glyph `<>` as a single element so both chars rotate together
  // and remain on one line.
  if (appState.focusMode) {
    // Use right+left (›‹) rotated 45° CCW for the de-enlarge state.
    elements.previewFullscreenToggle.innerHTML = '<span class="focus-glyph rotated-ccw">›‹</span>';
  } else {
    // Use angle-quote pair so left+right are visually balanced: ‹› (U+2039/U+203A)
    elements.previewFullscreenToggle.innerHTML = '<span class="focus-glyph rotated-ccw">‹›</span>';
  }
  elements.previewFullscreenToggle.setAttribute(
    "aria-label",
    appState.focusMode ? "Restore filmstrip" : "Expand photo"
  );
  elements.previewFullscreenToggle.setAttribute("title", appState.focusMode ? "Restore filmstrip" : "Expand photo");
  elements.previewFullscreenToggle.setAttribute("aria-pressed", appState.focusMode ? "true" : "false");
}

// Set CSS `--app-height` from `window.innerHeight` to avoid mobile chrome
// shrinking the layout when the browser UI appears/disappears.
function setAppHeight() {
  const h = window.innerHeight + "px";
  // Prefer setting the var on the app shell so the local --app-height
  // declaration in `.app-shell` doesn't override our runtime value.
  if (typeof elements !== "undefined" && elements.appShell) {
    elements.appShell.style.setProperty("--app-height", h);
  } else {
    document.documentElement.style.setProperty("--app-height", h);
  }
  if (typeof elements !== "undefined" && elements.appShell) {
    const isLandscape = window.innerWidth > window.innerHeight;
    const isSmall = window.innerWidth <= 900;
    elements.appShell.classList.toggle("landscape-compact", isLandscape && isSmall);
  }
}

function shouldAutoFullscreen() {
  return window.innerWidth <= 900 && window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
}

async function enterFullscreen() {
  try {
    const el = elements && elements.theatreView ? elements.theatreView : document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    }
  } catch (err) {
    console.info("[FlickrAlbumViewer] enterFullscreen failed:", err);
  }
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      await document.webkitExitFullscreen();
    }
  } catch (err) {
    console.info("[FlickrAlbumViewer] exitFullscreen failed:", err);
  }
}

document.addEventListener("fullscreenchange", () => {
  if (typeof elements !== "undefined" && elements.appShell) {
    elements.appShell.classList.toggle("is-fullscreen", !!document.fullscreenElement);
  }
});

function setFocusMode(enabled, restoreSize = true) {
  if (enabled === appState.focusMode) {
    return;
  }

  appState.focusMode = enabled;
  elements.appShell.classList.toggle("focus-mode", enabled);

  if (enabled) {
    applyStripSize(COLLAPSED_STRIP_SIZE, false, true);
  } else if (restoreSize) {
    applyStripSize(appState.lastExpandedStripSize || DEFAULT_STRIP_SIZE, false);
  }

  updateFocusToggleUi();
}

function toggleFocusMode() {
  setFocusMode(!appState.focusMode, true);
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

function handleTouchEnd(event) {
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
  }

  touchStartX = null;
  touchStartY = null;
  elements.previewPane.classList.remove("is-touching");
}

async function initializeApp() {
  renderLoadedVersion();

  // Log effective network config for debugging
  console.info("[FlickrAlbumViewer] config:", {
    flickrApiBaseUrl: config.flickrApiBaseUrl || null,
    maxRetries: config.maxRetries ?? null,
  });

  renderBackButtonIfNeeded();
  // ensure initial CSS app-height is set for mobile browsers
  setAppHeight();

  if (!eventsBound) {
    elements.retryButton.addEventListener("click", initializeApp);
    elements.nextPhoto.addEventListener("click", showNext);
    elements.prevPhoto.addEventListener("click", showPrev);
    elements.previewFullscreenToggle.addEventListener("click", async () => {
      toggleFocusMode();
      try {
        if (appState.focusMode && shouldAutoFullscreen()) {
          await enterFullscreen();
        } else if (!appState.focusMode && document.fullscreenElement) {
          await exitFullscreen();
        }
      } catch (err) {
        console.info("[FlickrAlbumViewer] fullscreen toggle error:", err);
      }
    });
    // allow double-click with mouse/pointer to toggle focus when only the handle is visible
    elements.filmstripResizer.addEventListener('dblclick', (e) => {
      if (appState.focusMode) {
        toggleFocusMode();
        e.preventDefault();
      }
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
    window.addEventListener("resize", updateResizerOrientation);
    window.addEventListener("orientationchange", updateResizerOrientation);
    // keep the CSS `--app-height` in sync to mitigate mobile chrome resizing
    window.addEventListener("resize", setAppHeight);
    window.addEventListener("orientationchange", () => setTimeout(setAppHeight, 50));
    eventsBound = true;
  }

  initializeStripSize();
  updateResizerOrientation();
  updateFocusToggleUi();

  if (!validateConfig()) {
    return;
  }

  setLoadingMessage("Loading album photos...");
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
    elements.photoCount.textContent = "0/0";

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
