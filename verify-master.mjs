import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const repositoriesDirectory = resolve(suiteDirectory, "..");
const userscriptPath = join(suiteDirectory, "youtube-master-suite.user.js");
const manualCopyPath = join(suiteDirectory, "youtube-master-suite.txt");
const sourceLockPath = join(suiteDirectory, "sources.lock.json");
const releaseMode = process.argv.includes("--release");

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
const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
const expectedUrl =
  "https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/" +
  "youtube-master-suite.user.js";

assert.equal(metadata(userscript, "updateURL"), expectedUrl);
assert.equal(metadata(userscript, "downloadURL"), expectedUrl);
assert.equal(metadata(userscript, "name"), "YouTube Master Suite");
assert.match(metadata(userscript, "version"), /^\d+\.\d+\.\d+$/);
assert.equal(sourceLock.schemaVersion, 1);
assert.equal(Object.keys(sourceLock.modules || {}).length, 6);

for (const [moduleId, lockedSource] of Object.entries(sourceLock.modules)) {
  assert.match(lockedSource.repository, /^Ci303\/youtube-[a-z-]+$/);
  assert.match(lockedSource.commit, /^[0-9a-f]{40}$/);
  assert.match(lockedSource.path, /\.user\.js$/);
  assert.match(lockedSource.vendoredPath, /^sources\/modules\/.+\.user\.js$/);
  assert.match(lockedSource.sha256, /^[0-9a-f]{64}$/);
  const vendoredSource = readFileSync(
    join(suiteDirectory, lockedSource.vendoredPath),
    "utf8",
  ).replace(/\r\n/g, "\n");
  verifySharedRuntimeContracts(moduleId, vendoredSource);
  assert.equal(
    createHash("sha256").update(vendoredSource).digest("hex"),
    lockedSource.sha256,
    `${moduleId}: vendored source differs from the source lock`,
  );
  assert(
    userscript.includes(`commit:${lockedSource.commit}`),
    `${moduleId}: locked commit missing from generated manifest`,
  );
}

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
assert.match(
  userscript,
  /function hideWatchedVideos\(root = document\) \{\s+if \(isHistoryPath\(\)\) \{[\s\S]+?setCardHidden\(card, "ytpplWatchedHidden", false\);[\s\S]+?return;/,
  "History must clear watched markers and return before filtering",
);
assert(
  !userscript.includes("hideInfoCardsAndEndScreens"),
  "The combined overlay preference must not be reintroduced",
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

if (existsSync(manualCopyPath)) {
  assert.equal(
    readFileSync(manualCopyPath, "utf8"),
    userscript,
    "The manual .txt copy is stale",
  );
} else if (releaseMode) {
  assert.fail("The manual .txt copy is required for a maintainer release check");
}

let headUserscript = "";
try {
  headUserscript = git(suiteDirectory, "show", "HEAD:youtube-master-suite.user.js");
} catch {
  // The generated artefact may not exist in the initial repository commit.
}
if (headUserscript && headUserscript.trimEnd() !== userscript.trimEnd()) {
  assert.notEqual(
    metadata(headUserscript, "version"),
    metadata(userscript, "version"),
    "Generated changes require a master version increase",
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

  for (const [moduleId, lockedSource] of Object.entries(sourceLock.modules)) {
    const repositoryName = lockedSource.repository.split("/").at(-1);
    const repositoryPath = join(repositoriesDirectory, repositoryName);
    assert.equal(
      git(repositoryPath, "status", "--short"),
      "",
      `${moduleId}: source repository is dirty`,
    );
    assert.doesNotThrow(
      () =>
        git(
          repositoryPath,
          "merge-base",
          "--is-ancestor",
          lockedSource.commit,
          "HEAD",
        ),
      `${moduleId}: local HEAD does not contain the locked source commit`,
    );
    const localSource = readFileSync(
      join(repositoryPath, lockedSource.path),
      "utf8",
    ).replace(/\r\n/g, "\n");
    assert.equal(
      createHash("sha256").update(localSource).digest("hex"),
      lockedSource.sha256,
      `${moduleId}: local userscript content differs from the source lock`,
    );
    assert.equal(
      git(
        repositoryPath,
        "rev-list",
        "--left-right",
        "--count",
        "HEAD...@{upstream}",
      ),
      "0\t0",
      `${moduleId}: source repository is not synchronised with upstream`,
    );
  }
}

console.log(
  `Verified YouTube Master Suite v${metadata(userscript, "version")} ` +
    `(${createHash("sha256").update(userscript).digest("hex")})`,
);
