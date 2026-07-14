import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type {
  ProjectionSourceCacheChange,
  ProjectionSourceCacheFileRow,
  ProjectionSourceCacheMetadataRow,
  ProjectionSourceCacheSnapshot,
  ProjectionSourceCacheWatchRow
} from "./sqlite-projection-source-cache.ts";

interface SourceCacheFileRecord {
  readonly cache_kind: unknown;
  readonly source_path: unknown;
  readonly source_kind: unknown;
  readonly owner_id: unknown;
  readonly stat_signature: unknown;
  readonly content_sha256: unknown;
  readonly body: unknown;
}

interface SourceCacheWatchRecord {
  readonly cache_kind: unknown;
  readonly source_path: unknown;
  readonly stat_signature: unknown;
}

interface SourceCacheMetadataRecord {
  readonly cache_kind: unknown;
  readonly payload_json: unknown;
  readonly payload_sha256: unknown;
}

export function readProjectionSourceCacheRows(
  sql: SqlClient.SqlClient
): Effect.Effect<{
  readonly files: ReadonlyArray<ProjectionSourceCacheFileRow>;
  readonly watches: ReadonlyArray<ProjectionSourceCacheWatchRow>;
  readonly metadata: ReadonlyArray<ProjectionSourceCacheMetadataRow>;
}, unknown> {
  return Effect.gen(function* () {
    const files = yield* sql<SourceCacheFileRecord>`
      SELECT cache_kind, source_path, source_kind, owner_id, stat_signature,
             content_sha256, body
      FROM projection_source_cache_files
      ORDER BY cache_kind, source_path
    `;
    const watches = yield* sql<SourceCacheWatchRecord>`
      SELECT cache_kind, source_path, stat_signature
      FROM projection_source_cache_watches
      ORDER BY cache_kind, source_path
    `;
    const metadata = yield* sql<SourceCacheMetadataRecord>`
      SELECT cache_kind, payload_json, payload_sha256
      FROM projection_source_cache_metadata
      ORDER BY cache_kind
    `;
    const attributionBodies = yield* readProjectedAttributionBodies(sql);
    return {
      files: files.map((record) => recordToFileRow(record, attributionBodies)),
      watches: watches.map(recordToWatchRow),
      metadata: metadata.map(recordToMetadataRow)
    };
  });
}

export function readProjectionSourceCacheStoredBody(
  sql: SqlClient.SqlClient,
  cacheKindValue: ProjectionSourceCacheFileRow["cacheKind"],
  sourcePath: string
): Effect.Effect<string | undefined, unknown> {
  return Effect.gen(function* () {
    const [record] = yield* sql<{ readonly body: unknown }>`
      SELECT body FROM projection_source_cache_files
      WHERE cache_kind = ${cacheKindValue} AND source_path = ${sourcePath}
    `;
    return typeof record?.body === "string" ? record.body : undefined;
  });
}

export function replaceProjectionSourceCacheStoredRows(
  sql: SqlClient.SqlClient,
  snapshot: ProjectionSourceCacheSnapshot
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* createProjectionSourceCacheTables(sql);
    yield* sql`DELETE FROM projection_source_cache_files`;
    yield* sql`DELETE FROM projection_source_cache_watches`;
    yield* sql`DELETE FROM projection_source_cache_metadata`;
    for (const rows of chunks(snapshot.files, 1_000)) yield* insertFileRows(sql, rows);
    for (const rows of chunks(snapshot.watches, 500)) yield* insertWatchRows(sql, rows);
    for (const row of snapshot.metadata) yield* upsertMetadataRow(sql, row);
  });
}

export function applyProjectionSourceCacheStoredChange(
  sql: SqlClient.SqlClient,
  change: ProjectionSourceCacheChange
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* createProjectionSourceCacheTables(sql);
    for (const row of change.deleteFiles) yield* deleteCachePath(sql, "projection_source_cache_files", row);
    for (const row of change.upsertFiles) yield* upsertFileRow(sql, row);
    for (const row of change.deleteWatches) yield* deleteCachePath(sql, "projection_source_cache_watches", row);
    for (const row of change.upsertWatches) yield* upsertWatchRow(sql, row);
    for (const row of change.upsertMetadata) yield* upsertMetadataRow(sql, row);
  });
}

function createProjectionSourceCacheTables(sql: SqlClient.SqlClient): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* sql`
      CREATE TABLE IF NOT EXISTS projection_source_cache_files (
        cache_kind TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        owner_id TEXT,
        stat_signature TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        body TEXT,
        PRIMARY KEY (cache_kind, source_path)
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS projection_source_cache_watches (
        cache_kind TEXT NOT NULL,
        source_path TEXT NOT NULL,
        stat_signature TEXT,
        PRIMARY KEY (cache_kind, source_path)
      )
    `;
    yield* sql`
      CREATE TABLE IF NOT EXISTS projection_source_cache_metadata (
        cache_kind TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL
      )
    `;
  });
}

function upsertFileRow(sql: SqlClient.SqlClient, row: ProjectionSourceCacheFileRow): Effect.Effect<unknown, unknown> {
  return sql`
    INSERT OR REPLACE INTO projection_source_cache_files (
      cache_kind, source_path, source_kind, owner_id, stat_signature,
      content_sha256, body
    ) VALUES (
      ${row.cacheKind}, ${row.sourcePath}, ${row.sourceKind}, ${row.ownerId ?? null},
      ${row.statSignature}, ${row.contentSha256}, ${persistedBody(row)}
    )
  `;
}

function insertFileRows(
  sql: SqlClient.SqlClient,
  rows: ReadonlyArray<ProjectionSourceCacheFileRow>
): Effect.Effect<unknown, unknown> {
  return sql.unsafe(`
    INSERT INTO projection_source_cache_files (
      cache_kind, source_path, source_kind, owner_id, stat_signature,
      content_sha256, body
    ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}
  `, rows.flatMap((row) => [
    row.cacheKind,
    row.sourcePath,
    row.sourceKind,
    row.ownerId ?? null,
    row.statSignature,
    row.contentSha256,
    persistedBody(row)
  ]));
}

function upsertWatchRow(sql: SqlClient.SqlClient, row: ProjectionSourceCacheWatchRow): Effect.Effect<unknown, unknown> {
  return sql`
    INSERT OR REPLACE INTO projection_source_cache_watches (cache_kind, source_path, stat_signature)
    VALUES (${row.cacheKind}, ${row.sourcePath}, ${row.statSignature})
  `;
}

function insertWatchRows(
  sql: SqlClient.SqlClient,
  rows: ReadonlyArray<ProjectionSourceCacheWatchRow>
): Effect.Effect<unknown, unknown> {
  return sql.unsafe(`
    INSERT INTO projection_source_cache_watches (cache_kind, source_path, stat_signature)
    VALUES ${rows.map(() => "(?, ?, ?)").join(", ")}
  `, rows.flatMap((row) => [row.cacheKind, row.sourcePath, row.statSignature]));
}

function upsertMetadataRow(sql: SqlClient.SqlClient, row: ProjectionSourceCacheMetadataRow): Effect.Effect<unknown, unknown> {
  return sql`
    INSERT OR REPLACE INTO projection_source_cache_metadata (cache_kind, payload_json, payload_sha256)
    VALUES (${row.cacheKind}, ${row.payloadJson}, ${row.payloadSha256})
  `;
}

function deleteCachePath(
  sql: SqlClient.SqlClient,
  table: "projection_source_cache_files" | "projection_source_cache_watches",
  row: { readonly cacheKind: string; readonly sourcePath: string }
): Effect.Effect<unknown, unknown> {
  return sql.unsafe(`DELETE FROM ${table} WHERE cache_kind = ? AND source_path = ?`, [row.cacheKind, row.sourcePath]);
}

function recordToFileRow(
  record: SourceCacheFileRecord,
  attributionBodies: ReadonlyMap<string, string>
): ProjectionSourceCacheFileRow {
  const kind = cacheKind(record.cache_kind);
  const ownerId = record.owner_id === null ? undefined : String(record.owner_id);
  const body = typeof record.body === "string"
    ? record.body
    : kind === "attribution" && ownerId
      ? attributionBodies.get(ownerId)
      : undefined;
  if (body === undefined) throw new Error(`projection source cache body unavailable: ${String(record.source_path)}`);
  return {
    cacheKind: kind,
    sourcePath: String(record.source_path),
    sourceKind: String(record.source_kind),
    ...(ownerId ? { ownerId } : {}),
    statSignature: String(record.stat_signature),
    contentSha256: String(record.content_sha256),
    body
  };
}

function readProjectedAttributionBodies(
  sql: SqlClient.SqlClient
): Effect.Effect<ReadonlyMap<string, string>, unknown> {
  return Effect.gen(function* () {
    const tables = new Set((yield* sql<{ readonly name: unknown }>`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((record) => String(record.name)));
    const rows: Array<{ readonly event_id: unknown; readonly source_json: unknown }> = [];
    if (tables.has("attribution_events")) rows.push(...yield* sql<{ readonly event_id: unknown; readonly source_json: unknown }>`
      SELECT event_id, source_json FROM attribution_events
    `);
    if (tables.has("attribution_event_headers")) rows.push(...yield* sql<{ readonly event_id: unknown; readonly source_json: unknown }>`
      SELECT event_id, source_json FROM attribution_event_headers
    `);
    return new Map(rows.map((row) => [String(row.event_id), `${String(row.source_json)}\n`]));
  });
}

function persistedBody(row: ProjectionSourceCacheFileRow): string | null {
  return row.cacheKind === "attribution" ? null : row.body;
}

function recordToWatchRow(record: SourceCacheWatchRecord): ProjectionSourceCacheWatchRow {
  return {
    cacheKind: cacheKind(record.cache_kind),
    sourcePath: String(record.source_path),
    statSignature: record.stat_signature === null ? null : String(record.stat_signature)
  };
}

function recordToMetadataRow(record: SourceCacheMetadataRecord): ProjectionSourceCacheMetadataRow {
  return {
    cacheKind: cacheKind(record.cache_kind),
    payloadJson: String(record.payload_json),
    payloadSha256: String(record.payload_sha256)
  };
}

function cacheKind(value: unknown): ProjectionSourceCacheFileRow["cacheKind"] {
  if (value === "task" || value === "attribution") return value;
  throw new Error(`unknown projection source cache kind: ${String(value)}`);
}

function chunks<Value>(values: ReadonlyArray<Value>, size: number): ReadonlyArray<ReadonlyArray<Value>> {
  const output: Value[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}
