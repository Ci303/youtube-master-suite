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

run(process.execPath, ["build-master.mjs", "--check"]);
run(process.execPath, ["--check", userscriptPath]);

const userscript = readFileSync(userscriptPath, "utf8");
const sourceLock = JSON.parse(readFileSync(sourceLockPath, "utf8"));
const expectedUrl =
  "https://raw.githubusercontent.com/Ci303/youtube-master-suite/main/" +
  "youtube-master-suite.user.js";

assert.equal(metadata(userscript, "updateURL"), expectedUrl);
assert.equal(metadata(userscript, "downloadURL"), expectedUrl);
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
    assert.equal(
      git(repositoryPath, "rev-parse", "HEAD"),
      lockedSource.commit,
      `${moduleId}: local HEAD differs from the source lock`,
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
