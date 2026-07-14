import type { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { unresolvedEntityAttribution } from "./entity-attribution-projection.ts";
import type { EntityAttributionProjection } from "./types.ts";

export interface EntityAttributionSummaryRow {
  readonly entityKind: string;
  readonly entityId: string;
  readonly attribution: EntityAttributionProjection;
}

export function ensureEntityAttributionSummaryTable(
  sql: SqlClient.SqlClient
): Effect.Effect<unknown, unknown> {
  return Effect.gen(function* () {
    yield* sql`
      CREATE TABLE IF NOT EXISTS entity_attribution_summary (
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        originator_json TEXT,
        latest_actor_json TEXT,
        trail_count INTEGER NOT NULL,
        completeness TEXT NOT NULL,
        PRIMARY KEY (entity_kind, entity_id)
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS entity_attribution_summary_entity
      ON entity_attribution_summary (entity_id, entity_kind)
    `;
  });
}

export function replaceEntityAttributionSummaries(
  sql: SqlClient.SqlClient,
  rows: ReadonlyArray<EntityAttributionSummaryRow>
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* ensureEntityAttributionSummaryTable(sql);
    yield* sql`DELETE FROM entity_attribution_summary`;
    for (const batch of chunks(rows, 1_000)) yield* insertEntityAttributionSummaries(sql, batch);
  });
}

export function upsertEntityAttributionSummary(
  sql: SqlClient.SqlClient,
  row: EntityAttributionSummaryRow
): Effect.Effect<unknown, unknown> {
  const attribution = row.attribution;
  return sql`
    INSERT INTO entity_attribution_summary (
      entity_kind, entity_id, originator_json, latest_actor_json, trail_count, completeness
    ) VALUES (
      ${row.entityKind}, ${row.entityId},
      ${attribution.originator ? JSON.stringify(attribution.originator) : null},
      ${attribution.latestActor ? JSON.stringify(attribution.latestActor) : null},
      ${attribution.trailCount}, ${attribution.completeness}
    )
    ON CONFLICT (entity_kind, entity_id) DO UPDATE SET
      originator_json = excluded.originator_json,
      latest_actor_json = excluded.latest_actor_json,
      trail_count = excluded.trail_count,
      completeness = excluded.completeness
  `;
}

export function deleteEntityAttributionSummary(
  sql: SqlClient.SqlClient,
  entityKind: string,
  entityId: string
): Effect.Effect<unknown, unknown> {
  return sql`
    DELETE FROM entity_attribution_summary
    WHERE entity_kind = ${entityKind} AND entity_id = ${entityId}
  `;
}

export function attributionSummarySelect(alias: string): string {
  return [
    `${alias}.originator_json AS attribution_originator_json`,
    `${alias}.latest_actor_json AS attribution_latest_actor_json`,
    `COALESCE(${alias}.trail_count, 0) AS attribution_trail_count`,
    `COALESCE(${alias}.completeness, 'unresolved') AS attribution_completeness`
  ].join(", ");
}

export function attributionFromRecord(record: Readonly<Record<string, unknown>>): EntityAttributionProjection {
  const completeness = record.attribution_completeness;
  return {
    originator: parseActor(record.attribution_originator_json),
    latestActor: parseActor(record.attribution_latest_actor_json),
    trailCount: Number(record.attribution_trail_count ?? 0),
    completeness: completeness === "complete" || completeness === "legacy-partial" || completeness === "host-only"
      ? completeness
      : "unresolved"
  };
}

export function unresolvedAttribution(): EntityAttributionProjection {
  return unresolvedEntityAttribution();
}

function insertEntityAttributionSummaries(
  sql: SqlClient.SqlClient,
  rows: ReadonlyArray<EntityAttributionSummaryRow>
): Effect.Effect<unknown, unknown> {
  return sql.unsafe(`
    INSERT INTO entity_attribution_summary (
      entity_kind, entity_id, originator_json, latest_actor_json, trail_count, completeness
    ) VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?)").join(", ")}
  `, rows.flatMap((row) => [
    row.entityKind,
    row.entityId,
    row.attribution.originator ? JSON.stringify(row.attribution.originator) : null,
    row.attribution.latestActor ? JSON.stringify(row.attribution.latestActor) : null,
    row.attribution.trailCount,
    row.attribution.completeness
  ]));
}

function parseActor(value: unknown): EntityAttributionProjection["originator"] {
  return typeof value === "string"
    ? JSON.parse(value) as NonNullable<EntityAttributionProjection["originator"]>
    : null;
}

function chunks<Value>(values: ReadonlyArray<Value>, size: number): ReadonlyArray<ReadonlyArray<Value>> {
  const output: Value[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}
