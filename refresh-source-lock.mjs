import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const suiteDirectory = dirname(fileURLToPath(import.meta.url));
const repositoriesDirectory = resolve(suiteDirectory, "..");
const lockPath = join(suiteDirectory, "sources.lock.json");
const sourceLock = JSON.parse(readFileSync(lockPath, "utf8"));
const vendoredSourcesDirectory = join(suiteDirectory, "sources/modules");

function git(repositoryPath, ...args) {
  return execFileSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
  }).trim();
}

function sha256(source) {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

mkdirSync(vendoredSourcesDirectory, { recursive: true });

for (const [moduleId, lockedSource] of Object.entries(sourceLock.modules || {})) {
  const repositoryName = lockedSource.repository.split("/").at(-1);
  const repositoryPath = join(repositoriesDirectory, repositoryName);
  const origin = git(repositoryPath, "remote", "get-url", "origin")
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/");
  const expectedOrigin = `https://github.com/${lockedSource.repository}`;
  if (origin !== expectedOrigin) {
    throw new Error(
      `${moduleId}: expected origin ${expectedOrigin}, found ${origin}`,
    );
  }

  const status = git(repositoryPath, "status", "--short");
  if (status) {
    throw new Error(`${moduleId}: source repository has uncommitted changes`);
  }

  const branch = git(repositoryPath, "branch", "--show-current");
  if (branch !== "main") {
    throw new Error(`${moduleId}: expected main branch, found ${branch}`);
  }

  const [ahead, behind] = git(
    repositoryPath,
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...@{upstream}",
  )
    .split(/\s+/)
    .map(Number);
  if (ahead !== 0 || behind !== 0) {
    throw new Error(
      `${moduleId}: source repository is not synchronised with its upstream`,
    );
  }

  lockedSource.commit = git(repositoryPath, "rev-parse", "HEAD");
  lockedSource.vendoredPath = `sources/modules/${lockedSource.path}`;
  const sourcePath = join(repositoryPath, lockedSource.path);
  const vendoredPath = join(suiteDirectory, lockedSource.vendoredPath);
  copyFileSync(sourcePath, vendoredPath);
  lockedSource.sha256 = sha256(
    readFileSync(vendoredPath, "utf8").replace(/\r\n/g, "\n"),
  );
}

writeFileSync(lockPath, `${JSON.stringify(sourceLock, null, 2)}\n`, "utf8");
console.log(`Updated ${lockPath}`);
