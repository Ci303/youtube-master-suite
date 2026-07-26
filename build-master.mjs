import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MASTER_VERSION = "0.1.13";
const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = join(suiteDirectory, "youtube-master-suite.user.js");
const releaseManifestPath = join(suiteDirectory, "release-manifest.json");
const sourceLockPath = join(suiteDirectory, "sources.lock.json");
const checkOnly = process.argv.includes("--check");
const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
if (sourceLock.schemaVersion !== 2) {
  throw new Error(`Unsupported source-lock schema ${sourceLock.schemaVersion}`);
}

const modules = [
  {
    id: "commentCleaner",
    label: "Comment Cleaner",
    phase: "document-idle",
  },
  {
    id: "feedUiCleaner",
    label: "Feed UI Cleaner",
    phase: "document-idle",
  },
  {
    id: "miniplayerButtonRestorer",
    label: "Miniplayer Button Restorer",
    phase: "document-idle",
  },
  {
    id: "playerPreferencesLite",
    label: "Player Preferences Lite",
    phase: "document-idle",
  },
  {
    id: "scrollMiniplayer",
    label: "Scroll Miniplayer",
    phase: "document-idle",
  },
  {
    id: "watchLayoutCleaner",
    label: "Watch Layout Cleaner",
    phase: "document-start",
  },
];

function normaliseNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function getLockedSource(moduleDefinition) {
  const lockedSource = sourceLock.modules?.[moduleDefinition.id];
  if (!lockedSource) {
    throw new Error(`Missing source lock for ${moduleDefinition.id}`);
  }
  if (!/^sources\/modules\/[a-z0-9-]+\.user\.js$/.test(lockedSource.path)) {
    throw new Error(`Invalid source path for ${moduleDefinition.id}`);
  }
  return lockedSource;
}

async function readModuleSource(moduleDefinition) {
  const lockedSource = getLockedSource(moduleDefinition);
  if (!/^[0-9a-f]{64}$/.test(lockedSource.sha256)) {
    throw new Error(`${moduleDefinition.id}: invalid locked source hash`);
  }

  const source = normaliseNewlines(
    readFileSync(join(suiteDirectory, lockedSource.path), "utf8"),
  );
  if (sha256(source) !== lockedSource.sha256) {
    throw new Error(
      `${moduleDefinition.id}: canonical source does not match its locked hash; ` +
        "run refresh-source-lock.mjs after reviewing the source change",
    );
  }
  if (extractMetadata(source, "version") !== lockedSource.version) {
    throw new Error(
      `${moduleDefinition.id}: canonical source version does not match its lock`,
    );
  }

  return {
    sourcePath: lockedSource.path,
    source,
  };
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

const sourceModules = await Promise.all(
  modules.map(async (moduleDefinition) => {
    const { sourcePath, source } = await readModuleSource(moduleDefinition);
    const canonicalDefinition = {
      ...moduleDefinition,
      source: sourcePath,
    };
    const body = transformModuleBody(
      canonicalDefinition,
      extractModuleBody(source, sourcePath),
    );

    return {
      ...canonicalDefinition,
      version: extractMetadata(source, "version"),
      sourceHash: sha256(source),
      body,
    };
  }),
);

const moduleSwitches = sourceModules
  .map(({ id }) => `    ${id}: true,`)
  .join("\n");

const sourceManifest = sourceModules
  .map(
    ({ label, source, version, sourceHash }) =>
      `//   ${label} v${version} | ${source} | sha256:${sourceHash}`,
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
// @name         YouTube Master Suite
// @namespace    Citizen.youtube.master-suite
// @version      ${MASTER_VERSION}
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

// Generated by build-master.mjs. Edit canonical sources in sources/modules/
// or the module switches, then rebuild; do not edit module bodies here.
//
// Source manifest:
${sourceManifest}

(() => {
  "use strict";

  const MASTER_VERSION = ${JSON.stringify(MASTER_VERSION)};
  const EXPECTED_MODULE_COUNT = ${sourceModules.length};
  const HEALTH_ATTRIBUTE = "data-yt-master-suite";
  const ENABLED_MODULES = Object.freeze({
${moduleSwitches}
  });
  const DIAGNOSTICS = Object.freeze({
    enabled: false,
    reportIntervalMs: 30000,
  });
  const DIAGNOSTICS_ATTRIBUTE = "data-yt-master-diagnostics";

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
  const registeredModuleIds = new Set();
  const diagnosticStats = new Map();
  let nativeMutationObserver = null;
  let styleElement = null;
  let batchDepth = 0;
  let activeModuleId = "suite";
  let mutationRefreshPending = false;
  let styleRenderPending = false;

  function reportModuleError(label, error) {
    console.error(\`[YouTube Master Suite] \${label} failed\`, error);
  }

  function now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function runWithDiagnostics(moduleId, operation, units, callback) {
    if (!DIAGNOSTICS.enabled) {
      return callback();
    }

    const startedAt = now();
    try {
      return callback();
    } finally {
      const elapsedMs = now() - startedAt;
      const key = \`\${moduleId}:\${operation}\`;
      const current = diagnosticStats.get(key) || {
        module: moduleId,
        operation,
        calls: 0,
        units: 0,
        totalMs: 0,
        maxMs: 0,
      };
      current.calls += 1;
      current.units += units;
      current.totalMs += elapsedMs;
      current.maxMs = Math.max(current.maxMs, elapsedMs);
      diagnosticStats.set(key, current);
    }
  }

  function getDiagnosticsSnapshot() {
    return [...diagnosticStats.values()]
      .map((entry) => ({
        ...entry,
        averageMs: entry.calls ? entry.totalMs / entry.calls : 0,
      }))
      .sort(
        (left, right) =>
          right.totalMs - left.totalMs ||
          left.module.localeCompare(right.module) ||
          left.operation.localeCompare(right.operation),
      );
  }

  function reportDiagnostics() {
    const snapshot = getDiagnosticsSnapshot();
    document.documentElement?.setAttribute(
      DIAGNOSTICS_ATTRIBUTE,
      JSON.stringify(snapshot),
    );
    if (snapshot.length) {
      console.table(snapshot);
    }
    return snapshot;
  }

  function installDiagnostics() {
    if (!DIAGNOSTICS.enabled) return;

    globalThis.__YT_MASTER_DIAGNOSTICS__ = Object.freeze({
      clear: () => {
        diagnosticStats.clear();
        reportDiagnostics();
      },
      report: reportDiagnostics,
      snapshot: getDiagnosticsSnapshot,
    });
    reportDiagnostics();
    setInterval(reportDiagnostics, DIAGNOSTICS.reportIntervalMs);
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
    const ownerId = activeModuleId;
    if (!SHARED_WINDOW_EVENTS.has(type)) {
      const registeredListener = DIAGNOSTICS.enabled
        ? (event) =>
            runWithDiagnostics(ownerId, \`event:\${type}\`, 1, () =>
              invokeEventListener(listener, event),
            )
        : listener;
      globalThis.addEventListener(type, registeredListener, options);
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
              runWithDiagnostics(
                registeredListener.ownerId,
                \`event:\${type}\`,
                1,
                () => invokeEventListener(registeredListener.listener, event),
              );
            } catch (error) {
              reportModuleError(\`\${type} event listener\`, error);
            }
          }
        },
        capture,
      );
    }
    group.listeners.push({ listener, ownerId });
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
        runWithDiagnostics(
          observer.ownerId,
          "mutation",
          matchingMutations.length,
          () => observer.callback(matchingMutations, observer),
        );
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
      this.ownerId = activeModuleId;
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
    const previousModuleId = activeModuleId;
    activeModuleId = id;
    try {
      runWithDiagnostics(id, "initialise", 1, initialise);
    } catch (error) {
      reportModuleError(label, error);
    } finally {
      activeModuleId = previousModuleId;
    }
  }

  function registerModule(id, label, phase, initialise) {
    if (!Object.hasOwn(ENABLED_MODULES, id)) {
      throw new Error(\`Unknown module registration: \${id}\`);
    }
    if (registeredModuleIds.has(id)) {
      throw new Error(\`Duplicate module registration: \${id}\`);
    }
    registeredModuleIds.add(id);

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

  function publishHealthMarker() {
    const root = document.documentElement;
    if (!root) return false;

    const registeredModules = registeredModuleIds.size;
    root.setAttribute(
      HEALTH_ATTRIBUTE,
      JSON.stringify({
        version: MASTER_VERSION,
        registeredModules,
        expectedModules: EXPECTED_MODULE_COUNT,
        healthy: registeredModules === EXPECTED_MODULE_COUNT,
      }),
    );
    return true;
  }

  const suite = {
    SharedMutationObserver,
    addWindowListener,
    registerModule,
    removeStyle,
    setStyle,
  };

  installDiagnostics();
${moduleInitialisers}

  if (!publishHealthMarker()) {
    document.addEventListener("readystatechange", publishHealthMarker, {
      once: true,
    });
  }
  startIdleModules();
})();
`;

const releaseManifest = `${JSON.stringify(
  {
    schemaVersion: 1,
    name: "YouTube Master Suite",
    version: MASTER_VERSION,
    source: "youtube-master-suite.user.js",
    sha256: sha256(output),
    bytes: Buffer.byteLength(output, "utf8"),
    characters: output.length,
    registeredModules: sourceModules.length,
  },
  null,
  2,
)}\n`;

if (checkOnly) {
  const existingOutput = readFileSync(outputPath, "utf8");
  if (existingOutput !== output) {
    throw new Error(
      `${outputPath} is stale; run node build-master.mjs before publishing`,
    );
  }
  const existingReleaseManifest = readFileSync(releaseManifestPath, "utf8");
  if (existingReleaseManifest !== releaseManifest) {
    throw new Error(
      `${releaseManifestPath} is stale; run node build-master.mjs before publishing`,
    );
  }
  console.log(`Verified ${outputPath}`);
} else {
  writeFileSync(outputPath, output, "utf8");
  writeFileSync(releaseManifestPath, releaseManifest, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(`Wrote ${releaseManifestPath}`);
}
console.log(`SHA-256 ${sha256(output)}`);
