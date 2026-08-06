// ==UserScript==
// @name         YouTube Page Coherence Guard
// @namespace    Citizen.youtube.page-coherence
// @version      1.1
// @description  Detects incomplete YouTube queue navigation, hides stale page details, and exposes lightweight navigation diagnostics.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/Ci303/youtube-master-suite
// @supportURL   https://github.com/Ci303/youtube-master-suite/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    checkDelaysMs: [600, 1600, 3200],
    mismatchesBeforeWarning: 2,
    eventHistoryLimit: 20,
  });
  const STYLE_ID = "yt-page-coherence-style";
  const STALE_ATTRIBUTE = "data-yt-master-page-stale";
  const STATE_ATTRIBUTE = "data-yt-master-state";
  const EVENTS_ATTRIBUTE = "data-yt-master-events";
  const NOTICE_ID = "yt-master-page-coherence-notice";
  const COMMENTS_STALE_ATTRIBUTE = "data-iow-stale-video";
  const COMMENT_VIDEO_LINK_SELECTOR =
    'a[href*="/watch?"][href*="lc="], a[href*="youtube.com/watch?"][href*="lc="]';
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer[selected]",
    'ytd-playlist-panel-video-renderer[aria-selected="true"]',
    'ytd-playlist-panel-video-renderer[aria-current="true"]',
    "yt-playlist-panel-video-renderer[selected]",
    'yt-playlist-panel-video-renderer[aria-selected="true"]',
    'yt-playlist-panel-video-renderer[aria-current="true"]',
  ].join(",");
  const METADATA_TITLE_SELECTOR = [
    "ytd-watch-metadata h1 yt-formatted-string",
    "ytd-watch-metadata h1 .yt-core-attributed-string",
    "ytd-video-primary-info-renderer h1 yt-formatted-string",
  ].join(",");

  const navigationEvents = [];
  const checkTimers = new Map();
  let consecutiveMismatchChecks = 0;
  let stalePageData = false;

  const isWatchPath = () =>
    location.pathname === "/watch" || location.pathname.startsWith("/live/");

  const getVideoIdFromUrl = (value) => {
    if (!value) return "";

    try {
      const url = new URL(value, location.origin);
      if (url.pathname.startsWith("/live/")) {
        return url.pathname.split("/")[2] || "";
      }
      return url.searchParams.get("v") || "";
    } catch {
      return "";
    }
  };

  const getPlayerData = () => {
    const player = document.querySelector("#movie_player");
    try {
      return player?.getVideoData?.() || {};
    } catch {
      return {};
    }
  };

  const getFlexyVideoId = () => {
    const flexy = document.querySelector("ytd-watch-flexy");
    return (
      flexy?.data?.playerResponse?.videoDetails?.videoId ||
      flexy?.getAttribute("video-id") ||
      ""
    );
  };

  const getQueueState = () => {
    const item = document.querySelector(QUEUE_ITEM_SELECTOR);
    const link = item?.querySelector('a[href*="/watch?"], a[href^="/live/"]');
    return {
      videoId: getVideoIdFromUrl(link?.href || link?.getAttribute("href")),
      title: item?.querySelector("#video-title")?.textContent?.trim() || "",
    };
  };

  const getCommentVideoIds = (comments) => {
    if (!comments) return [];

    return [
      ...new Set(
        Array.from(comments.querySelectorAll(COMMENT_VIDEO_LINK_SELECTOR))
          .map((link) =>
            getVideoIdFromUrl(link.href || link.getAttribute("href")),
          )
          .filter(Boolean),
      ),
    ];
  };

  const buildSnapshot = () => {
    const playerData = getPlayerData();
    const queue = getQueueState();
    const comments = document.querySelector("ytd-comments");
    const urlVideoId = getVideoIdFromUrl(location.href);
    const playerVideoId = playerData.video_id || "";
    const flexyVideoId = getFlexyVideoId();
    const confirmedMismatch = Boolean(
      isWatchPath() &&
        urlVideoId &&
        playerVideoId &&
        flexyVideoId &&
        urlVideoId === playerVideoId &&
        flexyVideoId !== playerVideoId,
    );
    const confirmedCoherent = Boolean(
      !isWatchPath() ||
        (urlVideoId &&
          playerVideoId &&
          flexyVideoId &&
          urlVideoId === playerVideoId &&
          playerVideoId === flexyVideoId),
    );

    return {
      url: location.href,
      urlVideoId,
      playerVideoId,
      playerTitle: playerData.title || "",
      documentTitle: document.title,
      metadataTitle:
        document.querySelector(METADATA_TITLE_SELECTOR)?.textContent?.trim() ||
        "",
      flexyVideoId,
      queueVideoId: queue.videoId,
      queueTitle: queue.title,
      commentsPresent: Boolean(comments),
      commentsHiddenAsStale:
        comments?.getAttribute(COMMENTS_STALE_ATTRIBUTE) === "1",
      commentVideoIds: getCommentVideoIds(comments),
      confirmedMismatch,
      confirmedCoherent,
      stalePageData,
      mismatchChecks: consecutiveMismatchChecks,
    };
  };

  const publishState = (snapshot = buildSnapshot()) => {
    const root = document.documentElement;
    if (!root) return snapshot;

    root.setAttribute(STATE_ATTRIBUTE, JSON.stringify(snapshot));
    root.setAttribute(EVENTS_ATTRIBUTE, JSON.stringify(navigationEvents));
    return snapshot;
  };

  const removeNotice = () => {
    document.getElementById(NOTICE_ID)?.remove();
  };

  const ensureNotice = () => {
    if (!stalePageData || !isWatchPath()) {
      removeNotice();
      return;
    }

    let notice = document.getElementById(NOTICE_ID);
    if (notice?.isConnected) return;

    const metadata = document.querySelector(
      "ytd-watch-metadata, ytd-video-primary-info-renderer",
    );
    const parent = metadata?.parentElement || document.querySelector("#primary-inner");
    if (!parent) return;

    notice = document.createElement("section");
    notice.id = NOTICE_ID;
    notice.setAttribute("role", "status");

    const message = document.createElement("span");
    message.textContent =
      "YouTube did not update this video’s page details. The previous title and comments are hidden.";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reload page data";
    button.title = "Reloading may reset a temporary queue";
    button.addEventListener("click", () => location.reload());

    notice.append(message, button);
    parent.insertBefore(notice, metadata || parent.firstChild);
  };

  const setStalePageData = (stale) => {
    stalePageData = stale;
    const root = document.documentElement;
    if (root) {
      root.toggleAttribute(STALE_ATTRIBUTE, stale);
    }

    if (stale) {
      ensureNotice();
    } else {
      removeNotice();
    }
  };

  const runCoherenceCheck = () => {
    const snapshot = buildSnapshot();

    if (snapshot.confirmedMismatch) {
      consecutiveMismatchChecks += 1;
      if (consecutiveMismatchChecks >= CONFIG.mismatchesBeforeWarning) {
        setStalePageData(true);
      }
    } else if (snapshot.confirmedCoherent || !isWatchPath()) {
      consecutiveMismatchChecks = 0;
      setStalePageData(false);
    }

    if (stalePageData) ensureNotice();
    return publishState(buildSnapshot());
  };

  const clearScheduledChecks = () => {
    checkTimers.forEach((timerId) => clearTimeout(timerId));
    checkTimers.clear();
  };

  const scheduleChecks = () => {
    if (!isWatchPath()) {
      runCoherenceCheck();
      return;
    }

    CONFIG.checkDelaysMs.forEach((delay) => {
      if (checkTimers.has(delay)) return;

      const timerId = setTimeout(() => {
        checkTimers.delete(delay);
        runCoherenceCheck();
      }, delay);
      checkTimers.set(delay, timerId);
    });
  };

  const recordNavigationEvent = (type) => {
    const snapshot = buildSnapshot();
    navigationEvents.push({
      type,
      timestamp: Date.now(),
      urlVideoId: snapshot.urlVideoId,
      playerVideoId: snapshot.playerVideoId,
      flexyVideoId: snapshot.flexyVideoId,
    });
    if (navigationEvents.length > CONFIG.eventHistoryLimit) {
      navigationEvents.splice(0, navigationEvents.length - CONFIG.eventHistoryLimit);
    }
    publishState(snapshot);
  };

  const handleNavigateStart = () => {
    clearScheduledChecks();
    consecutiveMismatchChecks = 0;
    setStalePageData(false);
    recordNavigationEvent("yt-navigate-start");
  };

  const handleNavigationUpdate = (event) => {
    recordNavigationEvent(event.type);
    scheduleChecks();
  };

  const buildCss = () => `
    :root[${STALE_ATTRIBUTE}] ytd-watch-metadata,
    :root[${STALE_ATTRIBUTE}] ytd-video-primary-info-renderer,
    :root[${STALE_ATTRIBUTE}] ytd-video-secondary-info-renderer {
      display: none !important;
    }

    :root[${STALE_ATTRIBUTE}] ytd-comments {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    #${NOTICE_ID} {
      align-items: center !important;
      background: var(--yt-spec-raised-background, #272727) !important;
      border-radius: 12px !important;
      box-sizing: border-box !important;
      color: var(--yt-spec-text-primary, #fff) !important;
      display: flex !important;
      font: 500 14px/20px Roboto, Arial, sans-serif !important;
      gap: 12px !important;
      justify-content: space-between !important;
      margin: 12px 0 !important;
      padding: 12px 16px !important;
      width: 100% !important;
    }

    #${NOTICE_ID} button {
      background: var(--yt-spec-call-to-action, #3ea6ff) !important;
      border: 0 !important;
      border-radius: 18px !important;
      color: var(--yt-spec-static-brand-white, #fff) !important;
      cursor: pointer !important;
      flex: 0 0 auto !important;
      font: 500 14px/20px Roboto, Arial, sans-serif !important;
      padding: 8px 14px !important;
    }
  `;

  GM_addStyle(buildCss());

  globalThis.__YT_MASTER_STATE__ = Object.freeze({
    check: runCoherenceCheck,
    events: () => navigationEvents.map((entry) => ({ ...entry })),
    snapshot: () => publishState(buildSnapshot()),
  });

  window.addEventListener("yt-navigate-start", handleNavigateStart, true);
  window.addEventListener("yt-navigate-finish", handleNavigationUpdate, true);
  window.addEventListener("yt-page-data-updated", handleNavigationUpdate, true);
  window.addEventListener("pageshow", handleNavigationUpdate, true);
  document.addEventListener(
    "loadedmetadata",
    (event) => {
      if (!isWatchPath()) return;

      const player = document.querySelector("#movie_player");
      const activeVideo =
        player?.querySelector("video.html5-main-video") ||
        player?.querySelector("video");
      if (event.target !== activeVideo) return;

      recordNavigationEvent("loadedmetadata");
      scheduleChecks();
    },
    true,
  );

  publishState();
  scheduleChecks();
})();
