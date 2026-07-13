import path from "node:path";
import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { HarnessLayoutOverrides } from "../layout/index.ts";
import { createHarnessRuntimeContext, resolveHarnessLayout } from "../layout/index.ts";
import { localRuntimeStateFileSystem } from "../local/local-layout-file-system.ts";
import {
  assertReadyProjectionDatabaseUnchanged,
  establishReadyProjectionGeneration,
  type ReadyProjectionGeneration
} from "./projection-generation-readiness.ts";
import {
  captureExecutionEvidenceTaskTitles,
  captureStableExecutionEvidenceSource,
  captureStableIncrementalExecutionEvidenceSource,
  executionEvidenceTaskTitleSourceTouched
} from "./execution-evidence-source.ts";
import type { ExecutionEvidenceSourceSnapshot } from "./execution-evidence-source.ts";
import {
  applyExecutionEvidenceProjectionDelta,
  hashExecutionEvidenceFacetIntegrityState,
  hashExecutionEvidenceFacetState,
  hashExecutionEvidenceTaskIntegrityLeaf,
  replaceExecutionEvidenceFacetIntegrity,
  replaceExecutionEvidenceProjectionRows
} from "./sqlite-execution-evidence-projection.ts";
import {
  applyDeclaredSourceManifestDelta,
  buildDeclaredProjectionDeltaFromSources,
  declaredSourceManifestRows,
  readDeclaredSourceManifestRows,
  replaceDeclaredSourceManifestRows
} from "./sqlite-declared-source-manifest.ts";
import { projectionDatabaseFileSignature } from "./sqlite-projection-database-signature.ts";
import { runSqlite } from "./sqlite-projection-store.ts";
import type { ProjectionReadResult } from "./types.ts";

export const executionEvidenceProjectionVersion = "execution-evidence/v2";

export interface EnsureExecutionEvidenceGenerationOptions {
  readonly rootDir: string;
  readonly layoutOverrides?: HarnessLayoutOverrides;
}

export interface EnsureExecutionEvidenceGenerationResult {
  readonly ready: ReadyProjectionGeneration;
  readonly warnings: ProjectionReadResult["warnings"];
}

export interface ExecutionEvidenceGenerationObserver {
  readonly afterProjectionValidated?: () => void;
}

export interface UpdateExecutionEvidenceGenerationOptions extends EnsureExecutionEvidenceGenerationOptions {
  readonly touchedPaths: ReadonlyArray<string>;
  readonly previousSourceFingerprint: string;
}

export type ExecutionEvidenceUpdateMode = "incremental" | "rebuild" | "unchanged";

interface ExecutionEvidenceMeta {
  readonly version: string;
  readonly sourceHash: string;
  readonly rowsHash: string;
}

interface ValidatedFacet {
  readonly signature: string;
  readonly meta: ExecutionEvidenceMeta;
}

const validatedFacets = new Map<string, ValidatedFacet>();

export function defaultExecutionEvidenceProjectionPath(rootDir: string): string {
  return resolveHarnessLayout(rootDir).executionEvidenceProjectionPath;
}

export function ensureExecutionEvidenceGenerationReady(
  options: EnsureExecutionEvidenceGenerationOptions,
  observer?: ExecutionEvidenceGenerationObserver
): EnsureExecutionEvidenceGenerationResult {
  const runtimeContext = createHarnessRuntimeContext(options.rootDir, options.layoutOverrides);
  const projectionPath = resolveHarnessLayout(runtimeContext).executionEvidenceProjectionPath;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const source = captureStableExecutionEvidenceSource(runtimeContext);
    if (!executionEvidenceProjectionIsCurrent(projectionPath, source.sourceHash)) {
      writeExecutionEvidenceProjection(projectionPath, source);
    }
    observer?.afterProjectionValidated?.();
    if (!executionEvidenceProjectionIsCurrent(projectionPath, source.sourceHash)) continue;
    const ready = establishReadyProjectionGeneration(
      projectionPath,
      executionEvidenceProjectionVersion
    );
    if (ready.sourceHash !== source.sourceHash) continue;
    const verified = captureStableExecutionEvidenceSource(runtimeContext);
    if (verified.sourceHash !== source.sourceHash) continue;
    assertReadyProjectionDatabaseUnchanged(ready);
    return { ready, warnings: [] };
  }
  throw new Error("execution evidence generation did not stabilize");
}

export function rebuildExecutionEvidenceProjection(
  options: EnsureExecutionEvidenceGenerationOptions
): EnsureExecutionEvidenceGenerationResult {
  const runtimeContext = createHarnessRuntimeContext(options.rootDir, options.layoutOverrides);
  const projectionPath = resolveHarnessLayout(runtimeContext).executionEvidenceProjectionPath;
  const source = captureStableExecutionEvidenceSource(runtimeContext);
  writeExecutionEvidenceProjection(projectionPath, source);
  return {
    ready: establishReadyProjectionGeneration(projectionPath, executionEvidenceProjectionVersion),
    warnings: []
  };
}

export function updateExecutionEvidenceProjectionIncrementally(
  options: UpdateExecutionEvidenceGenerationOptions
): EnsureExecutionEvidenceGenerationResult & { readonly mode: ExecutionEvidenceUpdateMode } {
  const runtimeContext = createHarnessRuntimeContext(options.rootDir, options.layoutOverrides);
  const projectionPath = resolveHarnessLayout(runtimeContext).executionEvidenceProjectionPath;
  if (!executionEvidenceProjectionIsCurrent(projectionPath, options.previousSourceFingerprint)) {
    return { ...rebuildExecutionEvidenceProjection(options), mode: "rebuild" };
  }
  const previousManifest = readDeclaredSourceManifestRows(projectionPath);
  const taskTitles = executionEvidenceTaskTitleSourceTouched(runtimeContext, options.touchedPaths)
    ? captureExecutionEvidenceTaskTitles(runtimeContext)
    : readProjectedExecutionEvidenceTaskTitles(projectionPath);
  const source = captureStableIncrementalExecutionEvidenceSource(
    runtimeContext,
    taskTitles,
    previousManifest,
    options.touchedPaths
  );
  if (source.sourceHash === options.previousSourceFingerprint) {
    return {
      ready: establishReadyProjectionGeneration(projectionPath, executionEvidenceProjectionVersion),
      warnings: [],
      mode: "unchanged"
    };
  }
  const declaredDelta = buildDeclaredProjectionDeltaFromSources(
    runtimeContext,
    previousManifest,
    [source.executionSource]
  );
  runSqlite(projectionPath, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`BEGIN IMMEDIATE`;
    try {
      yield* applyExecutionEvidenceProjectionDelta(sql, declaredDelta);
      yield* applyDeclaredSourceManifestDelta(sql, declaredDelta.manifest);
      yield* updateTaskTitles(sql, source.taskTitles);
      yield* sql`UPDATE projection_meta SET value = ${source.sourceHash} WHERE key = 'sourceHash'`;
      const rowsHash = yield* hashExecutionEvidenceFacetIntegrityState(sql);
      yield* sql`UPDATE projection_meta SET value = ${rowsHash} WHERE key = 'rowsHash'`;
      yield* sql`COMMIT`;
    } catch (error) {
      yield* sql`ROLLBACK`;
      throw error;
    }
  }));
  validatedFacets.delete(projectionPath);
  return {
    ready: establishReadyProjectionGeneration(projectionPath, executionEvidenceProjectionVersion),
    warnings: [],
    mode: "incremental"
  };
}

function executionEvidenceProjectionIsCurrent(
  projectionPath: string,
  sourceHash: string
): boolean {
  if (!localRuntimeStateFileSystem.exists(projectionPath)) return false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const signature = projectionDatabaseFileSignature(projectionPath);
    if (signature === null) return false;
    const cached = validatedFacets.get(projectionPath);
    if (cached?.signature === signature) {
      return cached.meta.version === executionEvidenceProjectionVersion &&
        cached.meta.sourceHash === sourceHash;
    }
    try {
      const meta = readExecutionEvidenceMeta(projectionPath);
      if (meta.version !== executionEvidenceProjectionVersion || meta.sourceHash !== sourceHash) return false;
      const hashes = runSqlite(projectionPath, Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return {
          rowsHash: yield* hashExecutionEvidenceFacetState(sql),
          integrityHash: yield* hashExecutionEvidenceFacetIntegrityState(sql)
        };
      }));
      const after = projectionDatabaseFileSignature(projectionPath);
      if (after === null || after !== signature) continue;
      if (hashes.rowsHash !== meta.rowsHash || hashes.integrityHash !== meta.rowsHash) return false;
      validatedFacets.set(projectionPath, { signature: after, meta });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function writeExecutionEvidenceProjection(
  projectionPath: string,
  source: ExecutionEvidenceSourceSnapshot
): void {
  localRuntimeStateFileSystem.mkdirp(path.dirname(projectionPath));
  const tempPath = `${projectionPath}.${process.pid}.${Date.now()}.tmp`;
  localRuntimeStateFileSystem.remove(tempPath);
  try {
    runSqlite(tempPath, Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA journal_mode = DELETE`;
      yield* sql`BEGIN IMMEDIATE`;
      try {
        yield* sql`CREATE TABLE projection_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
        yield* sql`CREATE TABLE task_projection (task_id TEXT PRIMARY KEY, title TEXT NOT NULL)`;
        for (const rows of chunks(source.taskTitles, 250)) {
          yield* sql.unsafe(
            `INSERT INTO task_projection (task_id, title) VALUES ${rows.map(() => "(?, ?)").join(", ")}`,
            rows.flatMap((row) => [row.taskId, row.title])
          );
        }
        yield* replaceExecutionEvidenceProjectionRows(sql, source.executionRows);
        yield* replaceExecutionEvidenceFacetIntegrity(sql, source.taskTitles, source.executionRows);
        yield* replaceDeclaredSourceManifestRows(sql, declaredSourceManifestRows([source.executionTable]));
        yield* insertExecutionEvidenceMeta(sql, "version", executionEvidenceProjectionVersion);
        yield* insertExecutionEvidenceMeta(sql, "sourceHash", source.sourceHash);
        yield* insertExecutionEvidenceMeta(sql, "rowsHash", "");
        const rowsHash = yield* hashExecutionEvidenceFacetIntegrityState(sql);
        yield* sql`UPDATE projection_meta SET value = ${rowsHash} WHERE key = 'rowsHash'`;
        yield* sql`COMMIT`;
      } catch (error) {
        yield* sql`ROLLBACK`;
        throw error;
      }
    }));
    localRuntimeStateFileSystem.rename(tempPath, projectionPath);
    validatedFacets.delete(projectionPath);
  } catch (error) {
    localRuntimeStateFileSystem.remove(tempPath);
    throw error;
  }
}

function updateTaskTitles(
  sql: SqlClient.SqlClient,
  currentRows: ReadonlyArray<{ readonly taskId: string; readonly title: string }>
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const existingRows = yield* sql<{ readonly task_id: unknown; readonly title: unknown }>`
      SELECT task_id, title FROM task_projection
    `;
    const existing = new Map(existingRows.map((row) => [String(row.task_id), String(row.title)]));
    const currentIds = new Set(currentRows.map((row) => row.taskId));
    for (const taskId of existing.keys()) {
      if (!currentIds.has(taskId)) {
        yield* sql`DELETE FROM task_projection WHERE task_id = ${taskId}`;
        yield* sql`DELETE FROM facet_integrity_leaf WHERE leaf_kind = 'task' AND entity_id = ${taskId}`;
      }
    }
    for (const row of currentRows) {
      if (existing.get(row.taskId) === row.title) continue;
      yield* sql`
        INSERT INTO task_projection (task_id, title) VALUES (${row.taskId}, ${row.title})
        ON CONFLICT (task_id) DO UPDATE SET title = excluded.title
      `;
      const rowHash = hashExecutionEvidenceTaskIntegrityLeaf(row.taskId, row.title);
      yield* sql`
        INSERT INTO facet_integrity_leaf (leaf_kind, entity_id, row_hash)
        VALUES ('task', ${row.taskId}, ${rowHash})
        ON CONFLICT (leaf_kind, entity_id) DO UPDATE SET row_hash = excluded.row_hash
      `;
    }
  });
}

function readExecutionEvidenceMeta(projectionPath: string): ExecutionEvidenceMeta {
  return runSqlite(projectionPath, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly key: unknown; readonly value: unknown }>`
      SELECT key, value FROM projection_meta
    `;
    const meta = new Map(rows.map((row) => [String(row.key), String(row.value)]));
    return {
      version: meta.get("version") ?? "",
      sourceHash: meta.get("sourceHash") ?? "",
      rowsHash: meta.get("rowsHash") ?? ""
    };
  }));
}

function readProjectedExecutionEvidenceTaskTitles(
  projectionPath: string
): ReadonlyArray<{ readonly taskId: string; readonly title: string }> {
  return runSqlite(projectionPath, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly task_id: unknown; readonly title: unknown }>`
      SELECT task_id, title FROM task_projection ORDER BY task_id
    `;
    return rows.map((row) => ({ taskId: String(row.task_id), title: String(row.title) }));
  }));
}

function insertExecutionEvidenceMeta(
  sql: SqlClient.SqlClient,
  key: string,
  value: string
): Effect.Effect<unknown, unknown> {
  return sql`INSERT INTO projection_meta (key, value) VALUES (${key}, ${value})`;
}

function chunks<Value>(
  values: ReadonlyArray<Value>,
  size: number
): ReadonlyArray<ReadonlyArray<Value>> {
  const output: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}
