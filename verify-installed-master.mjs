import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const installedPath = process.argv[2];

if (!installedPath) {
  throw new Error(
    "Usage: node verify-installed-master.mjs <installed-or-exported-source-path>",
  );
}

const manifest = JSON.parse(
  readFileSync(resolve(suiteDirectory, "release-manifest.json"), "utf8"),
);
const installedSource = readFileSync(resolve(installedPath), "utf8");
const installedHash = createHash("sha256")
  .update(installedSource, "utf8")
  .digest("hex");
const registrationCount =
  installedSource.match(/suite\.registerModule\s*\(/g)?.length || 0;

assert.equal(manifest.schemaVersion, 1, "Unsupported release manifest");
assert.equal(manifest.name, "YouTube Master Suite", "Unexpected manifest name");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "Invalid manifest version");
assert.equal(
  manifest.source,
  "youtube-master-suite.user.js",
  "Unexpected manifest source",
);
assert.match(manifest.sha256, /^[0-9a-f]{64}$/, "Invalid manifest hash");
assert(
  Number.isInteger(manifest.registeredModules) &&
    manifest.registeredModules > 0,
  "Manifest module count must be a positive integer",
);
assert.equal(
  Buffer.byteLength(installedSource, "utf8"),
  manifest.bytes,
  "Installed source byte length differs from the release manifest",
);
assert.equal(
  installedSource.length,
  manifest.characters,
  "Installed source character length differs from the release manifest",
);
assert.equal(
  installedHash,
  manifest.sha256,
  "Installed source hash differs from the release manifest",
);
assert.equal(
  registrationCount,
  manifest.registeredModules,
  "Installed source module registration count differs from the release manifest",
);

console.log(
  `Verified installed YouTube Master Suite v${manifest.version} ` +
    `(${manifest.sha256})`,
);
