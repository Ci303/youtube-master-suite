// ==UserScript==
// @name         YouTube SponsorBlock Queue Width
// @namespace    Citizen.youtube.sponsorblock-queue-width
// @version      1
// @description  Sets YouTube watch-page right rail and queue width to 374px for SponsorBlock notice alignment.
// @author       Citizen
// @license      GNU GPLv3
// @run-at       document-idle
// @match        *://www.youtube.com/*
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    sidebarWidthPx: 374,
    responsiveBreakpointPx: 1000,
  };

  const STYLE_ID = 'sbyta-sponsorblock-queue-width-style';
  const WATCH_FLEXY_CSS_SELECTOR = 'ytd-watch-flexy:is([flexy], [flexy_], [is-two-columns_])';

  const isWatchPath = () => location.pathname === '/watch' || location.pathname.startsWith('/live/');
  const px = (value) => `${value}px`;

  const buildCss = () => {
    const sidebarWidth = px(CONFIG.sidebarWidthPx);
    const responsiveBreakpoint = px(CONFIG.responsiveBreakpointPx);

    return `
      ${WATCH_FLEXY_CSS_SELECTOR} {
        --tm-yw-sidebar-width: ${sidebarWidth} !important;
        --ytd-watch-flexy-sidebar-width: ${sidebarWidth} !important;
      }

      ${WATCH_FLEXY_CSS_SELECTOR} #secondary.ytd-watch-flexy {
        flex: 0 0 ${sidebarWidth} !important;
        width: ${sidebarWidth} !important;
        min-width: ${sidebarWidth} !important;
        max-width: ${sidebarWidth} !important;
      }

      @media (max-width: ${responsiveBreakpoint}) {
        ${WATCH_FLEXY_CSS_SELECTOR} #secondary.ytd-watch-flexy {
          flex: none !important;
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
        }
      }
    `;
  };

  const ensureStyles = () => {
    let styleElement = document.getElementById(STYLE_ID);
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = STYLE_ID;
      document.head.appendChild(styleElement);
    }

    const css = buildCss();
    if (styleElement.textContent !== css) {
      styleElement.textContent = css;
    }
  };

  const removeStyles = () => {
    const styleElement = document.getElementById(STYLE_ID);
    if (styleElement) styleElement.remove();
  };

  const apply = () => {
    if (!isWatchPath()) {
      removeStyles();
      return;
    }

    ensureStyles();
  };

  const start = () => {
    if (!document.body) {
      requestAnimationFrame(start);
      return;
    }

    apply();
  };

  start();
  window.addEventListener('yt-navigate-finish', () => setTimeout(apply, 300), true);
  window.addEventListener('pageshow', apply, true);
})();
