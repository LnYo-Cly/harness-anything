import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ignoredDirectories = new Set(["node_modules", "dist", "coverage", ".git"]);
const productRoots = ["packages", "tools", ".github"];

export function collectProductFileHashes(rootDir) {
  return Object.fromEntries(productRoots
    .flatMap((relativeRoot) => walkFiles(rootDir, relativeRoot))
    .sort()
    .map((relativePath) => [relativePath, sha256(readFileSync(path.join(rootDir, relativePath))) ]));
}

export function diffFileHashes(current, previous) {
  const previousHashes = previous ?? {};
  const added = Object.keys(current).filter((file) => previousHashes[file] === undefined).sort();
  const changed = Object.keys(current).filter((file) => previousHashes[file] !== undefined && previousHashes[file] !== current[file]).sort();
  const deleted = Object.keys(previousHashes).filter((file) => current[file] === undefined).sort();
  return { added, changed, deleted };
}

export function selectPriorSnapshot(snapshotPaths, currentTaskId, displayRoot = null) {
  const warnings = [];
  const candidates = [];
  for (const snapshotPath of [...new Set(snapshotPaths)].sort()) {
    if (!existsSync(snapshotPath)) continue;
    try {
      const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
      if (snapshot.schema !== "architecture-rot-snapshot/v1") throw new Error("unexpected schema");
      if (typeof snapshot.coordinationTaskId !== "string" || !snapshot.coordinationTaskId) throw new Error("missing task id");
      const taskDirectory = path.basename(path.dirname(path.dirname(snapshotPath)));
      if (snapshot.coordinationTaskId === currentTaskId || taskDirectory.startsWith(`${currentTaskId}-`) || taskDirectory === currentTaskId) continue;
      const generatedAt = Date.parse(snapshot.generatedAt);
      if (!Number.isFinite(generatedAt)) throw new Error("invalid generatedAt");
      candidates.push({ snapshot, snapshotPath, generatedAt, taskId: snapshot.coordinationTaskId });
    } catch (error) {
      warnings.push(`Ignored invalid architecture rot snapshot ${displaySnapshotPath(snapshotPath, displayRoot)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  candidates.sort((left, right) => right.generatedAt - left.generatedAt || right.taskId.localeCompare(left.taskId));
  const selected = candidates[0];
  return selected ? {
    snapshot: selected.snapshot,
    sourcePath: selected.snapshotPath,
    warnings
  } : { snapshot: null, sourcePath: null, warnings };
}

function displaySnapshotPath(snapshotPath, displayRoot) {
  if (typeof displayRoot !== "string" || !path.isAbsolute(displayRoot)) return toSlash(snapshotPath);
  const relative = path.relative(displayRoot, snapshotPath);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? toSlash(relative)
    : toSlash(snapshotPath);
}

export function trustedCanonicalRoot(root) {
  if (root?.verification !== "verified" || typeof root.realpath !== "string" || !path.isAbsolute(root.realpath)) {
    throw new Error("Trusted repository root provenance is required");
  }
  return root.realpath;
}

function walkFiles(rootDir, relativeRoot) {
  const absoluteRoot = path.join(rootDir, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  return walkDirectory(rootDir, absoluteRoot);
}

function walkDirectory(rootDir, directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : walkDirectory(rootDir, entryPath);
    return entry.isFile() ? [toSlash(path.relative(rootDir, entryPath))] : [];
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toSlash(value) {
  return value.split(path.sep).join("/");
}
