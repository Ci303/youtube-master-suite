// ==UserScript==
// @name         YouTube Scroll Miniplayer
// @namespace    Citizen.youtube.scroll-miniplayer
// @version      5.7
// @description  Floats the active YouTube player with compact queue context when the watch/live player scrolls out of view.
// @author       Citizen
// @homepageURL  https://github.com/Ci303/youtube-scroll-miniplayer
// @supportURL   https://github.com/Ci303/youtube-scroll-miniplayer/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-scroll-miniplayer/main/youtube-scroll-miniplayer.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-scroll-miniplayer/main/youtube-scroll-miniplayer.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    enabled: true,
    sizeMode: "dynamic", // "dynamic", "fixed", or "column"
    width: 720,
    portraitWidth: 480,
    minWidth: 320,
    maxWidth: 800,
    portraitMaxWidth: 560,
    maxViewportWidthRatio: 0.38,
    minDynamicWidth: 320,
    aspectRatio: 16 / 9,
    edgeOffsetPx: 16,
    mastheadGapPx: 12,
    triggerOffsetPx: 0,
    position: "top-right",
    showCompactQueueInfo: true,
    enterTransitionMs: 70,
    exitTransitionMs: 0,
  };

  const STYLE_ID = "ytsmp-style";
  const ACTIVE_CLASS = "ytsmp-scroll-miniplayer-active";
  const EXITING_CLASS = "ytsmp-scroll-miniplayer-exiting";
  const CLOSE_BUTTON_ID = "ytsmp-close-button";
  const QUEUE_INFO_ID = "ytsmp-compact-queue-info";
  const PLACEHOLDER_ID = "ytsmp-player-placeholder";
  const WATCH_PATHS = ["/watch", "/live/"];
  const WATCH_ROOT_SELECTOR = "ytd-watch-flexy";
  const TRIGGER_ANCHOR_SELECTOR = "#single-column-container";
  const PLAYER_VIEWPORT_ANCHOR_SELECTORS = [
    "#player-container-outer",
    "#player-container",
    "#player",
    "ytd-player",
  ];
  const MOVIE_PLAYER_ID = "movie_player";
  const MOVIE_PLAYER_SELECTOR = `#${MOVIE_PLAYER_ID}`;
  const HTML5_PLAYER_SELECTOR = ".html5-video-player";
  const PLAYER_HOST_SELECTOR = "ytd-player";
  const VIDEO_SELECTOR = "video";
  const MASTHEAD_SELECTOR = "ytd-masthead";
  const NATIVE_MINIPLAYER_SELECTOR = "ytd-miniplayer";
  const QUEUE_PANEL_SELECTOR = [
    "ytd-playlist-panel-renderer",
    "yt-playlist-panel-renderer",
  ].join(",");
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer",
    "yt-playlist-panel-video-renderer",
  ].join(",");
  const QUEUE_INDEX_SELECTOR = [
    "#publisher-container #index-message",
    "#header-description #index-message",
    "#index-message",
  ].join(",");
  const QUEUE_ITEM_TITLE_SELECTOR = "#video-title";
  const QUEUE_ITEM_TITLE_FALLBACK_SELECTOR = ".yt-core-attributed-string";
  const WATCH_TITLE_SELECTOR = [
    "ytd-watch-metadata h1 yt-formatted-string",
    "ytd-watch-metadata h1 .yt-core-attributed-string",
    "#title h1 yt-formatted-string",
  ].join(",");
  const DIRECT_BOX_CLASS = "box";
  const SINGLE_COLUMN_BOX_SELECTOR = `${TRIGGER_ANCHOR_SELECTOR} > .box`;
  const FILLED_COLUMN_BOX_SELECTOR = ".box.ytd-watch-flexy, #columns .box";
  const COLUMNS_SELECTOR = "#columns";
  const BODY_BOX_VAR_NAMES = [
    "--ytsmp-width",
    "--ytsmp-height",
    "--ytsmp-top",
    "--ytsmp-bottom",
    "--ytsmp-left",
    "--ytsmp-right",
  ];

  let scrollScheduled = false;
  let routeScheduled = false;
  let queueInfoScheduled = false;
  let fadeOutTimer = 0;
  let suppressedUntilVisible = false;
  let floatedPlayer = null;
  let playerPlaceholder = null;
  let restoreParent = null;
  let restoreNextSibling = null;

  function isEligiblePath() {
    return location.pathname === WATCH_PATHS[0] || location.pathname.startsWith(WATCH_PATHS[1]);
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function isBodyActive() {
    return Boolean(document.body && document.body.classList.contains(ACTIVE_CLASS));
  }

  function isBodyFloating() {
    return Boolean(
      document.body &&
      (
        document.body.classList.contains(ACTIVE_CLASS) ||
        document.body.classList.contains(EXITING_CLASS)
      )
    );
  }

  function getWatchRoot() {
    return document.querySelector(WATCH_ROOT_SELECTOR);
  }

  function getTriggerAnchor() {
    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    return watchRoot.querySelector(TRIGGER_ANCHOR_SELECTOR);
  }

  function getPlayerViewportAnchor() {
    if (playerPlaceholder && document.documentElement.contains(playerPlaceholder)) return playerPlaceholder;

    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    return queryFirst(PLAYER_VIEWPORT_ANCHOR_SELECTORS, watchRoot);
  }

  function isUsableBox(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    return rect.width > 240 && rect.height > 40;
  }

  function getFilledColumnBox() {
    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    const directBox = Array.from(watchRoot.children)
      .find((el) => el.classList && el.classList.contains(DIRECT_BOX_CLASS));
    if (isUsableBox(directBox)) return directBox;

    const singleColumnBox = watchRoot.querySelector(SINGLE_COLUMN_BOX_SELECTOR);
    if (isUsableBox(singleColumnBox)) return singleColumnBox;

    return Array.from(watchRoot.querySelectorAll(FILLED_COLUMN_BOX_SELECTOR))
      .find(isUsableBox) || null;
  }

  function getRemainingColumnBox() {
    const watchRoot = getWatchRoot();
    if (!watchRoot) return null;

    const columns = watchRoot.querySelector(COLUMNS_SELECTOR);
    const filledBox = getFilledColumnBox();
    if (!columns || !filledBox) return null;

    const columnsRect = columns.getBoundingClientRect();
    const filledRect = filledBox.getBoundingClientRect();
    const right = Math.min(columnsRect.right, innerWidth);
    const left = Math.max(columnsRect.left, filledRect.right);
    const width = Math.floor(right - left);

    if (width < CONFIG.minDynamicWidth) return null;

    return {
      width,
      right: Math.max(0, Math.round(innerWidth - right)),
    };
  }

  function getPlayer() {
    const watchRoot = getWatchRoot();

    return (
      (floatedPlayer && document.documentElement.contains(floatedPlayer) ? floatedPlayer : null) ||
      (watchRoot && watchRoot.querySelector(MOVIE_PLAYER_SELECTOR)) ||
      document.getElementById(MOVIE_PLAYER_ID) ||
      (watchRoot && watchRoot.querySelector(HTML5_PLAYER_SELECTOR)) ||
      document.querySelector(HTML5_PLAYER_SELECTOR)
    );
  }

  function getPlayerVideo() {
    const player = getPlayer();
    return player ? player.querySelector(VIDEO_SELECTOR) : null;
  }

  function getMastheadHeight() {
    const masthead = document.querySelector(MASTHEAD_SELECTOR);
    const rect = masthead ? masthead.getBoundingClientRect() : null;
    return rect && rect.height > 0 ? rect.height : 56;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isFullscreen() {
    const watchRoot = getWatchRoot();
    const player = getPlayer();

    return Boolean(
      document.fullscreenElement ||
      (watchRoot && watchRoot.hasAttribute("fullscreen")) ||
      (player && player.classList.contains("ytp-fullscreen"))
    );
  }

  function isNativeMiniplayerVisible() {
    const miniplayer = document.querySelector(NATIVE_MINIPLAYER_SELECTOR);
    if (!miniplayer) return false;
    if (miniplayer.hidden || miniplayer.hasAttribute("hidden") || miniplayer.getAttribute("aria-hidden") === "true") return false;

    const style = getComputedStyle(miniplayer);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

    const rect = miniplayer.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  }

  function canFloatPlayer() {
    if (!CONFIG.enabled || !isEligiblePath() || isFullscreen() || isNativeMiniplayerVisible()) return false;

    const video = getPlayerVideo();
    if (!video || video.ended) return false;

    const player = getPlayer();
    return Boolean(player && !player.classList.contains("ended-mode"));
  }

  function buildCss() {
    const defaultHeight = Math.round(CONFIG.width / CONFIG.aspectRatio);

    return `
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen),
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) {
        position: fixed !important;
        top: var(--ytsmp-top, 68px) !important;
        right: var(--ytsmp-right, auto) !important;
        bottom: var(--ytsmp-bottom, auto) !important;
        left: var(--ytsmp-left, 16px) !important;
        z-index: 2147483647 !important;
        width: var(--ytsmp-width, ${CONFIG.width}px) !important;
        height: var(--ytsmp-height, ${defaultHeight}px) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        background: #000 !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55) !important;
        transition:
          opacity ${CONFIG.enterTransitionMs}ms ease-out,
          transform ${CONFIG.enterTransitionMs}ms ease-out !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) {
        opacity: 1 !important;
        transform: translateZ(0) scale(1) !important;
      }

      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translateZ(0) scale(0.985) !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) video.html5-main-video,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-iv-video-content,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) video.html5-main-video,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-iv-video-content {
        top: 0 !important;
        left: 0 !important;
        width: var(--ytsmp-width, ${CONFIG.width}px) !important;
        height: var(--ytsmp-height, ${defaultHeight}px) !important;
        margin-left: 0 !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-chrome-bottom {
        left: 12px !important;
        width: calc(100% - 24px) !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-gradient-bottom {
        height: 96px !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-ce-element,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-paid-content-overlay {
        display: none !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-playlist-menu,
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-queue-menu,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-playlist-menu,
      body.${EXITING_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) .ytp-queue-menu {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      #${CLOSE_BUTTON_ID} {
        display: none !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID} {
        align-items: center !important;
        background: rgba(0, 0, 0, 0.72) !important;
        border: 0 !important;
        border-radius: 999px !important;
        box-sizing: border-box !important;
        color: #fff !important;
        cursor: pointer !important;
        display: flex !important;
        font: 700 18px/1 Arial, Helvetica, sans-serif !important;
        height: 28px !important;
        justify-content: center !important;
        opacity: 0 !important;
        padding: 0 !important;
        position: absolute !important;
        right: 8px !important;
        top: 8px !important;
        transition: opacity 120ms ease-out !important;
        width: 28px !important;
        z-index: 2147483647 !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen):hover #${CLOSE_BUTTON_ID},
      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${CLOSE_BUTTON_ID}:focus-visible {
        opacity: 1 !important;
      }

      #${QUEUE_INFO_ID} {
        display: none !important;
      }

      body.${ACTIVE_CLASS} ${MOVIE_PLAYER_SELECTOR}:not(.ytp-fullscreen) #${QUEUE_INFO_ID} {
        align-items: center !important;
        background: rgba(18, 18, 18, 0.88) !important;
        border-radius: 6px !important;
        bottom: 48px !important;
        box-sizing: border-box !important;
        color: #fff !important;
        display: flex !important;
        font: 500 12px/1.2 Arial, Helvetica, sans-serif !important;
        gap: 8px !important;
        left: 12px !important;
        max-width: calc(100% - 68px) !important;
        min-height: 30px !important;
        padding: 6px 9px !important;
        pointer-events: none !important;
        position: absolute !important;
        right: 44px !important;
        z-index: 70 !important;
      }

      #${QUEUE_INFO_ID} .ytsmp-queue-position {
        color: #aaa !important;
        flex: 0 0 auto !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
      }

      #${QUEUE_INFO_ID} .ytsmp-queue-title {
        min-width: 0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
    `;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();

    (document.head || document.documentElement).appendChild(style);
  }

  function setBodyBoxVars() {
    const body = document.body;
    if (!body) return;

    const remainingColumnBox = CONFIG.position === "top-right" ? getRemainingColumnBox() : null;
    const availableWidth = Math.max(160, innerWidth - CONFIG.edgeOffsetPx * 2);
    const availableHeight = Math.max(90, innerHeight - getMastheadHeight() - CONFIG.mastheadGapPx - CONFIG.edgeOffsetPx);
    const isPortraitViewport = innerHeight > innerWidth;
    let width;

    if (CONFIG.sizeMode === "fixed") {
      width = Math.min(CONFIG.width, availableWidth);
    } else if (CONFIG.sizeMode === "column") {
      width = Math.min(remainingColumnBox ? remainingColumnBox.width : CONFIG.width, availableWidth);
    } else {
      const preferredWidth = isPortraitViewport ? CONFIG.portraitWidth : CONFIG.width;
      const configuredMaxWidth = isPortraitViewport ? CONFIG.portraitMaxWidth : CONFIG.maxWidth;
      const viewportMaxWidth = Math.floor(innerWidth * CONFIG.maxViewportWidthRatio);
      const heightMaxWidth = Math.floor(availableHeight * CONFIG.aspectRatio);
      const maxWidth = Math.max(160, Math.min(configuredMaxWidth, viewportMaxWidth, heightMaxWidth, availableWidth));
      const minWidth = Math.min(CONFIG.minWidth, maxWidth);
      width = clamp(preferredWidth, minWidth, maxWidth);
    }

    let height = Math.round(width / CONFIG.aspectRatio);

    if (height > availableHeight) {
      height = availableHeight;
      width = Math.round(height * CONFIG.aspectRatio);
    }

    const top = getMastheadHeight() + CONFIG.mastheadGapPx;
    const bottom = CONFIG.edgeOffsetPx;
    const edge = CONFIG.edgeOffsetPx;
    const vertical = CONFIG.position.startsWith("bottom") ? "bottom" : "top";
    const horizontal = CONFIG.position.endsWith("right") ? "right" : "left";
    const right = remainingColumnBox ? remainingColumnBox.right : edge;

    body.style.setProperty("--ytsmp-width", `${width}px`);
    body.style.setProperty("--ytsmp-height", `${height}px`);
    body.style.setProperty("--ytsmp-top", vertical === "top" ? `${top}px` : "auto");
    body.style.setProperty("--ytsmp-bottom", vertical === "bottom" ? `${bottom}px` : "auto");
    body.style.setProperty("--ytsmp-left", horizontal === "left" ? `${edge}px` : "auto");
    body.style.setProperty("--ytsmp-right", horizontal === "right" ? `${right}px` : "auto");
  }

  function clearBodyBoxVars() {
    const body = document.body;
    if (!body) return;

    BODY_BOX_VAR_NAMES.forEach((name) => body.style.removeProperty(name));
  }

  function ensurePlayerPlaceholder(player) {
    if (!player || !player.parentNode || playerPlaceholder) return;

    const playerRect = player.getBoundingClientRect();
    const parentRect = player.parentElement ? player.parentElement.getBoundingClientRect() : null;
    const height = Math.round(Math.max(playerRect.height, parentRect ? parentRect.height : 0));
    if (height <= 0) return;

    playerPlaceholder = document.createElement("div");
    playerPlaceholder.id = PLACEHOLDER_ID;
    playerPlaceholder.setAttribute("aria-hidden", "true");
    playerPlaceholder.style.setProperty("box-sizing", "border-box", "important");
    playerPlaceholder.style.setProperty("display", "block", "important");
    playerPlaceholder.style.setProperty("flex", `0 0 ${height}px`, "important");
    playerPlaceholder.style.setProperty("height", `${height}px`, "important");
    playerPlaceholder.style.setProperty("min-height", `${height}px`, "important");
    playerPlaceholder.style.setProperty("pointer-events", "none", "important");
    playerPlaceholder.style.setProperty("visibility", "hidden", "important");
    playerPlaceholder.style.setProperty("width", "100%", "important");
    player.parentNode.insertBefore(playerPlaceholder, player);
  }

  function removePlayerPlaceholder() {
    if (playerPlaceholder) {
      playerPlaceholder.remove();
      playerPlaceholder = null;
    }
  }

  function movePlayerToTopLevel(player) {
    if (!player || !document.body || player.parentElement === document.body) return;

    if (!floatedPlayer) {
      floatedPlayer = player;
      restoreParent = player.parentNode;
      restoreNextSibling = player.nextSibling;
      ensurePlayerPlaceholder(player);
    }

    document.body.appendChild(player);
  }

  function restorePlayer() {
    if (!floatedPlayer) {
      removePlayerPlaceholder();
      return;
    }

    const watchRoot = getWatchRoot();
    const fallbackParent = watchRoot && watchRoot.querySelector(PLAYER_HOST_SELECTOR);
    const parent = restoreParent && document.documentElement.contains(restoreParent)
      ? restoreParent
      : fallbackParent;

    if (parent) {
      const nextSibling = restoreNextSibling && restoreNextSibling.parentNode === parent
        ? restoreNextSibling
        : null;
      parent.insertBefore(floatedPlayer, nextSibling);
    }

    removePlayerPlaceholder();
    floatedPlayer = null;
    restoreParent = null;
    restoreNextSibling = null;
  }

  function ensureCloseButton() {
    const player = getPlayer();
    if (!player) return;

    let button = document.getElementById(CLOSE_BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = CLOSE_BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Close scroll miniplayer");
      button.textContent = "x";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        suppressedUntilVisible = true;
        setActive(false);
      }, true);
    }

    if (button.parentElement !== player) {
      player.appendChild(button);
    }
  }

  function removeCloseButton() {
    const button = document.getElementById(CLOSE_BUTTON_ID);
    if (button) button.remove();
  }

  function normaliseText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getQueueItemVideoId(item) {
    const link = item && item.querySelector('a[href*="/watch"]');
    if (!link) return "";

    try {
      return new URL(link.href || link.getAttribute("href"), location.origin)
        .searchParams.get("v") || "";
    } catch {
      return "";
    }
  }

  function getCompactQueueState() {
    if (!CONFIG.showCompactQueueInfo) return null;

    const panel = document.querySelector(QUEUE_PANEL_SELECTOR);
    if (!panel) return null;

    const items = Array.from(panel.querySelectorAll(QUEUE_ITEM_SELECTOR));
    if (!items.length) return null;

    const currentVideoId = new URL(location.href).searchParams.get("v") || "";
    let currentItem = items.find((item) =>
      item.hasAttribute("selected") ||
      item.getAttribute("aria-current") === "true" ||
      item.classList.contains("selected") ||
      Boolean(item.querySelector('[aria-current="true"]'))
    );
    if (!currentItem && currentVideoId) {
      currentItem = items.find(
        (item) => getQueueItemVideoId(item) === currentVideoId,
      );
    }

    const indexText = normaliseText(
      panel.querySelector(QUEUE_INDEX_SELECTOR)?.textContent,
    );
    const indexMatch = indexText.match(/(\d+)\s*\/\s*(\d+)/);
    let index = currentItem ? items.indexOf(currentItem) + 1 : 0;
    let total = items.length;
    if (indexMatch) {
      index = Number(indexMatch[1]) || index;
      total = Number(indexMatch[2]) || total;
    }
    if (!currentItem && index > 0) {
      currentItem = items[index - 1] || null;
    }

    const titleElement =
      currentItem &&
      (currentItem.querySelector(QUEUE_ITEM_TITLE_SELECTOR) ||
        currentItem.querySelector(QUEUE_ITEM_TITLE_FALLBACK_SELECTOR));
    const title = normaliseText(
      titleElement?.getAttribute("title") ||
      titleElement?.textContent ||
      document.querySelector(WATCH_TITLE_SELECTOR)?.textContent ||
      document.title.replace(/\s*-\s*YouTube\s*$/, ""),
    );
    if (!title) return null;

    return {
      position: index > 0 ? `Queue ${index} / ${total}` : `Queue / ${total}`,
      title,
    };
  }

  function removeCompactQueueInfo() {
    const queueInfo = document.getElementById(QUEUE_INFO_ID);
    if (queueInfo) queueInfo.remove();
  }

  function syncCompactQueueInfo() {
    queueInfoScheduled = false;
    if (!isBodyActive()) {
      removeCompactQueueInfo();
      return;
    }

    const player = getPlayer();
    const state = getCompactQueueState();
    if (!player || !state) {
      removeCompactQueueInfo();
      return;
    }

    let queueInfo = document.getElementById(QUEUE_INFO_ID);
    if (!queueInfo) {
      queueInfo = document.createElement("div");
      queueInfo.id = QUEUE_INFO_ID;
      queueInfo.setAttribute("role", "status");
      queueInfo.setAttribute("aria-live", "polite");
      queueInfo.innerHTML =
        '<span class="ytsmp-queue-position"></span>' +
        '<span class="ytsmp-queue-title"></span>';
    }
    if (queueInfo.parentElement !== player) {
      player.appendChild(queueInfo);
    }

    const position = queueInfo.querySelector(".ytsmp-queue-position");
    const title = queueInfo.querySelector(".ytsmp-queue-title");
    if (position.textContent !== state.position) {
      position.textContent = state.position;
    }
    if (title.textContent !== state.title) {
      title.textContent = state.title;
      title.title = state.title;
    }
  }

  function scheduleCompactQueueInfoSync() {
    if (queueInfoScheduled) return;

    queueInfoScheduled = true;
    requestAnimationFrame(syncCompactQueueInfo);
  }

  function dispatchResize() {
    window.dispatchEvent(new Event("resize"));
  }

  function setActive(active) {
    const body = document.body;
    if (!body) return;

    const wasActive = body.classList.contains(ACTIVE_CLASS);
    const wasExiting = body.classList.contains(EXITING_CLASS);

    if (active === wasActive && !wasExiting) return;

    if (active) {
      if (!canFloatPlayer()) return;

      clearTimeout(fadeOutTimer);
      ensureStyles();
      movePlayerToTopLevel(getPlayer());
      ensureCloseButton();
      setBodyBoxVars();
      body.classList.remove(EXITING_CLASS);
      body.classList.add(ACTIVE_CLASS);
      scheduleCompactQueueInfoSync();

      if (!wasActive) {
        dispatchResize();
      }
      return;
    }

    clearTimeout(fadeOutTimer);
    body.classList.remove(ACTIVE_CLASS);

    if (wasActive) {
      if (CONFIG.exitTransitionMs <= 0) {
        body.classList.remove(EXITING_CLASS);
        clearBodyBoxVars();
        removeCloseButton();
        removeCompactQueueInfo();
        restorePlayer();
        dispatchResize();
        return;
      }

      body.classList.add(EXITING_CLASS);
      fadeOutTimer = setTimeout(() => {
        body.classList.remove(EXITING_CLASS);
        clearBodyBoxVars();
        removeCloseButton();
        removeCompactQueueInfo();
        restorePlayer();
        dispatchResize();
      }, CONFIG.exitTransitionMs);
      dispatchResize();
      return;
    }

    body.classList.remove(EXITING_CLASS);
    clearBodyBoxVars();
    removeCloseButton();
    removeCompactQueueInfo();
    restorePlayer();
  }

  function deactivateImmediately() {
    const body = document.body;
    if (!body) return;

    const wasFloating = isBodyFloating();
    clearTimeout(fadeOutTimer);
    body.classList.remove(ACTIVE_CLASS, EXITING_CLASS);
    clearBodyBoxVars();
    removeCloseButton();
    removeCompactQueueInfo();
    restorePlayer();

    if (wasFloating) {
      dispatchResize();
    }
  }

  function shouldFloatFromScroll() {
    if (!isEligiblePath() || isFullscreen()) return false;

    const anchor = getTriggerAnchor();
    if (!anchor) return false;

    const triggerLine = getMastheadHeight() + CONFIG.triggerOffsetPx;
    if (anchor.getBoundingClientRect().top > triggerLine) return false;

    const playerAnchor = getPlayerViewportAnchor();
    if (!playerAnchor) return false;

    const playerRect = playerAnchor.getBoundingClientRect();
    if (isBodyActive()) {
      return !(playerRect.bottom > triggerLine && playerRect.top < innerHeight);
    }

    return playerRect.bottom <= triggerLine;
  }

  function syncScrollState() {
    scrollScheduled = false;

    if (!shouldFloatFromScroll() || !canFloatPlayer()) {
      suppressedUntilVisible = false;
      setActive(false);
      return;
    }

    if (!suppressedUntilVisible) {
      setActive(true);
    }
  }

  function scheduleScrollSync() {
    if (scrollScheduled) return;

    scrollScheduled = true;
    requestAnimationFrame(syncScrollState);
  }

  function syncRouteState() {
    routeScheduled = false;

    if (!isEligiblePath()) {
      suppressedUntilVisible = false;
      setActive(false);
      return;
    }

    ensureStyles();
    if (isBodyActive()) {
      scheduleCompactQueueInfoSync();
    }
    scheduleScrollSync();
  }

  function scheduleRouteSync() {
    if (routeScheduled) return;

    routeScheduled = true;
    requestAnimationFrame(syncRouteState);
  }

  const mutationObserver = new MutationObserver((mutations) => {
    if (!isEligiblePath()) return;

    if (
      isBodyActive() &&
      mutations.some((mutation) => {
        const target =
          mutation.target.nodeType === Node.ELEMENT_NODE
            ? mutation.target
            : mutation.target.parentElement;
        if (target && target.closest(QUEUE_PANEL_SELECTOR)) return true;

        return Array.from(mutation.addedNodes || []).some((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return (
            node.matches(QUEUE_PANEL_SELECTOR) ||
            Boolean(node.querySelector(QUEUE_PANEL_SELECTOR))
          );
        });
      })
    ) {
      scheduleCompactQueueInfoSync();
    }

    if (getTriggerAnchor()) return;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        scheduleRouteSync();
        break;
      }
    }
  });

  window.addEventListener("resize", () => {
    if (isBodyActive()) {
      setBodyBoxVars();
    }
    scheduleScrollSync();
  }, { passive: true });

  window.addEventListener("scroll", scheduleScrollSync, { passive: true });

  document.addEventListener("fullscreenchange", () => {
    if (isFullscreen()) setActive(false);
  }, true);

  document.addEventListener("ended", (event) => {
    if (event.target === getPlayerVideo()) {
      // Do not reparent YouTube's player during its ended-event dispatch.
      setTimeout(() => setActive(false), 0);
    }
  }, true);

  window.addEventListener("yt-navigate-start", deactivateImmediately, true);
  window.addEventListener("yt-navigate-finish", () => {
    suppressedUntilVisible = false;
    scheduleRouteSync();
  }, true);
  window.addEventListener("yt-page-data-updated", scheduleRouteSync, true);
  window.addEventListener("pageshow", scheduleRouteSync, true);

  mutationObserver.observe(document.documentElement, {
    attributeFilter: ["aria-current", "selected"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  syncRouteState();
})();
