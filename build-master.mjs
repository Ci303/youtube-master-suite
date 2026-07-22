import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const repositoriesDirectory = resolve(suiteDirectory, "..");
const outputPath = join(suiteDirectory, "youtube-master-suite.user.js");
const sponsorBlockQueueWidthSourcePath = join(
  suiteDirectory,
  "sources/youtube-sponsorblock-queue-width.user.js",
);

const modules = [
  {
    id: "commentCleaner",
    label: "Comment Cleaner",
    phase: "document-idle",
    source: "youtube-comment-cleaner/youtube-comment-cleaner.user.js",
  },
  {
    id: "feedUiCleaner",
    label: "Feed UI Cleaner",
    phase: "document-idle",
    source: "youtube-feed-ui-cleaner/youtube-feed-ui-cleaner.user.js",
  },
  {
    id: "miniplayerButtonRestorer",
    label: "Miniplayer Button Restorer",
    phase: "document-idle",
    source:
      "youtube-miniplayer-button-restorer/youtube-miniplayer-button-restorer.user.js",
  },
  {
    id: "playerPreferencesLite",
    label: "Player Preferences Lite",
    phase: "document-idle",
    source:
      "youtube-player-preferences-lite/youtube-player-preferences-lite.user.js",
  },
  {
    id: "scrollMiniplayer",
    label: "Scroll Miniplayer",
    phase: "document-idle",
    source: "youtube-scroll-miniplayer/youtube-scroll-miniplayer.user.js",
  },
  {
    id: "watchLayoutCleaner",
    label: "Watch Layout Cleaner",
    phase: "document-start",
    source:
      "youtube-watch-layout-cleaner/youtube-watch-layout-cleaner.user.js",
  },
];

function normaliseNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function extractMetadata(source, field) {
  const match = source.match(new RegExp(`^//\\s+@${field}\\s+(.+)$`, "m"));
  if (!match) throw new Error(`Missing @${field} metadata`);
  return match[1].trim();
}

function extractModuleBody(source, sourcePath) {
  const metadataEnd = "// ==/UserScript==";
  const metadataEndIndex = source.indexOf(metadataEnd);
  if (metadataEndIndex === -1) {
    throw new Error(`${sourcePath}: userscript metadata end not found`);
  }

  let body = source.slice(metadataEndIndex + metadataEnd.length).trim();
  const openingPatterns = ["(function () {", "(() => {"];
  const opening = openingPatterns.find((pattern) => body.startsWith(pattern));
  if (!opening) throw new Error(`${sourcePath}: unsupported outer wrapper`);

  body = body.slice(opening.length).trimStart();
  if (!body.endsWith("})();")) {
    throw new Error(`${sourcePath}: unsupported wrapper ending`);
  }

  return body.slice(0, -5).trimEnd();
}

function replaceExactly(source, before, after, description) {
  const firstIndex = source.indexOf(before);
  if (firstIndex === -1) throw new Error(`Missing transform: ${description}`);
  if (source.indexOf(before, firstIndex + before.length) !== -1) {
    throw new Error(`Ambiguous transform: ${description}`);
  }
  return source.slice(0, firstIndex) + after + source.slice(firstIndex + before.length);
}

const simpleEnsureStyles = `  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();
    (document.head || document.documentElement).appendChild(style);
  }`;

const scrollEnsureStyles = `  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCss();

    (document.head || document.documentElement).appendChild(style);
  }`;

const playerPreferencesEnsureStyles = `  function ensureStyles() {
    const css = buildCss();
    if (!css.trim()) {
      return;
    }

    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    if (style.textContent !== css) {
      style.textContent = css;
      schedulePlayerLayoutRefreshAttempts();
    }
  }`;

const watchLayoutStyles = `  function ensureStyle() {
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
  }`;

const watchLayoutSidebarCss = [
  '@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {',
  '  ${TWO_COLUMN_WATCH_FLEXY_SELECTOR}{',
  '    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  "  }",
  "}",
].join("\n");

const consolidatedWatchLayoutSidebarCss = [
  '@media (min-width: ${px(CONFIG.queueLayoutBreakpointPx + 1)}) {',
  '  ${WATCH_FLEXY_SELECTOR}{',
  '    --tm-yw-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  '    --ytd-watch-flexy-sidebar-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  "  }",
  "",
  '  ${watchFlexyChildSelector("#secondary.ytd-watch-flexy")}{',
  '    flex: 0 0 ${px(CONFIG.sidebarWidthPx)} !important;',
  '    width: ${px(CONFIG.sidebarWidthPx)} !important;',
  '    min-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  '    max-width: ${px(CONFIG.sidebarWidthPx)} !important;',
  "  }",
  "}",
].join("\n");

function transformModuleBody(moduleDefinition, body) {
  let transformed = body.replaceAll(
    "window.addEventListener(",
    "suite.addWindowListener(",
  );

  if (moduleDefinition.id === "miniplayerButtonRestorer") {
    transformed = replaceExactly(
      transformed,
      simpleEnsureStyles,
      `  function ensureStyles() {
    suite.setStyle("${moduleDefinition.id}", buildCss());
  }`,
      "Miniplayer Button Restorer stylesheet",
    );
  }

  if (moduleDefinition.id === "playerPreferencesLite") {
    transformed = replaceExactly(
      transformed,
      playerPreferencesEnsureStyles,
      `  function ensureStyles() {
    const css = buildCss();
    if (!css.trim()) {
      suite.removeStyle("${moduleDefinition.id}");
      return;
    }

    if (suite.setStyle("${moduleDefinition.id}", css)) {
      schedulePlayerLayoutRefreshAttempts();
    }
  }`,
      "Player Preferences Lite stylesheet",
    );
  }

  if (moduleDefinition.id === "scrollMiniplayer") {
    transformed = replaceExactly(
      transformed,
      scrollEnsureStyles,
      `  function ensureStyles() {
    suite.setStyle("${moduleDefinition.id}", buildCss());
  }`,
      "Scroll Miniplayer stylesheet",
    );
  }

  if (moduleDefinition.id === "watchLayoutCleaner") {
    transformed = replaceExactly(
      transformed,
      watchLayoutStyles,
      `  function ensureStyle() {
    if (!isWatchPath()) {
      removeStyle();
      return;
    }

    suite.setStyle("${moduleDefinition.id}", buildCss());
  }

  function removeStyle() {
    suite.removeStyle("${moduleDefinition.id}");
  }`,
      "Watch Layout Cleaner stylesheet",
    );
    transformed = replaceExactly(
      transformed,
      watchLayoutSidebarCss,
      consolidatedWatchLayoutSidebarCss,
      "SponsorBlock queue width consolidation",
    );
  }

  if (transformed.includes("window.addEventListener(")) {
    throw new Error(`${moduleDefinition.source}: window listener transform failed`);
  }
  if (transformed.includes('document.createElement("style")')) {
    throw new Error(`${moduleDefinition.source}: stylesheet transform incomplete`);
  }

  return transformed;
}

const sourceModules = modules.map((moduleDefinition) => {
  const absolutePath = join(repositoriesDirectory, moduleDefinition.source);
  const source = normaliseNewlines(readFileSync(absolutePath, "utf8"));
  const body = transformModuleBody(
    moduleDefinition,
    extractModuleBody(source, moduleDefinition.source),
  );

  return {
    ...moduleDefinition,
    version: extractMetadata(source, "version"),
    sourceHash: sha256(source),
    body,
  };
});

const sponsorBlockQueueWidthSource = normaliseNewlines(
  readFileSync(sponsorBlockQueueWidthSourcePath, "utf8"),
);
const sponsorBlockQueueWidthManifest = {
  label: "SponsorBlock Queue Width (folded into Watch Layout Cleaner)",
  source: "sources/youtube-sponsorblock-queue-width.user.js",
  version: extractMetadata(sponsorBlockQueueWidthSource, "version"),
  sourceHash: sha256(sponsorBlockQueueWidthSource),
};

const moduleSwitches = sourceModules
  .map(({ id }) => `    ${id}: true,`)
  .join("\n");

const sourceManifest = sourceModules
  .map(
    ({ label, source, version, sourceHash }) =>
      `//   ${label} v${version} | ${source} | sha256:${sourceHash}`,
  )
  .concat(
    `//   ${sponsorBlockQueueWidthManifest.label} v${sponsorBlockQueueWidthManifest.version} | ${sponsorBlockQueueWidthManifest.source} | sha256:${sponsorBlockQueueWidthManifest.sourceHash}`,
  )
  .join("\n");

const moduleInitialisers = sourceModules
  .map(
    ({ id, label, phase, version, body }) => `
  suite.registerModule(
    ${JSON.stringify(id)},
    ${JSON.stringify(`${label} v${version}`)},
    ${JSON.stringify(phase)},
    () => {
      const MutationObserver = suite.SharedMutationObserver;
      const GM_addStyle = (css) => suite.setStyle(${JSON.stringify(id)}, css);

${body
  .split("\n")
  .map((line) => (line ? `      ${line}` : ""))
  .join("\n")}
    },
  );`,
  )
  .join("\n");

const output = `// ==UserScript==
// @name         YouTube Master Suite (Test)
// @namespace    Citizen.youtube.master-suite
// @version      0.1.3
// @description  Consolidates Citizen YouTube userscripts with shared SPA event, mutation-observer, and stylesheet infrastructure.
// @author       Citizen
// @license      GNU GPLv3
// @homepageURL  https://github.com/Ci303/youtube-master-suite
// @supportURL   https://github.com/Ci303/youtube-master-suite/issues
// @updateURL    https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/youtube-master-suite.user.js
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

// Generated by build-master.mjs. Edit the source scripts or module switches,
// then rebuild; do not edit generated module bodies directly.
//
// Source manifest:
${sourceManifest}

(() => {
  "use strict";

  const ENABLED_MODULES = Object.freeze({
${moduleSwitches}
  });

  const NativeMutationObserver = globalThis.MutationObserver;
  const SHARED_WINDOW_EVENTS = new Set([
    "pageshow",
    "yt-navigate-finish",
    "yt-navigate-start",
    "yt-page-data-updated",
  ]);
  const STYLE_ORDER = [
${sourceModules.map(({ id }) => `    ${JSON.stringify(id)},`).join("\n")}
  ];
  const sharedWindowListeners = new Map();
  const sharedMutationObservers = new Set();
  const styleParts = new Map();
  const idleModules = [];
  let nativeMutationObserver = null;
  let styleElement = null;
  let batchDepth = 0;
  let mutationRefreshPending = false;
  let styleRenderPending = false;

  function reportModuleError(label, error) {
    console.error(\`[YouTube Master Suite] \${label} failed\`, error);
  }

  function beginBatch() {
    batchDepth += 1;
  }

  function endBatch() {
    batchDepth -= 1;
    if (batchDepth > 0) return;

    if (mutationRefreshPending) refreshNativeMutationObserver();
    if (styleRenderPending) renderStyles();
  }

  function getCapture(options) {
    return typeof options === "boolean" ? options : Boolean(options?.capture);
  }

  function invokeEventListener(listener, event) {
    if (typeof listener === "function") {
      listener.call(globalThis, event);
      return;
    }
    listener?.handleEvent?.(event);
  }

  function addWindowListener(type, listener, options) {
    if (!SHARED_WINDOW_EVENTS.has(type)) {
      globalThis.addEventListener(type, listener, options);
      return;
    }

    const capture = getCapture(options);
    const key = \`\${type}|\${capture ? "capture" : "bubble"}\`;
    let group = sharedWindowListeners.get(key);
    if (!group) {
      group = { listeners: [] };
      sharedWindowListeners.set(key, group);
      globalThis.addEventListener(
        type,
        (event) => {
          for (const registeredListener of [...group.listeners]) {
            try {
              invokeEventListener(registeredListener, event);
            } catch (error) {
              reportModuleError(\`\${type} event listener\`, error);
            }
          }
        },
        capture,
      );
    }
    group.listeners.push(listener);
  }

  function mutationMatches(observer, mutation) {
    const { target, options } = observer;
    if (!target || !options) return false;
    if (
      mutation.target !== target &&
      (!options.subtree || !target.contains(mutation.target))
    ) {
      return false;
    }

    if (mutation.type === "childList") return Boolean(options.childList);
    if (mutation.type === "characterData") {
      return Boolean(options.characterData);
    }
    if (mutation.type !== "attributes" || !options.attributes) return false;
    return (
      !options.attributeFilter ||
      options.attributeFilter.includes(mutation.attributeName)
    );
  }

  function dispatchMutations(mutations) {
    for (const observer of [...sharedMutationObservers]) {
      if (!observer.active) continue;
      const matchingMutations = mutations.filter((mutation) =>
        mutationMatches(observer, mutation),
      );
      if (!matchingMutations.length) continue;

      try {
        observer.callback(matchingMutations, observer);
      } catch (error) {
        reportModuleError("mutation observer callback", error);
      }
    }
  }

  function requestMutationRefresh() {
    mutationRefreshPending = true;
    if (!batchDepth) refreshNativeMutationObserver();
  }

  function refreshNativeMutationObserver() {
    mutationRefreshPending = false;
    nativeMutationObserver?.disconnect();
    nativeMutationObserver = null;

    const activeObservers = [...sharedMutationObservers].filter(
      (observer) => observer.active,
    );
    if (!activeObservers.length) return;

    const attributes = activeObservers.some(
      (observer) => observer.options.attributes,
    );
    const observeAllAttributes = activeObservers.some(
      (observer) =>
        observer.options.attributes && !observer.options.attributeFilter,
    );
    const attributeFilter = observeAllAttributes
      ? undefined
      : [
          ...new Set(
            activeObservers.flatMap(
              (observer) => observer.options.attributeFilter || [],
            ),
          ),
        ];
    const options = {
      attributes,
      childList: activeObservers.some((observer) => observer.options.childList),
      characterData: activeObservers.some(
        (observer) => observer.options.characterData,
      ),
      subtree: activeObservers.some((observer) => observer.options.subtree),
    };
    if (attributes && attributeFilter?.length) {
      options.attributeFilter = attributeFilter;
    }

    nativeMutationObserver = new NativeMutationObserver(dispatchMutations);
    const targets = new Set(activeObservers.map((observer) => observer.target));
    targets.forEach((target) => nativeMutationObserver.observe(target, options));
  }

  class SharedMutationObserver {
    constructor(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("MutationObserver callback must be a function");
      }
      this.callback = callback;
      this.target = null;
      this.options = null;
      this.active = false;
      sharedMutationObservers.add(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = { ...options };
      this.active = true;
      requestMutationRefresh();
    }

    disconnect() {
      if (!this.active) return;
      this.active = false;
      requestMutationRefresh();
    }

    takeRecords() {
      return [];
    }
  }

  function getCombinedCss() {
    return STYLE_ORDER.filter((id) => styleParts.has(id))
      .map((id) => \`/* \${id} */\\n\${styleParts.get(id)}\`)
      .join("\\n\\n");
  }

  function requestStyleRender() {
    styleRenderPending = true;
    if (!batchDepth) renderStyles();
  }

  function renderStyles() {
    styleRenderPending = false;
    const css = getCombinedCss();
    if (!css) {
      styleElement?.remove();
      styleElement = null;
      return;
    }

    let restored = false;
    if (!styleElement?.isConnected) {
      styleElement = document.createElement("style");
      styleElement.id = "yt-master-suite-style";
      (document.head || document.documentElement).appendChild(styleElement);
      restored = true;
    }
    if (restored || styleElement.textContent !== css) {
      styleElement.textContent = css;
    }
  }

  function setStyle(id, css) {
    const normalisedCss = String(css || "");
    const changed = styleParts.get(id) !== normalisedCss;
    const missingElement = !styleElement?.isConnected;
    if (changed) styleParts.set(id, normalisedCss);
    if (changed || missingElement) requestStyleRender();
    return changed || missingElement;
  }

  function removeStyle(id) {
    if (!styleParts.delete(id)) return false;
    requestStyleRender();
    return true;
  }

  function executeModule(id, label, initialise) {
    if (!ENABLED_MODULES[id]) return;
    try {
      initialise();
    } catch (error) {
      reportModuleError(label, error);
    }
  }

  function registerModule(id, label, phase, initialise) {
    if (phase === "document-start") {
      executeModule(id, label, initialise);
      return;
    }
    idleModules.push({ id, label, initialise });
  }

  function startIdleModules() {
    const start = () => {
      beginBatch();
      try {
        idleModules.forEach(({ id, label, initialise }) =>
          executeModule(id, label, initialise),
        );
      } finally {
        endBatch();
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      queueMicrotask(start);
    }
  }

  const suite = {
    SharedMutationObserver,
    addWindowListener,
    registerModule,
    removeStyle,
    setStyle,
  };
${moduleInitialisers}

  startIdleModules();
})();
`;

writeFileSync(outputPath, output, "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`SHA-256 ${sha256(output)}`);
