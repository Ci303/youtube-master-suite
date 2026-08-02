// ==UserScript==
// @name         YouTube Feed UI Cleaner
// @namespace    Citizen.youtube.feed-ui-cleaner
// @version      2.3
// @description  Removes unwanted YouTube UI, shelves, chips, ad slots, mixes, members-only videos, and full podcast tiles while reducing blank feed gaps.
// @author       Citizen
// @homepageURL  https://github.com/Ci303/youtube-feed-ui-cleaner
// @supportURL   https://github.com/Ci303/youtube-feed-ui-cleaner/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-feed-ui-cleaner/main/youtube-feed-ui-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-feed-ui-cleaner/main/youtube-feed-ui-cleaner.user.js
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    hideStaticUi: true,
    tightenFeedGrid: true
  };

  const STATIC_HIDE_SELECTORS = [
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(2)',
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(4)',
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(5)',
    'ytd-guide-section-renderer.ytd-guide-renderer.style-scope:nth-of-type(6)',
    'ytd-guide-collapsible-entry-renderer.ytd-guide-collapsible-section-entry-renderer.style-scope',
    'ytd-guide-entry-renderer.ytd-guide-collapsible-section-entry-renderer.style-scope:nth-of-type(1)',
    '#guide-links-primary',
    '#guide-links-secondary',
    '#copyright',
    'ytd-guide-renderer #footer',
    'ytd-guide-renderer #guide-links-primary',
    'ytd-guide-renderer #guide-links-secondary',
    'ytd-guide-renderer #copyright',
    'ytd-mini-guide-renderer #copyright',
    'tp-yt-app-drawer #copyright',
    'ytd-browse ytd-feed-filter-chip-bar-renderer #chips-content.ytd-feed-filter-chip-bar-renderer',
    'ytd-browse ytd-feed-filter-chip-bar-renderer #chips-wrapper.ytd-feed-filter-chip-bar-renderer',
    'ytd-browse ytd-rich-grid-renderer ytd-rich-section-renderer',
    'ytd-browse ytd-rich-grid-renderer ytd-rich-item-renderer:has(ytd-feed-nudge-renderer)',
    'ytd-masthead #voice-search-button',
    'ytd-masthead ytd-notification-topbar-button-renderer',
    'ytd-masthead #notification-button',
    'ytd-masthead #create-button',
    'ytd-masthead ytd-button-renderer:has(button[aria-label="Create"])',
    'ytd-masthead button[aria-label="Create"]',
  ];

  const MIX_BADGE_SELECTOR = [
    '.ytThumbnailOverlayBadgeViewModelHost',
    'ytd-thumbnail-overlay-bottom-panel-renderer',
    'ytd-thumbnail-overlay-time-status-renderer',
    'badge-shape',
    '.badge-shape-wiz',
  ].join(',');

  const MEMBERS_ONLY_SELECTOR = [
    '#meta > ytd-badge-supported-renderer.video-badge.style-scope.ytd-rich-grid-media > div.badge.badge-style-type-members-only.style-scope.ytd-badge-supported-renderer.style-scope.ytd-badge-supported-renderer',
    'div.ytContentMetadataViewModelMetadataRow.ytContentMetadataViewModelMetadataRowMetadataRowWrap',
  ].join(',');

  const PODCAST_LINK_SELECTOR = [
    'a[href^="/playlist?list="]',
    'a[href*="youtube.com/playlist?list="]',
  ].join(',');

  const AD_SLOT_SELECTOR = [
    'ytd-ad-slot-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
  ].join(',');

  const OUTER_CONTAINER_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytm-rich-item-renderer',
    'ytm-video-with-context-renderer',
    'yt-horizontal-list-renderer',
    'yt-collection-stack',
  ].join(',');

  const INNER_CONTAINER_SELECTORS = [
    'ytd-rich-grid-media',
    'yt-lockup-view-model',
    'ytm-lockup-view-model',
  ].join(',');

  const EXCLUDED_ANCESTOR_SELECTORS = [
    'ytd-popup-container',
    'tp-yt-iron-dropdown',
    'ytd-menu-popup-renderer',
    'ytd-miniplayer',
    'ytd-miniplayer-ui',
    'ytd-miniplayer-bar-renderer',
    'ytd-playlist-panel-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-playlist-panel-renderer #items',
    'ytd-watch-flexy[playlist]',
    'ytd-engagement-panel-section-list-renderer',
  ].join(',');

  const FEED_SURFACE_SELECTOR = [
    'ytd-browse ytd-rich-grid-renderer',
    'ytd-two-column-browse-results-renderer ytd-rich-grid-renderer',
  ].join(',');

  const FEED_CONTENTS_SELECTOR = 'ytd-browse ytd-rich-grid-renderer #contents.ytd-rich-grid-renderer';

  const HIDDEN_FLAG = 'data-clean-up-youtube-hidden';

  function getText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function isInsideExcludedSurface(el) {
    return Boolean(el.closest(EXCLUDED_ANCESTOR_SELECTORS));
  }

  function isMixBadge(el) {
    return /^mix$/i.test(getText(el));
  }

  function isFullPodcastLink(el) {
    return /^view full podcast$/i.test(getText(el));
  }

  function isMembersOnlyMatch(el) {
    return /members only/i.test(getText(el));
  }

  const CARD_FILTERS = [
    { selector: MIX_BADGE_SELECTOR, matches: isMixBadge },
    { selector: MEMBERS_ONLY_SELECTOR, matches: isMembersOnlyMatch },
    { selector: PODCAST_LINK_SELECTOR, matches: isFullPodcastLink },
    { selector: AD_SLOT_SELECTOR, matches: () => true },
  ];

  function buildHideCss(selectors) {
    return `
    ${selectors.join(',\n    ')} {
      display: none !important;
    }
  `;
  }

  function buildStaticCss() {
    return CONFIG.hideStaticUi ? buildHideCss(STATIC_HIDE_SELECTORS) : '';
  }

  function buildFeedGridCss() {
    if (!CONFIG.tightenFeedGrid) return '';

    return `
    ${FEED_CONTENTS_SELECTOR} {
      padding-top: 16px !important;
      padding-left: 24px !important;
      padding-right: 24px !important;
    }
  `;
  }

  function buildCss() {
    return [
      buildStaticCss(),
      buildFeedGridCss(),
    ].filter(css => css.trim()).join('\n');
  }

  function hideContainer(el) {
    const container = el.closest(OUTER_CONTAINER_SELECTORS) || el.closest(INNER_CONTAINER_SELECTORS);
    if (!container || container.hasAttribute(HIDDEN_FLAG)) return false;
    if (isInsideExcludedSurface(container)) return false;

    container.style.setProperty('display', 'none', 'important');
    container.setAttribute(HIDDEN_FLAG, '1');
    return true;
  }

  function collectMatchingElements(root, selector) {
    const elements = new Set();
    if (!root || !root.querySelectorAll) return elements;

    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      elements.add(root);
    }
    root.querySelectorAll(selector).forEach((el) => elements.add(el));
    return elements;
  }

  function hideMatchingCards(root = document) {
    let changed = false;

    CARD_FILTERS.forEach(({ selector, matches }) => {
      collectMatchingElements(root, selector).forEach((el) => {
        if (isInsideExcludedSurface(el) || !matches(el)) return;
        changed = hideContainer(el) || changed;
      });
    });

    return changed;
  }

  function cleanUp(root = document) {
    const rootElement =
      root && root.nodeType === Node.ELEMENT_NODE ? root : null;
    if (rootElement && rootElement.closest(FEED_SURFACE_SELECTOR)) {
      hideMatchingCards(rootElement);
      return;
    }

    collectMatchingElements(root, FEED_SURFACE_SELECTOR).forEach((surface) => {
      hideMatchingCards(surface);
    });
  }

  let scheduled = false;
  const pendingCleanUpRoots = new Set();

  function addPendingCleanUpRoot(root) {
    if (!root || !root.querySelectorAll) return;

    for (const pendingRoot of Array.from(pendingCleanUpRoots)) {
      if (pendingRoot === root || pendingRoot.contains?.(root)) return;
      if (root.contains?.(pendingRoot)) pendingCleanUpRoots.delete(pendingRoot);
    }

    pendingCleanUpRoots.add(root);
  }

  function scheduleCleanUp(root) {
    addPendingCleanUpRoot(root);
    if (!pendingCleanUpRoots.size) return;
    if (scheduled) return;

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const roots = Array.from(pendingCleanUpRoots);
      pendingCleanUpRoots.clear();
      roots.forEach((pendingRoot) => {
        if (pendingRoot.isConnected !== false) cleanUp(pendingRoot);
      });
    });
  }

  function getAddedNodeCleanUpRoot(node) {
    const element =
      node && node.nodeType === Node.ELEMENT_NODE
        ? node
        : node && node.parentElement;
    if (!element) return null;

    if (element.closest(FEED_SURFACE_SELECTOR)) return element;
    if (element.querySelector(FEED_SURFACE_SELECTOR)) return element;
    return null;
  }

  GM_addStyle(buildCss());
  cleanUp(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutation.addedNodes || !mutation.addedNodes.length) continue;

      mutation.addedNodes.forEach((node) => {
        const cleanUpRoot = getAddedNodeCleanUpRoot(node);
        if (cleanUpRoot) scheduleCleanUp(cleanUpRoot);
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', () => cleanUp(document), true);
})();
