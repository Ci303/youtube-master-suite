import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const userscriptPath = join(suiteDirectory, "youtube-master-suite.user.js");
const manualCopyPath = join(suiteDirectory, "youtube-master-suite.txt");
const releaseManifestPath = join(suiteDirectory, "release-manifest.json");
const sourceLockPath = join(suiteDirectory, "sources.lock.json");
const releaseMode = process.argv.includes("--release");
const baseOptionIndexes = process.argv
  .map((argument, index) => (argument === "--base" ? index : -1))
  .filter((index) => index !== -1);
if (baseOptionIndexes.length > 1) {
  throw new Error("Specify --base at most once");
}
const baseOptionIndex = baseOptionIndexes[0] ?? -1;
const explicitBaseRef =
  baseOptionIndex === -1 ? null : process.argv[baseOptionIndex + 1];
if (
  baseOptionIndex !== -1 &&
  (!explicitBaseRef || explicitBaseRef.startsWith("-"))
) {
  throw new Error("Usage: node verify-master.mjs [--release] [--base <git-ref>]");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: suiteDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function git(repositoryPath, ...args) {
  return run("git", ["-C", repositoryPath, ...args]);
}

function metadata(source, field) {
  const match = source.match(new RegExp(`^//\\s+@${field}\\s+(.+)$`, "m"));
  assert(match, `Missing @${field} metadata`);
  return match[1].trim();
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function compareVersions(left, right) {
  assert.match(left, /^\d+\.\d+\.\d+$/, `Invalid version: ${left}`);
  assert.match(right, /^\d+\.\d+\.\d+$/, `Invalid version: ${right}`);
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const partCount = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function verifySharedRuntimeContracts(moduleId, source) {
  for (const unsupportedOption of [
    "attributeOldValue",
    "characterDataOldValue",
  ]) {
    assert(
      !source.includes(unsupportedOption),
      `${moduleId}: shared MutationObserver does not support ${unsupportedOption}`,
    );
  }

  const observerNames = [
    ...source.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+MutationObserver\s*\(/g,
    ),
  ].map((match) => match[1]);
  for (const observerName of observerNames) {
    const escapedName = escapeRegExp(observerName);
    const observeCalls = source.match(
      new RegExp(`\\b${escapedName}\\.observe\\s*\\(`, "g"),
    )?.length || 0;
    assert(
      observeCalls <= 1,
      `${moduleId}: shared MutationObserver ${observerName} observes multiple targets`,
    );
    assert(
      !new RegExp(`\\b${escapedName}\\.takeRecords\\s*\\(`).test(source),
      `${moduleId}: shared MutationObserver ${observerName} uses takeRecords()`,
    );
  }

  const sharedWindowEvents = [
    "pageshow",
    "yt-navigate-finish",
    "yt-navigate-start",
    "yt-page-data-updated",
  ];
  for (const eventName of sharedWindowEvents) {
    const unsupportedListenerOptions = new RegExp(
      `window\\.addEventListener\\(\\s*["']${escapeRegExp(eventName)}["']` +
        `[\\s\\S]{0,500}?\\b(?:once|signal)\\s*:`,
    );
    assert(
      !unsupportedListenerOptions.test(source),
      `${moduleId}: shared ${eventName} listener uses once or signal`,
    );
  }
}

run(process.execPath, ["build-master.mjs", "--check"]);
run(process.execPath, ["--check", userscriptPath]);

const userscript = readFileSync(userscriptPath, "utf8");
const releaseManifest = JSON.parse(
  readFileSync(releaseManifestPath, "utf8"),
);
const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
const buildSource = readFileSync(
  join(suiteDirectory, "build-master.mjs"),
  "utf8",
);
const expectedUrl =
  "https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/" +
  "youtube-master-suite.user.js";

assert.equal(metadata(userscript, "updateURL"), expectedUrl);
assert.equal(metadata(userscript, "downloadURL"), expectedUrl);
assert.equal(metadata(userscript, "name"), "YouTube Master Suite");
assert.match(metadata(userscript, "version"), /^\d+\.\d+\.\d+$/);
assert.equal(sourceLock.schemaVersion, 2);
const lockedModules = Object.entries(sourceLock.modules || {});
const expectedModuleCount = lockedModules.length;
assert(expectedModuleCount > 0, "The source lock must contain canonical modules");
const lockedSourcePaths = lockedModules.map(
  ([, lockedSource]) => lockedSource.path,
);
assert.equal(
  new Set(lockedSourcePaths).size,
  lockedSourcePaths.length,
  "The source lock contains duplicate canonical source paths",
);
const canonicalSourcePaths = readdirSync(
  join(suiteDirectory, "sources", "modules"),
  { withFileTypes: true },
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".user.js"))
  .map((entry) => `sources/modules/${entry.name}`)
  .sort();
assert.deepEqual(
  [...lockedSourcePaths].sort(),
  canonicalSourcePaths,
  "Source lock and canonical module directory differ",
);
assert.equal(
  occurrences(userscript, "suite.registerModule("),
  expectedModuleCount,
  "The generated master module count differs from the source lock",
);

assert(
  buildSource.includes(
    String.raw`/\bwindow\s*\.\s*addEventListener\s*\(/g`,
  ),
  "The window-listener transform must tolerate whitespace",
);
assert(
  buildSource.includes(
    String.raw`/\bdocument\s*\.\s*createElement\s*\(\s*["']style["']\s*\)/`,
  ),
  "The stylesheet residual guard must tolerate whitespace and quote variants",
);

const canonicalSources = new Map();
for (const [moduleId, lockedSource] of lockedModules) {
  assert.match(
    lockedSource.path,
    /^sources\/modules\/[a-z0-9-]+\.user\.js$/,
  );
  assert.match(lockedSource.version, /^\d+(?:\.\d+)+$/);
  assert.match(lockedSource.sha256, /^[0-9a-f]{64}$/);
  const canonicalSource = readFileSync(
    join(suiteDirectory, lockedSource.path),
    "utf8",
  ).replace(/\r\n/g, "\n");
  canonicalSources.set(moduleId, canonicalSource);
  verifySharedRuntimeContracts(moduleId, canonicalSource);
  assert.equal(
    metadata(canonicalSource, "version"),
    lockedSource.version,
    `${moduleId}: canonical source version differs from the source lock`,
  );
  assert.equal(
    createHash("sha256").update(canonicalSource).digest("hex"),
    lockedSource.sha256,
    `${moduleId}: canonical source differs from the source lock`,
  );
  assert(
    userscript.includes(
      `${lockedSource.path} | sha256:${lockedSource.sha256}`,
    ),
    `${moduleId}: canonical source manifest entry is missing`,
  );
  assert.match(
    userscript,
    new RegExp(
      `suite\\.registerModule\\(\\s+${JSON.stringify(moduleId).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      )},`,
    ),
    `${moduleId}: generated module registration is missing`,
  );
}

assert(
  !existsSync(
    join(suiteDirectory, "sources/youtube-sponsorblock-queue-width.user.js"),
  ),
  "The vestigial SponsorBlock Queue Width source must not be restored",
);
assert(
  !userscript.includes("SponsorBlock Queue Width (folded"),
  "The generated source manifest must only list canonical modules",
);
assert(
  userscript.includes("sidebarWidthPx: 374"),
  "Watch Layout Cleaner must retain the SponsorBlock-friendly 374px width",
);
assert(
  !userscript.includes("'ytd-masthead #center'"),
  "Feed UI Cleaner must preserve the masthead search area",
);
assert.match(
  userscript,
  /const mo = new MutationObserver\(\(muts\) => \{\s+if \(isButtonInstalled\(\)\) return;/,
  "Miniplayer Button Restorer must skip redundant mutation work once installed",
);
for (const countAlignmentRequirement of [
  ":is(#segmented-like-button, #segmented-dislike-button)",
  "align-self: center !important;",
  "line-height: 24px !important;",
  "vertical-align: middle !important;",
]) {
  assert(
    userscript.includes(countAlignmentRequirement),
    `Missing like/dislike count alignment requirement: ${countAlignmentRequirement}`,
  );
}
assert(
  userscript.includes("--tm-yw-sidebar-width: ${px(CONFIG.sidebarWidthPx)}"),
  "The consolidated SponsorBlock queue-width variable is missing",
);
assert(
  userscript.includes("flex: 0 0 ${px(CONFIG.sidebarWidthPx)} !important"),
  "The consolidated fixed-width right-rail rule is missing",
);

assert.equal(
  occurrences(userscript, "new NativeMutationObserver("),
  1,
  "The master must create exactly one native MutationObserver",
);
assert.equal(
  occurrences(userscript, 'styleElement = document.createElement("style")'),
  1,
  "The master must create exactly one shared stylesheet element",
);

assert(
  userscript.includes('location.pathname === "/feed/history"'),
  "History route exclusion is missing",
);
assert(
  userscript.includes('[data-ytppl-watched-hidden="1"]'),
  "History stale-marker cleanup is missing",
);
for (const staleCommentRequirement of [
  'const STALE_COMMENTS_ATTRIBUTE = "data-iow-stale-video"',
  'a[href*="/watch?"][href*="lc="]',
  "commentsVideoId !== currentVideoId",
  "markCurrentCommentsStale();",
  'attributeFilter: ["href"]',
]) {
  assert(
    userscript.includes(staleCommentRequirement),
    `Missing stale-comment guard requirement: ${staleCommentRequirement}`,
  );
}
assert.match(
  userscript,
  /ytd-comments\[\$\{STALE_COMMENTS_ATTRIBUTE\}="1"\]\s*\{[\s\S]+?visibility:hidden !important;[\s\S]+?opacity:0 !important;[\s\S]+?pointer-events:none !important;/,
  "Stale comments must be hidden without collapsing the lazy-load area",
);
assert.match(
  userscript,
  /function hideWatchedVideos\(root = document\) \{\s+if \(isHistoryPath\(\)\) \{[\s\S]+?setCardHidden\(card, "ytpplWatchedHidden", false\);[\s\S]+?return;/,
  "History must clear watched markers and return before filtering",
);
assert(
  !userscript.includes("hideInfoCardsAndEndScreens"),
  "The combined overlay preference must not be reintroduced",
);
assert(
  !userscript.includes("ytd-watch-next-secondary-results-renderer"),
  "The responsive secondary-results renderer must remain available for comments",
);
for (const preference of [
  "hideInfoCards: true",
  "hideEndScreenRecommendationGrid: true",
  "showAutoplayUpNextCard: true",
]) {
  assert(
    userscript.includes(preference),
    `Missing independent overlay preference: ${preference}`,
  );
}
assert.match(
  userscript,
  /function buildAutoplayUpNextCss\(\) \{[\s\S]+?if \(CONFIG\.showAutoplayUpNextCard\) \{\s+return "";\s+\}[\s\S]+?\.ytp-autonav-endscreen-upnext-container/,
  "The autoplay card must only be hidden when explicitly disabled",
);
assert(
  userscript.includes(".ytp-modern-videowall-still"),
  "The multi-video end-screen recommendation grid must remain hidden",
);
for (const queueRequirement of [
  "showCompactQueueInfo: true",
  'const QUEUE_INFO_ID = "ytsmp-compact-queue-info"',
  "function getCompactQueueState()",
  "function syncCompactQueueInfo()",
  '.ytp-playlist-menu',
  '.ytp-queue-menu',
]) {
  assert(
    userscript.includes(queueRequirement),
    `Missing compact queue requirement: ${queueRequirement}`,
  );
}
assert.match(
  userscript,
  /attributeFilter: \["aria-current", "selected"\]/,
  "Compact queue state must react to current-item attribute changes",
);
assert.match(
  userscript,
  /const QUEUE_PANEL_SELECTOR = \[\s+"ytd-playlist-panel-renderer",\s+"yt-playlist-panel-renderer",\s+\]\.join\(","\);/,
  "Compact queue must support both playlist panel host names",
);
assert.match(
  userscript,
  /currentItem\.querySelector\(QUEUE_ITEM_TITLE_SELECTOR\) \|\|\s+currentItem\.querySelector\(QUEUE_ITEM_TITLE_FALLBACK_SELECTOR\)/,
  "Compact queue must prefer the explicit video title before its fallback",
);

const scrollMiniplayerSource = canonicalSources.get("scrollMiniplayer") || "";
for (const navigationRequirement of [
  "let navigationInProgress = false;",
  "if (navigationInProgress || !isEligiblePath() || isFullscreen()) return false;",
  "if (navigationInProgress || !isEligiblePath() || scrollScheduled) return;",
  "function startMutationObservation()",
  "function stopMutationObservation()",
]) {
  assert(
    scrollMiniplayerSource.includes(navigationRequirement),
    `Missing Scroll Miniplayer navigation requirement: ${navigationRequirement}`,
  );
}
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("yt-navigate-start", \(\) => \{\s+navigationInProgress = true;\s+deactivateImmediately\(\);/,
  "Scroll Miniplayer must lock before navigation cleanup",
);
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("yt-navigate-finish", \(\) => \{\s+navigationInProgress = false;[\s\S]{0,150}?scheduleRouteSync\(\);/,
  "Scroll Miniplayer must release its navigation lock before route sync",
);
assert.match(
  scrollMiniplayerSource,
  /window\.addEventListener\("pageshow", \(\) => \{[\s\S]{0,180}?navigationInProgress = false;[\s\S]{0,180}?scheduleRouteSync\(\);/,
  "Scroll Miniplayer must recover its navigation lock after BFCache restore",
);
assert.match(
  scrollMiniplayerSource,
  /function syncRouteState\(\) \{[\s\S]+?if \(navigationInProgress\) \{[\s\S]+?return;\s+\}\s+if \(!isEligiblePath\(\)\) \{\s+stopMutationObservation\(\);[\s\S]+?return;\s+\}\s+startMutationObservation\(\);/,
  "Scroll Miniplayer mutation observation must be limited to settled routes",
);
assert.match(
  scrollMiniplayerSource,
  /const mutationObserver = new MutationObserver\(\(mutations\) => \{\s+if \(navigationInProgress \|\| !isEligiblePath\(\)\) return;/,
  "Scroll Miniplayer mutation handling must remain inert during navigation",
);
assert(
  scrollMiniplayerSource.includes(
    'url.pathname.match(/^\\/live\\/([^/?#]+)/)',
  ),
  "Compact queue video-ID extraction must support /live/<id> URLs",
);
assert(
  scrollMiniplayerSource.includes("player?.getVideoData?.()?.video_id"),
  "Compact queue matching must consider the active player video ID",
);
const compactQueueFunctionIndex = scrollMiniplayerSource.indexOf(
  "function getCompactQueueState()",
);
const exactQueueMatchIndex = scrollMiniplayerSource.indexOf(
  "(item) => getQueueItemVideoId(item) === currentVideoId",
  compactQueueFunctionIndex,
);
const selectedQueueMatchIndex = scrollMiniplayerSource.indexOf(
  'item.hasAttribute("selected")',
  compactQueueFunctionIndex,
);
assert(
  compactQueueFunctionIndex !== -1 &&
    exactQueueMatchIndex > compactQueueFunctionIndex &&
    selectedQueueMatchIndex > exactQueueMatchIndex,
  "Compact queue must prefer an exact URL/player video-ID match",
);

const playerPreferencesSource =
  canonicalSources.get("playerPreferencesLite") || "";
for (const layoutRefreshRequirement of [
  "const PLAYER_LAYOUT_REFRESH_DELAYS_MS = [0, 100, 500, 1200];",
  "const playerLayoutRefreshAttemptTimers = new Map();",
  "if (playerLayoutRefreshAttemptTimers.has(delay))",
  "playerLayoutRefreshAttemptTimers.delete(delay);",
  "function clearPlayerLayoutRefreshAttempts()",
  "playerLayoutRefreshAttemptTimers.clear();",
]) {
  assert(
    playerPreferencesSource.includes(layoutRefreshRequirement),
    `Missing Player Preferences retry requirement: ${layoutRefreshRequirement}`,
  );
}
assert.match(
  playerPreferencesSource,
  /function handleNavigateStart\(\) \{\s+clearLiveChatCollapseAttempts\(\);\s+clearPlayerLayoutRefreshAttempts\(\);/,
  "Navigation start must cancel pending player-layout retries",
);
const wheelHandlerIndex = playerPreferencesSource.indexOf(
  "function handleWheelVolume(event)",
);
const wheelFastRejectIndex = playerPreferencesSource.indexOf(
  "CONFIG.requireRightMouseButtonForWheelVolume &&",
  wheelHandlerIndex,
);
const wheelPlayerLookupIndex = playerPreferencesSource.indexOf(
  "const player = getPlayerFromTarget(event.target);",
  wheelHandlerIndex,
);
assert(
  wheelHandlerIndex !== -1 &&
    wheelFastRejectIndex > wheelHandlerIndex &&
    wheelPlayerLookupIndex > wheelFastRejectIndex,
  "Ordinary wheel events must be rejected before player DOM lookup",
);
for (const selector of [
  "ytd-miniplayer",
  "ytd-playlist-panel-renderer",
  "ytd-engagement-panel-section-list-renderer",
]) {
  assert(
    userscript.includes(`"${selector}"`),
    `Required excluded surface is missing: ${selector}`,
  );
}

assert.match(
  userscript,
  /const DIAGNOSTICS = Object\.freeze\(\{\s+enabled: false,/,
  "Diagnostics must remain disabled by default",
);
assert(
  userscript.includes("globalThis.__YT_MASTER_DIAGNOSTICS__"),
  "Diagnostics console API is missing",
);
assert(
  userscript.includes(
    'const DIAGNOSTICS_ATTRIBUTE = "data-yt-master-diagnostics"',
  ),
  "Diagnostics DOM bridge is missing",
);
assert.match(
  userscript,
  /document\.documentElement\?\.setAttribute\(\s+DIAGNOSTICS_ATTRIBUTE,\s+JSON\.stringify\(snapshot\),/,
  "Diagnostics snapshots must be available outside the userscript sandbox",
);
assert.match(
  userscript,
  /const HEALTH_ATTRIBUTE = "data-yt-master-suite";/,
  "The always-on Master Suite health marker is missing",
);
assert.match(
  userscript,
  /const moduleStates = new Map\(\);/,
  "The health marker must track per-module runtime state",
);
for (const moduleStatus of ["pending", "initialised", "disabled", "failed"]) {
  assert(
    userscript.includes(`status: "${moduleStatus}"`),
    `The health marker never records ${moduleStatus} modules`,
  );
}
for (const healthField of [
  "registeredModules",
  "enabledModules",
  "initialisedModules",
  "pendingModules",
  "disabledModules",
  "failedModules",
  "ready",
]) {
  assert(
    userscript.includes(`${healthField},`),
    `The health marker is missing ${healthField}`,
  );
}
assert(
  userscript.includes("expectedModules: EXPECTED_MODULE_COUNT,"),
  "The health marker is missing its expected module count",
);
assert.match(
  userscript,
  /healthy:\s+registeredModules === EXPECTED_MODULE_COUNT &&\s+ready &&\s+failedModules\.length === 0,/,
  "The health marker must only report healthy after registration and initialisation",
);
assert.match(
  userscript,
  /endBatch\(\);\s+publishHealthMarker\(\);/,
  "The health marker must be republished after idle module initialisation",
);
for (const coherenceRequirement of [
  'const STALE_ATTRIBUTE = "data-yt-master-page-stale"',
  'const STATE_ATTRIBUTE = "data-yt-master-state"',
  'const EVENTS_ATTRIBUTE = "data-yt-master-events"',
  "urlVideoId === playerVideoId",
  "flexyVideoId !== playerVideoId",
  "mismatchesBeforeWarning: 2",
  'button.textContent = "Reload page data"',
  "button.addEventListener(\"click\", () => location.reload())",
  "globalThis.__YT_MASTER_STATE__",
]) {
  assert(
    userscript.includes(coherenceRequirement),
    `Missing page-coherence requirement: ${coherenceRequirement}`,
  );
}
assert.match(
  userscript,
  /:root\[\$\{STALE_ATTRIBUTE\}\] ytd-watch-metadata,[\s\S]+?:root\[\$\{STALE_ATTRIBUTE\}\] ytd-comments/,
  "Confirmed stale metadata and comments must remain hidden",
);

const userscriptHash = createHash("sha256").update(userscript).digest("hex");
assert.equal(releaseManifest.schemaVersion, 1);
assert.equal(releaseManifest.name, "YouTube Master Suite");
assert.equal(releaseManifest.version, metadata(userscript, "version"));
assert.equal(releaseManifest.source, "youtube-master-suite.user.js");
assert.equal(releaseManifest.sha256, userscriptHash);
assert.equal(releaseManifest.bytes, Buffer.byteLength(userscript, "utf8"));
assert.equal(releaseManifest.characters, userscript.length);
assert.equal(releaseManifest.registeredModules, expectedModuleCount);

if (existsSync(manualCopyPath)) {
  assert.equal(
    readFileSync(manualCopyPath, "utf8"),
    userscript,
    "The manual .txt copy is stale",
  );
} else if (releaseMode) {
  assert.fail("The manual .txt copy is required for a maintainer release check");
}

const versionComparisonRef = explicitBaseRef || "HEAD";
if (explicitBaseRef) {
  try {
    git(suiteDirectory, "rev-parse", "--verify", `${explicitBaseRef}^{commit}`);
  } catch {
    assert.fail(`Unable to resolve --base git ref: ${explicitBaseRef}`);
  }
}

let comparisonUserscript = "";
let comparisonArtifactExists = false;
try {
  git(
    suiteDirectory,
    "cat-file",
    "-e",
    `${versionComparisonRef}:youtube-master-suite.user.js`,
  );
  comparisonArtifactExists = true;
} catch {
  // The generated artefact may not exist in the initial repository commit.
}
if (comparisonArtifactExists) {
  comparisonUserscript = git(
    suiteDirectory,
    "show",
    `${versionComparisonRef}:youtube-master-suite.user.js`,
  );
}
if (
  comparisonUserscript &&
  comparisonUserscript.trimEnd() !== userscript.trimEnd()
) {
  const comparisonVersion = metadata(comparisonUserscript, "version");
  const currentVersion = metadata(userscript, "version");
  assert(
    compareVersions(currentVersion, comparisonVersion) > 0,
    `Generated changes since ${versionComparisonRef} require a master version increase`,
  );
}

if (releaseMode) {
  assert.equal(git(suiteDirectory, "status", "--short"), "");
  assert.equal(
    git(
      suiteDirectory,
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...@{upstream}",
    ),
    "0\t0",
    "Master repository is not synchronised with upstream",
  );
}

console.log(
  `Verified YouTube Master Suite v${metadata(userscript, "version")} ` +
    `(${userscriptHash})`,
);
