// ==UserScript==
// @name         YouTube Watch Layout Cleaner
// @namespace    Citizen.youtube.watch-layout-cleaner
// @version      1.25
// @description  Expands YouTube watch pages, keeps the right rail fixed at SponsorBlock-friendly width, and widens metadata/comments.
// @author       Citizen
// @homepageURL  https://github.com/Ci303/youtube-watch-layout-cleaner
// @supportURL   https://github.com/Ci303/youtube-watch-layout-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-watch-layout-cleaner/main/youtube-watch-layout-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-watch-layout-cleaner/main/youtube-watch-layout-cleaner.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const CONFIG = {
    sidebarWidthPx: 374,
    queueLayoutBreakpointPx: 1000,
    relatedVideosHideBreakpointPx: 1400,
  };

  const STYLE_ID = "tm-youtube-watch-layout-cleaner";
  const PLAYLIST_PANEL_SELECTOR = "ytd-playlist-panel-renderer";
  const QUEUE_THUMBNAIL_FALLBACK_DELAYS_MS = [750, 1500];
  const QUEUE_ITEM_SELECTOR = [
    "ytd-playlist-panel-video-renderer",
    "yt-playlist-panel-video-renderer",
  ].join(",");
  const QUEUE_THUMBNAIL_TARGET_SELECTOR = [
    "a#thumbnail",
    "ytd-thumbnail",
    "yt-thumbnail-view-model",
    ".ytThumbnailViewModelHost",
  ].join(",");
  const QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE =
    "data-ywlc-thumbnail-fallback";
  const QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY =
    "--ywlc-thumbnail-fallback-image";
  const QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN = "200px 0px";
  const WATCH_FLEXY_SELECTORS = [
    "ytd-watch-flexy[flexy]",
    "ytd-watch-flexy[flexy_]",
    "ytd-watch-flexy[is-two-columns]",
    "ytd-watch-flexy[is-two-columns_]",
    "ytd-watch-flexy[theater]",
    "ytd-watch-flexy[theatre]",
    "ytd-watch-flexy[is-watch-wide]",
  ];
  const WATCH_FLEXY_SELECTOR = WATCH_FLEXY_SELECTORS.join(",\n");
  const TWO_COLUMN_WATCH_FLEXY_SELECTOR = [
    "ytd-watch-flexy[is-two-columns]",
    "ytd-watch-flexy[is-two-columns_]",
  ].join(",\n");
  const COLLAPSED_CHAT_WITHOUT_QUEUE_SELECTOR = [
    "ytd-watch-flexy[is-two-columns]:has(ytd-live-chat-frame#chat[collapsed]):not(:has(ytd-playlist-panel-renderer))",
    "ytd-watch-flexy[is-two-columns_]:has(ytd-live-chat-frame#chat[collapsed]):not(:has(ytd-playlist-panel-renderer))",
  ].join(",\n");
  let queueThumbnailFallbackTimers = [];
  let queueThumbnailFallbackObserver = null;

  function px(value) {
    return `${value}px`;
  }

  function watchFlexyChildSelector(...childSelectors) {
    return WATCH_FLEXY_SELECTORS.flatMap((watchSelector) =>
      childSelectors.map(
        (childSelector) => `${watchSelector} ${childSelector}`,
      ),
    ).join(",\n");
  }

  function buildCss() {
    return `
/* Watch pages only. Keeps the right rail while allowing the player column to use wide screens. */
${WATCH_FLEXY_SELECTOR}{
  --ytd-watch-flexy-max-player-width: none !important;
  --ytd-watch-flexy-max-player-width-wide-screen: none !important;
}

@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {
  ${TWO_COLUMN_WATCH_FLEXY_SELECTOR}{
    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;
  }
}

/* At half-screen, a collapsed chat must not leave an empty sidebar behind. */
@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) and (max-width: ${px(CONFIG.relatedVideosHideBreakpointPx)}) {
  ${COLLAPSED_CHAT_WITHOUT_QUEUE_SELECTOR}{
    --ytd-watch-flexy-sidebar-width: 0px !important;
  }
}

${watchFlexyChildSelector("#columns.ytd-watch-flexy")}{
  max-width: none !important;
  box-sizing: border-box !important;
}

${watchFlexyChildSelector("#primary.ytd-watch-flexy")}{
  flex: 1 1 auto !important;
  min-width: 0 !important;
  max-width: none !important;
}

${watchFlexyChildSelector(
  "#primary-inner.ytd-watch-flexy",
  "#above-the-fold",
  "#description",
  "#top-row",
  "#player.ytd-watch-flexy",
  "#player-container-outer.ytd-watch-flexy",
)}{
  box-sizing: border-box !important;
  width: 100% !important;
  max-width: none !important;
}

ytd-comments #sections {
  margin-right: 0 !important;
}

ytd-comments,
ytd-comments ytd-item-section-renderer,
ytd-comments ytd-comment-thread-renderer {
  max-width: 100% !important;
}

ytd-playlist-panel-renderer [${QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE}="1"] {
  background-image: var(${QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY}) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
}

/* Leave only comments below the video once YouTube switches to its narrow layout. */
@media (max-width: ${px(CONFIG.relatedVideosHideBreakpointPx)}) {
  #related {
    display: none !important;
  }
}
`;
  }

  function isWatchPath() {
    return location.pathname === "/watch" || location.pathname.startsWith("/live/");
  }

  function ensureStyle() {
    if (!isWatchPath()) {
      removeStyle();
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    const css = buildCss();
    if (style.textContent !== css) style.textContent = css;
  }

  function removeStyle() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function getQueueItemVideoId(item) {
    const links = item.querySelectorAll('a[href*="/watch"]');

    for (const link of links) {
      let videoId = "";
      try {
        videoId = new URL(link.href || link.getAttribute("href"), location.origin)
          .searchParams.get("v") || "";
      } catch {
        continue;
      }

      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) return videoId;
    }

    return "";
  }

  function hasLoadedQueueThumbnail(item) {
    return Array.from(item.querySelectorAll("img")).some((image) => {
      if (!image.complete || image.naturalWidth <= 0) return false;

      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0
      );
    });
  }

  function clearQueueThumbnailFallback(item) {
    item.querySelectorAll(
      `[${QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE}="1"]`,
    ).forEach((target) => {
      target.removeAttribute(QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE);
      target.style.removeProperty(QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY);
    });
  }

  function applyQueueThumbnailFallback(item) {
    if (hasLoadedQueueThumbnail(item)) {
      clearQueueThumbnailFallback(item);
      return;
    }

    const videoId = getQueueItemVideoId(item);
    if (!videoId) return;

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    item.querySelectorAll(QUEUE_THUMBNAIL_TARGET_SELECTOR).forEach(
      (target) => {
        target.setAttribute(QUEUE_THUMBNAIL_FALLBACK_ATTRIBUTE, "1");
        target.style.setProperty(
          QUEUE_THUMBNAIL_FALLBACK_CSS_PROPERTY,
          `url("${thumbnailUrl}")`,
        );
      },
    );
  }

  function getQueueThumbnailFallbackObserver() {
    if (
      queueThumbnailFallbackObserver ||
      typeof IntersectionObserver !== "function"
    ) {
      return queueThumbnailFallbackObserver;
    }

    queueThumbnailFallbackObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          observer.unobserve(entry.target);
          if (!entry.target.isConnected || !isWatchPath()) return;
          applyQueueThumbnailFallback(entry.target);
        });
      },
      { rootMargin: QUEUE_THUMBNAIL_FALLBACK_ROOT_MARGIN },
    );

    return queueThumbnailFallbackObserver;
  }

  function applyQueueThumbnailFallbacks() {
    if (!isWatchPath()) return;

    const observer = getQueueThumbnailFallbackObserver();
    document.querySelectorAll(PLAYLIST_PANEL_SELECTOR).forEach((panel) => {
      panel.querySelectorAll(QUEUE_ITEM_SELECTOR).forEach((item) => {
        if (observer) {
          observer.observe(item);
        } else {
          applyQueueThumbnailFallback(item);
        }
      });
    });
  }

  function scheduleQueueThumbnailFallbacks() {
    if (queueThumbnailFallbackObserver) {
      queueThumbnailFallbackObserver.disconnect();
      queueThumbnailFallbackObserver.takeRecords();
    }
    queueThumbnailFallbackTimers.forEach((timerId) => clearTimeout(timerId));
    queueThumbnailFallbackTimers = QUEUE_THUMBNAIL_FALLBACK_DELAYS_MS.map(
      (delay) => setTimeout(applyQueueThumbnailFallbacks, delay),
    );
  }

  ensureStyle();
  scheduleQueueThumbnailFallbacks();

  const narrowLayoutMediaQuery = matchMedia(
    `(max-width: ${px(CONFIG.queueLayoutBreakpointPx)})`,
  );
  narrowLayoutMediaQuery.addEventListener(
    "change",
    scheduleQueueThumbnailFallbacks,
  );

  // YouTube is an SPA; re-apply after in-site navigation
  window.addEventListener(
    "yt-navigate-finish",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
  window.addEventListener(
    "yt-page-data-updated",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
  window.addEventListener(
    "pageshow",
    () => {
      ensureStyle();
      scheduleQueueThumbnailFallbacks();
    },
    true,
  );
})();
