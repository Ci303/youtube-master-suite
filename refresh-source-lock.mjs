import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const lockPath = join(suiteDirectory, "sources.lock.json");
const sourceLock = JSON.parse(readFileSync(lockPath, "utf8"));

function sha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function metadata(source, field) {
  const match = source.match(new RegExp(`^//\\s+@${field}\\s+(.+)$`, "m"));
  if (!match) throw new Error(`Missing @${field} metadata`);
  return match[1].trim();
}

if (sourceLock.schemaVersion !== 2) {
  throw new Error(`Unsupported source-lock schema ${sourceLock.schemaVersion}`);
}

const modules = Object.entries(sourceLock.modules || {});
if (modules.length !== 6) {
  throw new Error(`Expected 6 canonical modules, found ${modules.length}`);
}

const sourcePaths = new Set();
for (const [moduleId, lockedSource] of modules) {
  if (!/^sources\/modules\/[a-z0-9-]+\.user\.js$/.test(lockedSource.path)) {
    throw new Error(`${moduleId}: invalid canonical source path`);
  }
  if (sourcePaths.has(lockedSource.path)) {
    throw new Error(`${moduleId}: duplicate canonical source path`);
  }
  sourcePaths.add(lockedSource.path);

  const source = readFileSync(join(suiteDirectory, lockedSource.path), "utf8")
    .replace(/\r\n/g, "\n");
  lockedSource.version = metadata(source, "version");
  lockedSource.sha256 = sha256(source);
}

writeFileSync(lockPath, `${JSON.stringify(sourceLock, null, 2)}\n`, "utf8");
console.log(`Updated ${lockPath}`);
