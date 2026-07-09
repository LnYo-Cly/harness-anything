import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHarnessLayout, type HarnessLayoutInput } from "../../../../kernel/src/index.ts";
import type { CliResult } from "../../cli/types.ts";

interface RegistryRow {
  readonly id: string;
  readonly bearing: string;
  readonly channel: { readonly pathClass: string; readonly zoneClass: string };
  readonly cliActions?: ReadonlyArray<string>;
  readonly apiRoutes?: ReadonlyArray<string>;
  readonly guiBridgeMethods?: ReadonlyArray<string>;
  readonly writeKinds?: ReadonlyArray<string>;
}

interface DirtyEntry {
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly path: string;
}

type TouchedZone =
  | { readonly ok: true; readonly bearing: string; readonly zoneClass: string; readonly row: RegistryRow }
  | { readonly ok: false; readonly bearing?: string; readonly zoneClass?: string; readonly reason: string };

export function buildDocSyncStatusResult(rootInput: HarnessLayoutInput): CliResult {
  const report = buildDocSyncReport(rootInput);
  return {
    ok: true,
    command: "doc-status",
    rows: report.dirtyFiles.length,
    path: report.authoredRoot,
    report
  };
}

export function buildDocSyncDryRunResult(rootInput: HarnessLayoutInput): CliResult {
  const report = buildDocSyncReport(rootInput);
  return {
    ok: true,
    command: "doc-sync-dry-run",
    rows: report.writeIntentPreview.changes.length,
    path: report.authoredRoot,
    report
  };
}

export function docSyncDirtyWarnings(rootInput: HarnessLayoutInput): ReadonlyArray<Record<string, unknown>> | undefined {
  const report = buildDocSyncReport(rootInput);
  if (report.dirtyFiles.length === 0) return undefined;
  return [{
    severity: "warning",
    code: "doc_sync_dirty",
    message: `Doc sync has ${report.dirtyFiles.length} dirty file(s); run ha doc status before task closeout or decision propose.`,
    dirtyCount: report.dirtyFiles.length,
    forbiddenTouchCount: report.forbiddenTouches.length,
    unresolvedCount: report.unresolvedTouches.length,
    deletionCount: report.deletions.length
  }];
}

function buildDocSyncReport(rootInput: HarnessLayoutInput) {
  const layout = resolveHarnessLayout(rootInput);
  const authoredRoot = path.relative(layout.rootDir, layout.authoredRoot).split(path.sep).join("/") || ".";
  const registry = loadRegistry(layout.rootDir);
  const dirtyFiles = gitDirtyEntries(layout.authoredRoot);
  const files = dirtyFiles.map((entry) => inspectDirtyFile(layout.rootDir, layout.authoredRoot, entry, registry.rows));
  const candidateBlobs = files.filter((entry) => entry.docSyncCandidate && entry.newBlobSha256);
  const forbiddenTouches = files.flatMap((entry) => entry.forbiddenTouches);
  const unresolvedTouches = files.flatMap((entry) => entry.unresolvedTouches);
  const deletions = files.filter((entry) => entry.status === "deleted");
  return {
    schema: "doc-sync-status/v1",
    registry: { path: "tools/write-road-registry.json", sha256: registry.sha256 },
    authoredRoot,
    baseLedgerSha: gitText(layout.authoredRoot, ["rev-parse", "HEAD"]),
    dirtyFiles: files,
    forbiddenTouches,
    unresolvedTouches,
    deletions,
    candidateBlobs,
    readyToSubmitPreview: forbiddenTouches.length === 0 && unresolvedTouches.length === 0 && deletions.length === 0,
    deletionPolicy: "undefined-pending-phase-2",
    writeIntentPreview: {
      schema: "daemon.doc-sync-submit-request/v1-preview",
      submitImplemented: false,
      changes: candidateBlobs.map((entry) => ({
        path: entry.path,
        baseBlobSha256: entry.baseBlobSha256,
        newBlobSha256: entry.newBlobSha256,
        mediaType: entry.mediaType,
        size: entry.size,
        declaredBearing: "task-document",
        declaredZoneClass: "task-authored-prose-or-stage",
        declaredPathClass: entry.pathClass
      }))
    }
  };
}

function inspectDirtyFile(rootDir: string, authoredRoot: string, entry: DirtyEntry, rows: ReadonlyArray<RegistryRow>) {
  const absolutePath = path.join(authoredRoot, entry.path);
  const currentBody = existsSync(absolutePath) && entry.status !== "deleted" ? readFileSync(absolutePath, "utf8") : null;
  const baseBody = gitText(authoredRoot, ["show", `HEAD:${entry.path}`]);
  const zones = classifyTouchedZones(entry.path, entry.status, baseBody, currentBody, rows);
  const forbiddenTouches = zones.flatMap((zone) => zone.ok && zone.row.channel.pathClass === "rpc-only" ? [forbiddenTouch(entry.path, zone)] : []);
  const unresolvedTouches = zones.flatMap((zone) => zone.ok ? [] : [{ path: entry.path, reason: zone.reason, bearing: zone.bearing, zoneClass: zone.zoneClass }]);
  const okZones = zones.filter((zone): zone is Extract<TouchedZone, { readonly ok: true }> => zone.ok);
  const docSyncCandidate = entry.status !== "deleted" && okZones.length > 0 && okZones.every((zone) => zone.row.channel.pathClass.startsWith("doc-sync-allowed"));
  return {
    path: entry.path,
    rootPath: path.relative(rootDir, absolutePath).split(path.sep).join("/"),
    status: entry.status,
    baseBlobSha256: baseBody === null ? null : sha256(baseBody),
    newBlobSha256: currentBody === null ? null : sha256(currentBody),
    size: currentBody === null ? 0 : Buffer.byteLength(currentBody),
    mediaType: mediaType(entry.path),
    pathClass: okZones[0]?.row.channel.pathClass ?? null,
    zoneClassesTouched: [...new Set(okZones.map((zone) => zone.zoneClass))],
    docSyncCandidate,
    forbiddenTouches,
    unresolvedTouches
  };
}

function classifyTouchedZones(pathInput: string, status: DirtyEntry["status"], baseBody: string | null, currentBody: string | null, rows: ReadonlyArray<RegistryRow>): ReadonlyArray<TouchedZone> {
  if (status === "deleted") return [unresolved("doc sync deletion is not defined in Phase 1")];
  const normalized = pathInput.split(path.sep).join("/");
  if (normalized === "modules.json") return rowZones(rows, "module-registry", "module-authored-structured");
  if (normalized.startsWith("decisions/")) return rowZones(rows, "decision", "decision-authored-structured");
  if (!normalized.startsWith("tasks/")) return [unresolved("path is outside the registered doc-sync task document surface")];
  if (normalized.endsWith("/facts.md")) return rowZones(rows, "task-fact", "task-authored-structured");
  if (normalized.endsWith("/INDEX.md") && frontmatterChanged(baseBody, currentBody)) {
    return rowZones(rows, "task-lifecycle", "task-authored-structured");
  }
  return rowZones(rows, "task-document", "task-authored-prose-or-stage");
}

function rowZones(rows: ReadonlyArray<RegistryRow>, bearing: string, zoneClass: string): ReadonlyArray<TouchedZone> {
  const matches = rows.filter((row) => row.bearing === bearing && row.channel.zoneClass === zoneClass);
  if (matches.length === 0) return [unresolved(`registry row resolution failed for ${bearing}/${zoneClass}`, bearing, zoneClass)];
  return matches.map((row) => ({ ok: true, bearing, zoneClass, row }));
}

function unresolved(reason: string, bearing?: string, zoneClass?: string): TouchedZone {
  return { ok: false, reason, ...(bearing ? { bearing } : {}), ...(zoneClass ? { zoneClass } : {}) };
}

function forbiddenTouch(filePath: string, zone: Extract<TouchedZone, { readonly ok: true }>) {
  return {
    path: filePath,
    hunks: [{
      hunkId: "dirty-file",
      oldStartLine: null,
      oldEndLine: null,
      newStartLine: null,
      newEndLine: null,
      bearing: zone.bearing,
      zoneClass: zone.zoneClass,
      registryRowId: zone.row.id,
      pathClass: zone.row.channel.pathClass,
      summary: `Dirty doc-sync candidate touches ${zone.row.id}.`,
      requiredRpc: {
        registryRowId: zone.row.id,
        ...(zone.row.cliActions ? { cliActions: zone.row.cliActions } : {}),
        ...(zone.row.apiRoutes ? { apiRoutes: zone.row.apiRoutes } : {}),
        ...(zone.row.guiBridgeMethods ? { guiBridgeMethods: zone.row.guiBridgeMethods } : {}),
        ...(zone.row.writeKinds ? { writeKinds: zone.row.writeKinds } : {})
      }
    }]
  };
}

function loadRegistry(rootDir: string): { readonly sha256: string; readonly rows: ReadonlyArray<RegistryRow> } {
  const body = readFileSync(registryPath(rootDir), "utf8");
  const parsed = JSON.parse(body) as { readonly rows?: ReadonlyArray<RegistryRow> };
  return { sha256: sha256(body), rows: parsed.rows ?? [] };
}

function registryPath(rootDir: string): string {
  const candidates = [
    path.join(rootDir, "tools", "write-road-registry.json"),
    path.join(process.cwd(), "tools", "write-road-registry.json"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../tools/write-road-registry.json")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function gitDirtyEntries(authoredRoot: string): ReadonlyArray<DirtyEntry> {
  const output = gitText(authoredRoot, ["status", "--porcelain", "--untracked-files=all", "--", "."]) ?? "";
  return output.split(/\r?\n/u).filter(Boolean).map(parsePorcelainLine);
}

function parsePorcelainLine(line: string): DirtyEntry {
  const code = line.slice(0, 2);
  const rawPath = line.slice(3);
  const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)! : rawPath;
  const status = code === "??" || code.includes("A")
    ? "added"
    : code.includes("D") ? "deleted" : code.includes("R") ? "renamed" : "modified";
  return { status, path: renamedPath };
}

function gitText(cwd: string, args: ReadonlyArray<string>): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trimEnd();
  } catch {
    return null;
  }
}

function frontmatterChanged(baseBody: string | null, currentBody: string | null): boolean {
  return frontmatterBlock(baseBody ?? "") !== frontmatterBlock(currentBody ?? "");
}

function frontmatterBlock(body: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(body);
  return match?.[0] ?? "";
}

function mediaType(filePath: string): string {
  if (filePath.endsWith(".md")) return "text/markdown";
  if (filePath.endsWith(".json")) return "application/json";
  return "text/plain";
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
