// ==UserScript==
// @name         YouTube Page Coherence Guard
// @namespace    Citizen.youtube.page-coherence
// @version      1.2
// @description  Detects incomplete YouTube queue navigation, hides stale page details, and provides bounded diagnostics and queue backup tools.
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
    queueBackupItemLimit: 100,
    queueTitleLengthLimit: 500,
    queueUrlLengthLimit: 2048,
  });
  const STYLE_ID = "yt-page-coherence-style";
  const STALE_ATTRIBUTE = "data-yt-master-page-stale";
  const STATE_ATTRIBUTE = "data-yt-master-state";
  const EVENTS_ATTRIBUTE = "data-yt-master-events";
  const NOTICE_ID = "yt-master-page-coherence-notice";
  const QUEUE_BACKUP_KEY = "yt-master-page-coherence-queue-backup-v1";
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
  const QUEUE_RENDERER_SELECTOR = [
    "ytd-playlist-panel-video-renderer",
    "yt-playlist-panel-video-renderer",
  ].join(",");
  const QUEUE_PANEL_SELECTOR = [
    "ytd-playlist-panel-renderer",
    "yt-playlist-panel-renderer",
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

  const getIdentityState = ({
    watchPath,
    urlVideoId,
    playerVideoId,
    flexyVideoId,
    queueVideoId,
  }) => {
    if (!watchPath) {
      return {
        status: "not-watch-page",
        reasons: ["not-watch-page"],
        comparisons: {},
      };
    }

    const pendingReasons = [];
    if (!urlVideoId) pendingReasons.push("url-video-id-pending");
    if (!playerVideoId) pendingReasons.push("player-video-id-pending");
    if (!flexyVideoId) pendingReasons.push("flexy-video-id-pending");

    const comparisons = {};
    const disagreementReasons = [];
    const compare = (name, leftId, rightId, disagreementReason) => {
      if (!leftId || !rightId) {
        comparisons[name] = null;
        return;
      }

      const agrees = leftId === rightId;
      comparisons[name] = agrees;
      if (!agrees) disagreementReasons.push(disagreementReason);
    };

    compare(
      "urlPlayer",
      urlVideoId,
      playerVideoId,
      "url-player-disagreement",
    );
    compare(
      "urlFlexy",
      urlVideoId,
      flexyVideoId,
      "url-flexy-disagreement",
    );
    compare(
      "playerFlexy",
      playerVideoId,
      flexyVideoId,
      "player-flexy-disagreement",
    );
    compare(
      "queueUrl",
      queueVideoId,
      urlVideoId,
      "selected-queue-url-disagreement",
    );
    compare(
      "queuePlayer",
      queueVideoId,
      playerVideoId,
      "selected-queue-player-disagreement",
    );
    compare(
      "queueFlexy",
      queueVideoId,
      flexyVideoId,
      "selected-queue-flexy-disagreement",
    );

    const reasons = [...disagreementReasons, ...pendingReasons];
    return {
      status: disagreementReasons.length
        ? "disagreement"
        : pendingReasons.length
          ? "pending"
          : "coherent",
      reasons: reasons.length ? reasons : ["all-available-identities-agree"],
      comparisons,
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
    const watchPath = isWatchPath();
    const identity = getIdentityState({
      watchPath,
      urlVideoId,
      playerVideoId,
      flexyVideoId,
      queueVideoId: queue.videoId,
    });
    const confirmedMismatch = Boolean(
      watchPath &&
        urlVideoId &&
        playerVideoId &&
        flexyVideoId &&
        urlVideoId === playerVideoId &&
        flexyVideoId !== playerVideoId,
    );
    const confirmedCoherent = Boolean(
      !watchPath ||
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
      identityStatus: identity.status,
      identityReasons: identity.reasons,
      identityComparisons: identity.comparisons,
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

  const normaliseQueueUrl = (value) => {
    if (!value) return "";

    try {
      const url = new URL(value, location.origin);
      url.hash = "";
      return url.href.slice(0, CONFIG.queueUrlLengthLimit);
    } catch {
      return "";
    }
  };

  const captureQueue = () => {
    const selectedItems = Array.from(
      document.querySelectorAll(QUEUE_ITEM_SELECTOR),
    );
    const selectedItem =
      selectedItems.find((candidate) => candidate.getClientRects().length > 0) ||
      selectedItems[0];
    const panel =
      selectedItem?.closest(QUEUE_PANEL_SELECTOR) ||
      Array.from(document.querySelectorAll(QUEUE_PANEL_SELECTOR)).find((candidate) =>
        candidate.querySelector(QUEUE_RENDERER_SELECTOR),
      );
    const renderers = panel
      ? Array.from(panel.querySelectorAll(QUEUE_RENDERER_SELECTOR))
      : [];
    const items = [];
    let currentIndex = -1;

    renderers.forEach((renderer) => {
      const link = renderer.querySelector(
        'a#wc-endpoint, a[href*="/watch?"], a[href^="/live/"]',
      );
      const url = normaliseQueueUrl(link?.href || link?.getAttribute("href"));
      if (!url) return;

      if (renderer === selectedItem) currentIndex = items.length;
      items.push({
        title: (
          renderer.querySelector("#video-title")?.textContent?.trim() ||
          link?.getAttribute("aria-label")?.trim() ||
          "Untitled video"
        ).slice(0, CONFIG.queueTitleLengthLimit),
        url,
      });
    });

    if (currentIndex < 0) {
      const activeVideoId = getVideoIdFromUrl(location.href);
      currentIndex = items.findIndex(
        (item) => getVideoIdFromUrl(item.url) === activeVideoId,
      );
    }

    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      sourceUrl: location.href.slice(0, CONFIG.queueUrlLengthLimit),
      currentIndex,
      items,
    };
  };

  const storeQueueBackup = (queue) => {
    if (!queue.items.length) return false;

    const boundedItems = queue.items.slice(0, CONFIG.queueBackupItemLimit);
    const boundedQueue = {
      ...queue,
      sourceItemCount: queue.items.length,
      truncated: queue.items.length > CONFIG.queueBackupItemLimit,
      currentIndex:
        queue.currentIndex >= 0 && queue.currentIndex < boundedItems.length
          ? queue.currentIndex
          : -1,
      items: boundedItems,
    };

    try {
      sessionStorage.setItem(QUEUE_BACKUP_KEY, JSON.stringify(boundedQueue));
      return true;
    } catch {
      return false;
    }
  };

  const formatQueue = (queue) => {
    const currentPosition =
      queue.currentIndex >= 0
        ? `${queue.currentIndex + 1} of ${queue.items.length}`
        : "unknown";
    const lines = [
      "YouTube queue backup",
      `Captured: ${queue.capturedAt}`,
      `Current item: ${currentPosition}`,
      "",
    ];

    queue.items.forEach((item, index) => {
      const marker = index === queue.currentIndex ? ">" : " ";
      lines.push(`${marker} ${index + 1}. ${item.title}`, `  ${item.url}`);
    });
    return lines.join("\n");
  };

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Fall through to the document-command fallback.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    document.body.append(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  };

  const readJsonAttribute = (name) => {
    const value = document.documentElement?.getAttribute(name);
    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const buildDiagnosticsExport = () => {
    const state = readJsonAttribute(STATE_ATTRIBUTE);
    const safeState = state && typeof state === "object" ? { ...state } : state;
    if (safeState) delete safeState.commentVideoIds;

    return JSON.stringify(
      {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        health: readJsonAttribute("data-yt-master-suite"),
        runtimeErrors: readJsonAttribute("data-yt-master-runtime-errors"),
        state: safeState,
        events: readJsonAttribute(EVENTS_ATTRIBUTE),
      },
      null,
      2,
    );
  };

  const setNoticeFeedback = (notice, message, error = false) => {
    const feedback = notice.querySelector(".yt-master-page-coherence-feedback");
    if (!feedback) return;

    feedback.textContent = message;
    feedback.hidden = false;
    feedback.toggleAttribute("data-error", error);
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
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-labelledby", `${NOTICE_ID}-message`);

    const message = document.createElement("span");
    message.id = `${NOTICE_ID}-message`;
    message.className = "yt-master-page-coherence-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.setAttribute("aria-atomic", "true");
    message.textContent =
      "YouTube did not update this video’s page details. The previous title and comments are hidden.";

    const actions = document.createElement("div");
    actions.className = "yt-master-page-coherence-actions";

    const copyQueueButton = document.createElement("button");
    copyQueueButton.type = "button";
    copyQueueButton.textContent = "Copy queue";
    copyQueueButton.addEventListener("click", async () => {
      const queue = captureQueue();
      if (!queue.items.length) {
        setNoticeFeedback(notice, "No active queue was found.", true);
        return;
      }

      copyQueueButton.disabled = true;
      const backedUp = storeQueueBackup(queue);
      const copied = await copyText(formatQueue(queue));
      copyQueueButton.disabled = false;

      if (copied && backedUp) {
        setNoticeFeedback(
          notice,
          queue.items.length > CONFIG.queueBackupItemLimit
            ? `Queue copied; the first ${CONFIG.queueBackupItemLimit} items were backed up for this tab.`
            : "Queue copied and backed up for this tab.",
        );
      } else if (copied) {
        setNoticeFeedback(
          notice,
          "Queue copied, but this tab blocked the session backup.",
          true,
        );
      } else if (backedUp) {
        setNoticeFeedback(
          notice,
          "Queue backed up for this tab, but clipboard copying failed.",
          true,
        );
      } else {
        setNoticeFeedback(notice, "Queue export failed.", true);
      }
    });

    const copyDiagnosticsButton = document.createElement("button");
    copyDiagnosticsButton.type = "button";
    copyDiagnosticsButton.textContent = "Copy diagnostics";
    copyDiagnosticsButton.addEventListener("click", async () => {
      copyDiagnosticsButton.disabled = true;
      const copied = await copyText(buildDiagnosticsExport());
      copyDiagnosticsButton.disabled = false;
      setNoticeFeedback(
        notice,
        copied ? "Diagnostics copied." : "Diagnostics clipboard copy failed.",
        !copied,
      );
    });

    const reloadButton = document.createElement("button");
    reloadButton.type = "button";
    reloadButton.textContent = "Reload page data";
    reloadButton.title = "Reloading may reset a temporary queue";
    reloadButton.addEventListener("click", () => {
      const queue = captureQueue();
      const backedUp = storeQueueBackup(queue);
      setNoticeFeedback(
        notice,
        queue.items.length
          ? backedUp
            ? queue.items.length > CONFIG.queueBackupItemLimit
              ? `First ${CONFIG.queueBackupItemLimit} queue items backed up. Reloading page data…`
              : "Queue backed up. Reloading page data…"
            : "Queue backup unavailable. Reloading page data…"
          : "Reloading page data…",
        queue.items.length > 0 && !backedUp,
      );
      setTimeout(() => location.reload(), 50);
    });

    const feedback = document.createElement("span");
    feedback.className = "yt-master-page-coherence-feedback";
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");
    feedback.hidden = true;

    actions.append(copyQueueButton, copyDiagnosticsButton, reloadButton);

    notice.append(message, actions, feedback);
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
    snapshot.stalePageData = stalePageData;
    snapshot.mismatchChecks = consecutiveMismatchChecks;
    return publishState(snapshot);
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
      queueVideoId: snapshot.queueVideoId,
      identityStatus: snapshot.identityStatus,
      identityReasons: snapshot.identityReasons,
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
      flex-wrap: wrap !important;
      font: 500 14px/20px Roboto, Arial, sans-serif !important;
      gap: 12px !important;
      justify-content: space-between !important;
      margin: 12px 0 !important;
      padding: 12px 16px !important;
      width: 100% !important;
    }

    #${NOTICE_ID} .yt-master-page-coherence-message {
      flex: 1 1 320px !important;
    }

    #${NOTICE_ID} .yt-master-page-coherence-actions {
      display: flex !important;
      flex: 0 1 auto !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
      justify-content: flex-end !important;
    }

    #${NOTICE_ID} .yt-master-page-coherence-feedback {
      color: var(--yt-spec-text-secondary, #aaa) !important;
      flex: 1 0 100% !important;
      font: 400 12px/18px Roboto, Arial, sans-serif !important;
    }

    #${NOTICE_ID} .yt-master-page-coherence-feedback[data-error] {
      color: var(--yt-spec-error-indicator, #ff4e45) !important;
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

    #${NOTICE_ID} button:disabled {
      cursor: wait !important;
      opacity: 0.65 !important;
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
