// ==UserScript==
// @name         YouTube Comment Cleaner
// @namespace    Citizen.youtube.comment-cleaner
// @version      1.15
// @description  Cleans YouTube comments, prevents stale comments across SPA navigation, preserves replies, compacts spacing, and colours commenter/uploader names.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/Ci303/youtube-comment-cleaner
// @supportURL   https://github.com/Ci303/youtube-comment-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-comment-cleaner/main/youtube-comment-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-comment-cleaner/main/youtube-comment-cleaner.user.js
// @run-at       document-idle
// @match        *://www.youtube.com/*
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const COMMENTER_BLUE = "#82a3e6";
  const UPLOADER_ORANGE = "#ff9f1c";
  const CONFIG = {
    hideCommentControls: true,
    colourCommenters: true,
    compactComments: true,
  };

  const COMMENT_CONTROL_SELECTORS = [
    "ytd-comment-renderer ytd-comment-engagement-bar#action-buttons",
    "ytd-comment-renderer #like-button",
    "ytd-comment-renderer #dislike-button",
    "ytd-comment-renderer #vote-count-left",
    "ytd-comment-renderer #vote-count-middle",
    "ytd-comment-renderer like-button-view-model",
    "ytd-comment-renderer dislike-button-view-model",
    "ytd-comment-renderer #reply-button-end",
    "ytd-comment-renderer #action-menu",
    "ytd-comment-renderer ytd-menu-renderer",
    "ytd-comment-view-model ytd-comment-engagement-bar#action-buttons",
    "ytd-comment-view-model #like-button",
    "ytd-comment-view-model #dislike-button",
    "ytd-comment-view-model #vote-count-left",
    "ytd-comment-view-model #vote-count-middle",
    "ytd-comment-view-model like-button-view-model",
    "ytd-comment-view-model dislike-button-view-model",
    "ytd-comment-view-model #reply-button-end",
    "ytd-comment-view-model #action-menu",
    "ytd-comment-view-model ytd-menu-renderer",
    "yt-comment-view-model ytd-comment-engagement-bar#action-buttons",
    "yt-comment-view-model #like-button",
    "yt-comment-view-model #dislike-button",
    "yt-comment-view-model #vote-count-left",
    "yt-comment-view-model #vote-count-middle",
    "yt-comment-view-model like-button-view-model",
    "yt-comment-view-model dislike-button-view-model",
    "yt-comment-view-model #reply-button-end",
    "yt-comment-view-model #action-menu",
    "yt-comment-view-model ytd-menu-renderer",
    "ytd-comments #reply-dialog",
    "ytd-comments #simple-box",
    "ytd-comments #teaser-carousel",
    "ytd-comment-renderer #reply-dialog",
    "ytd-comment-renderer #simple-box",
    "ytd-comment-renderer #teaser-carousel",
    "ytd-comment-view-model #reply-dialog",
    "ytd-comment-view-model #simple-box",
    "ytd-comment-view-model #teaser-carousel",
    "yt-comment-view-model #reply-dialog",
    "yt-comment-view-model #simple-box",
    "yt-comment-view-model #teaser-carousel",
  ];

  const COMMENT_CONTROL_SELECTOR = COMMENT_CONTROL_SELECTORS.join(",");

  const COMMENT_OVERFLOW_BUTTON_SELECTORS = [
    'ytd-comment-renderer yt-icon-button > button#button[aria-label*="Action menu" i]',
    'ytd-comment-renderer yt-icon-button > button#button[aria-label*="More actions" i]',
    'ytd-comment-renderer yt-icon-button > button#button[aria-label*="More options" i]',
    'ytd-comment-view-model yt-icon-button > button#button[aria-label*="Action menu" i]',
    'ytd-comment-view-model yt-icon-button > button#button[aria-label*="More actions" i]',
    'ytd-comment-view-model yt-icon-button > button#button[aria-label*="More options" i]',
    'yt-comment-view-model yt-icon-button > button#button[aria-label*="Action menu" i]',
    'yt-comment-view-model yt-icon-button > button#button[aria-label*="More actions" i]',
    'yt-comment-view-model yt-icon-button > button#button[aria-label*="More options" i]',
  ];

  const COMMENT_OVERFLOW_BUTTON_SELECTOR =
    COMMENT_OVERFLOW_BUTTON_SELECTORS.join(",");

  const COMMENT_AUTHOR_SELECTOR = `
    ytd-comments a[href^="/@"],
    ytd-comments a[href^="https://www.youtube.com/@"]
  `;
  const COMMENT_VIDEO_LINK_SELECTOR =
    'a[href*="/watch?"][href*="lc="], a[href*="youtube.com/watch?"][href*="lc="]';
  const STALE_COMMENTS_ATTRIBUTE = "data-iow-stale-video";

  const COMMENT_MUTATION_SURFACE_SELECTOR = [
    "ytd-comments",
    "ytd-comments-header-renderer",
    "ytd-comment-thread-renderer",
    "ytd-comment-renderer",
    "ytd-comment-view-model",
    "yt-comment-view-model",
    "ytd-comment-replies-renderer",
  ].join(",");
  const UPLOADER_SOURCE_SELECTOR = [
    "ytd-watch-metadata #owner",
    "ytd-watch-flexy ytd-video-owner-renderer",
    "ytd-watch-flexy #upload-info",
  ].join(",");
  const UPLOADER_PATHS_FALLBACK_DELAY_MS = 3000;

  let scheduled = false;
  let delayedScheduled = false;
  const pendingApplyRoots = new Set();
  let lastVideoKey = "";
  let cachedUploaderPaths = new Set();
  let uploaderPathsReadyVideoKey = "";
  let uploaderPathsFallbackTimer = 0;
  let observing = false;
  let commentsVideoGuardPending = false;

  const isWatchPath = () =>
    location.pathname === "/watch" || location.pathname.startsWith("/live/");

  const queryAllDeep = (sel, root = document) => {
    const out = [];

    const crawl = (node) => {
      if (!node || !node.querySelectorAll) return;

      if (node.matches && node.matches(sel)) out.push(node);

      node.querySelectorAll(sel).forEach((n) => out.push(n));
      node.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) crawl(el.shadowRoot);
      });
    };

    crawl(root);
    return out;
  };

  const normalisePath = (href) => {
    if (!href) return "";

    try {
      return new URL(href, location.origin).pathname.toLowerCase();
    } catch {
      return href.toLowerCase();
    }
  };

  const getText = (el) => {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  };

  const getVideoKey = () => {
    const url = new URL(location.href);
    return `${url.pathname}?v=${url.searchParams.get("v") || ""}`;
  };

  const getCurrentVideoId = () => {
    const url = new URL(location.href);
    if (url.pathname === "/watch") {
      return url.searchParams.get("v") || "";
    }
    if (url.pathname.startsWith("/live/")) {
      return url.pathname.split("/")[2] || "";
    }
    return "";
  };

  const getCommentsVideoId = (comments) => {
    if (!comments) return "";

    for (const link of comments.querySelectorAll(COMMENT_VIDEO_LINK_SELECTOR)) {
      try {
        const videoId = new URL(
          link.href || link.getAttribute("href"),
          location.origin,
        ).searchParams.get("v");
        if (videoId) return videoId;
      } catch {}
    }
    return "";
  };

  const getCommentContainers = (root = document) => {
    const containers = new Set();
    if (!root || !root.querySelectorAll) return containers;

    if (root.matches?.("ytd-comments")) containers.add(root);
    root.querySelectorAll("ytd-comments").forEach((comments) =>
      containers.add(comments),
    );
    const closestComments = root.closest?.("ytd-comments");
    if (closestComments) containers.add(closestComments);
    return containers;
  };

  const markCurrentCommentsStale = () => {
    commentsVideoGuardPending = true;
    getCommentContainers(document).forEach((comments) =>
      comments.setAttribute(STALE_COMMENTS_ATTRIBUTE, "1"),
    );
  };

  const syncCommentsVideoGuard = (root = document) => {
    const currentVideoId = getCurrentVideoId();
    if (!currentVideoId) commentsVideoGuardPending = false;

    getCommentContainers(root).forEach((comments) => {
      if (!currentVideoId) {
        comments.removeAttribute(STALE_COMMENTS_ATTRIBUTE);
        return;
      }

      const commentsVideoId = getCommentsVideoId(comments);
      if (!commentsVideoId) {
        if (commentsVideoGuardPending) {
          comments.setAttribute(STALE_COMMENTS_ATTRIBUTE, "1");
        }
        return;
      }

      const stale = commentsVideoId !== currentVideoId;
      comments.toggleAttribute(STALE_COMMENTS_ATTRIBUTE, stale);
      if (!stale) commentsVideoGuardPending = false;
    });
  };

  const clearUploaderPathsFallback = () => {
    if (!uploaderPathsFallbackTimer) return;

    clearTimeout(uploaderPathsFallbackTimer);
    uploaderPathsFallbackTimer = 0;
  };

  const invalidateCachedUploaderPaths = () => {
    lastVideoKey = "";
    cachedUploaderPaths = new Set();
  };

  const invalidateUploaderPaths = () => {
    clearUploaderPathsFallback();
    invalidateCachedUploaderPaths();
    uploaderPathsReadyVideoKey = "";
  };

  const markUploaderPathsReady = () => {
    clearUploaderPathsFallback();
    lastVideoKey = "";
    cachedUploaderPaths = new Set();
    uploaderPathsReadyVideoKey = getVideoKey();
  };

  const readUploaderPaths = () => {
    const paths = new Set();

    document
      .querySelectorAll(
        `
      ytd-watch-metadata #owner a[href^="/@"],
      ytd-watch-flexy ytd-video-owner-renderer a[href^="/@"],
      ytd-watch-flexy #upload-info a[href^="/@"]
    `,
      )
      .forEach((a) => {
        const path = normalisePath(a.getAttribute("href"));
        if (path.startsWith("/@")) paths.add(path);
      });

    document
      .querySelectorAll(
        `
      ytd-pinned-comment-badge-renderer,
      #pinned-comment-badge
    `,
      )
      .forEach((el) => {
        const matches = getText(el).match(/@[A-Za-z0-9._-]+/g) || [];

        matches.forEach((handle) => {
          paths.add("/" + handle.toLowerCase());
        });
      });

    return paths;
  };

  const getUploaderPaths = () => {
    const videoKey = getVideoKey();

    if (videoKey !== lastVideoKey || !cachedUploaderPaths.size) {
      lastVideoKey = videoKey;
      cachedUploaderPaths = readUploaderPaths();
    }

    return cachedUploaderPaths;
  };

  const setLinkColour = (link, colour) => {
    if (link.dataset.iowColour !== colour) {
      link.style.setProperty("color", colour, "important");
      link.style.setProperty("-webkit-text-fill-color", colour, "important");
      link.style.setProperty("font-weight", "700", "important");
      link.style.setProperty("opacity", "1", "important");
      link.dataset.iowColour = colour;
    }

    link
      .querySelectorAll(
        "span, yt-formatted-string, yt-attributed-string, .yt-core-attributed-string",
      )
      .forEach((child) => {
        child.style.setProperty("color", colour, "important");
        child.style.setProperty("-webkit-text-fill-color", colour, "important");
        child.style.setProperty("font-weight", "700", "important");
        child.style.setProperty("opacity", "1", "important");
      });
  };

  const colourCommentAuthorLinks = (root = document) => {
    if (uploaderPathsReadyVideoKey !== getVideoKey()) return;

    const uploaderPaths = getUploaderPaths();

    queryAllDeep(COMMENT_AUTHOR_SELECTOR, root).forEach((link) => {
      const path = normalisePath(link.getAttribute("href"));
      const colour = uploaderPaths.has(path) ? UPLOADER_ORANGE : COMMENTER_BLUE;

      setLinkColour(link, colour);
    });
  };

  const hideNode = (el) => {
    if (el.dataset.iowHidden === "1") return;

    el.setAttribute("hidden", "");
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("padding", "0", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("min-height", "0", "important");
    el.dataset.iowHidden = "1";
  };

  const hideCommentControls = (root = document) => {
    queryAllDeep(COMMENT_CONTROL_SELECTOR, root).forEach(hideNode);

    queryAllDeep(COMMENT_OVERFLOW_BUTTON_SELECTOR, root).forEach((button) => {
      const rootNode = button.getRootNode && button.getRootNode();
      const shadowHost =
        rootNode && rootNode.host && rootNode.host.matches("yt-icon-button")
          ? rootNode.host
          : null;
      const host = button.closest("yt-icon-button") || shadowHost;

      hideNode(host || button);
    });
  };

  const applyAll = (root = document) => {
    if (!isWatchPath()) return;

    const applyRoot =
      root === document ? document.querySelector("ytd-comments") || root : root;

    if (CONFIG.hideCommentControls) hideCommentControls(applyRoot);
    if (CONFIG.colourCommenters) colourCommentAuthorLinks(applyRoot);
  };

  const buildHideRule = (selectors) => `
${selectors.join(",\n")} {
  display:none !important;
  margin:0 !important;
  padding:0 !important;
  height:0 !important;
  min-height:0 !important;
}
`;

  const buildBaseCss = () => `
/* Shared colours */
:root {
  --commenter-blue: ${COMMENTER_BLUE};
  --uploader-orange: ${UPLOADER_ORANGE};
}

/* Compact comments header */
ytd-comments-header-renderer {
  margin-top:2px !important;
  margin-bottom:2px !important;
}

/* Keep stale SPA comments out of view without collapsing YouTube's lazy-load area. */
ytd-comments[${STALE_COMMENTS_ATTRIBUTE}="1"] {
  visibility:hidden !important;
  opacity:0 !important;
  pointer-events:none !important;
}
`;

  const buildCommentControlsCss = () => {
    return CONFIG.hideCommentControls
      ? `/* Collapse engagement/action areas */${buildHideRule(COMMENT_CONTROL_SELECTORS)}
/* Hide per-comment overflow buttons */${buildHideRule(COMMENT_OVERFLOW_BUTTON_SELECTORS)}`
      : "";
  };

  const buildCompactCommentsCss = () => {
    if (!CONFIG.compactComments) return "";

    return `
/* Tighten comment spacing */
ytd-comment-renderer #main,
ytd-comment-view-model #main,
yt-comment-view-model #main {
  margin:0 !important;
}

ytd-comment-renderer #body,
ytd-comment-view-model #body,
yt-comment-view-model #body {
  margin:0 !important;
  padding:0 !important;
}

ytd-comment-renderer #footer,
ytd-comment-view-model #footer,
yt-comment-view-model #footer {
  margin:0 !important;
  padding:0 !important;
}
`;
  };

  const buildColourCommentsCss = () => {
    if (!CONFIG.colourCommenters) return "";

    return `
/* All normal commenter/channel links inside comments: blue */
ytd-comments a[href^="/@"],
ytd-comments a[href^="https://www.youtube.com/@"] {
  color:var(--commenter-blue) !important;
  -webkit-text-fill-color:var(--commenter-blue) !important;
  font-weight:700 !important;
  opacity:1 !important;
}

/* Pinned-by line: orange */
ytd-pinned-comment-badge-renderer,
ytd-pinned-comment-badge-renderer a,
ytd-pinned-comment-badge-renderer yt-formatted-string,
ytd-comment-renderer #pinned-comment-badge,
ytd-comment-renderer #pinned-comment-badge a,
ytd-comment-renderer #pinned-comment-badge yt-formatted-string,
ytd-comment-view-model #pinned-comment-badge,
ytd-comment-view-model #pinned-comment-badge a,
ytd-comment-view-model #pinned-comment-badge yt-formatted-string,
yt-comment-view-model #pinned-comment-badge,
yt-comment-view-model #pinned-comment-badge a,
yt-comment-view-model #pinned-comment-badge yt-formatted-string {
  color:var(--uploader-orange) !important;
  -webkit-text-fill-color:var(--uploader-orange) !important;
  background:transparent !important;
  font-weight:700 !important;
}

/* Creator/owner badge only: orange */
ytd-author-comment-badge-renderer,
ytd-author-comment-badge-renderer a,
ytd-author-comment-badge-renderer yt-formatted-string,
#author-comment-badge,
#author-comment-badge a,
#author-comment-badge yt-formatted-string {
  color:var(--uploader-orange) !important;
  -webkit-text-fill-color:var(--uploader-orange) !important;
  background:transparent !important;
  font-weight:700 !important;
  --yt-basic-background-color:transparent !important;
  --yt-basic-foreground-title-color:var(--uploader-orange) !important;
}

/* Neutralise badge chip backgrounds */
ytd-comment-renderer #header-badge,
ytd-comment-renderer #header-author-badges,
ytd-comment-view-model #header-badge,
ytd-comment-view-model #header-author-badges,
yt-comment-view-model #header-badge,
yt-comment-view-model #header-author-badges {
  background:transparent !important;
}
`;
  };

  const buildCss = () =>
    [
      buildBaseCss(),
      buildCommentControlsCss(),
      buildCompactCommentsCss(),
      buildColourCommentsCss(),
    ]
      .filter((css) => css.trim())
      .join("\n");

  const addPendingApplyRoot = (root) => {
    if (!root || !root.querySelectorAll) return;

    for (const pendingRoot of Array.from(pendingApplyRoots)) {
      if (pendingRoot === root || pendingRoot.contains(root)) return;
      if (root.contains(pendingRoot)) pendingApplyRoots.delete(pendingRoot);
    }

    pendingApplyRoots.add(root);
  };

  const scheduleApply = (root = document) => {
    if (!isWatchPath()) return;
    addPendingApplyRoot(root);
    if (!pendingApplyRoots.size) return;
    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      const roots = Array.from(pendingApplyRoots);
      pendingApplyRoots.clear();
      roots.forEach((pendingRoot) => {
        if (pendingRoot.isConnected !== false) applyAll(pendingRoot);
      });
    });
  };

  const scheduleDelayedApply = () => {
    if (!isWatchPath()) return;
    if (delayedScheduled) return;

    delayedScheduled = true;

    setTimeout(() => {
      delayedScheduled = false;
      applyAll();
    }, 300);
  };

  const scheduleUploaderPathsFallback = () => {
    clearUploaderPathsFallback();
    if (!isWatchPath()) return;

    const videoKey = getVideoKey();
    if (uploaderPathsReadyVideoKey === videoKey) return;

    uploaderPathsFallbackTimer = setTimeout(() => {
      uploaderPathsFallbackTimer = 0;

      if (
        !isWatchPath() ||
        getVideoKey() !== videoKey ||
        uploaderPathsReadyVideoKey === videoKey
      ) {
        return;
      }

      markUploaderPathsReady();
      scheduleApply(document.querySelector("ytd-comments") || document);
      scheduleDelayedApply();
    }, UPLOADER_PATHS_FALLBACK_DELAY_MS);
  };

  const getMutationElement = (node) => {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  };

  const getCommentMutationApplyRoot = (node) => {
    const element = getMutationElement(node);
    if (!element) return null;

    if (element.closest(COMMENT_MUTATION_SURFACE_SELECTOR)) return element;
    if (element.querySelector(COMMENT_MUTATION_SURFACE_SELECTOR)) return element;
    return null;
  };

  const containsUploaderSource = (node) => {
    const element = getMutationElement(node);
    if (!element) return false;

    return Boolean(
      element.closest(UPLOADER_SOURCE_SELECTOR) ||
        element.querySelector(UPLOADER_SOURCE_SELECTOR),
    );
  };

  const collectCommentsVideoGuardRoots = (roots, node) => {
    const applyRoot = getCommentMutationApplyRoot(node);
    if (!applyRoot) return null;

    getCommentContainers(applyRoot).forEach((comments) => roots.add(comments));
    return applyRoot;
  };

  const observer = new MutationObserver((mutations) => {
    if (!isWatchPath()) return;

    const commentsVideoGuardRoots = new Set();

    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        collectCommentsVideoGuardRoots(
          commentsVideoGuardRoots,
          mutation.target,
        );

        if (containsUploaderSource(mutation.target)) {
          invalidateCachedUploaderPaths();
          scheduleApply(document.querySelector("ytd-comments") || document);
        }
        continue;
      }

      collectCommentsVideoGuardRoots(commentsVideoGuardRoots, mutation.target);
      if (!mutation.addedNodes.length) continue;

      mutation.addedNodes.forEach((node) => {
        const applyRoot = collectCommentsVideoGuardRoots(
          commentsVideoGuardRoots,
          node,
        );
        if (applyRoot) {
          scheduleApply(applyRoot);
        }

        if (containsUploaderSource(node)) {
          invalidateCachedUploaderPaths();
          scheduleApply(document.querySelector("ytd-comments") || document);
        }
      });
    }

    commentsVideoGuardRoots.forEach((comments) =>
      syncCommentsVideoGuard(comments),
    );
  });

  const startObserving = () => {
    if (observing || !isWatchPath()) return;

    observer.observe(document.documentElement, {
      attributeFilter: ["href"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    observing = true;
  };

  const stopObserving = () => {
    if (!observing) return;

    observer.disconnect();
    observing = false;
  };

  const syncRouteState = () => {
    if (isWatchPath()) {
      startObserving();
      applyAll();
      scheduleDelayedApply();
      return;
    }

    stopObserving();
    pendingApplyRoots.clear();
    invalidateUploaderPaths();
  };

  if (isWatchPath()) markUploaderPathsReady();
  syncRouteState();

  window.addEventListener(
    "yt-navigate-start",
    () => {
      markCurrentCommentsStale();
      invalidateUploaderPaths();
    },
    true,
  );

  window.addEventListener(
    "yt-navigate-finish",
    () => {
      syncRouteState();
      syncCommentsVideoGuard();
      scheduleUploaderPathsFallback();
    },
    true,
  );

  window.addEventListener(
    "yt-page-data-updated",
    () => {
      if (!isWatchPath()) return;

      markUploaderPathsReady();
      syncCommentsVideoGuard();
      scheduleApply(document.querySelector("ytd-comments") || document);
      scheduleDelayedApply();
    },
    true,
  );

  window.addEventListener(
    "pageshow",
    () => {
      if (isWatchPath()) {
        markUploaderPathsReady();
      } else {
        invalidateUploaderPaths();
      }
      syncRouteState();
      syncCommentsVideoGuard();
    },
    true,
  );

  GM_addStyle(buildCss());
  syncCommentsVideoGuard();
})();
