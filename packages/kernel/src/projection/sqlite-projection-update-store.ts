import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { ProjectionMeta, TaskFieldExtensionProjection, TaskProjectionRow, DecisionProjectionRow } from "./types.ts";
import type { ProjectionGraphRows } from "./sqlite-projection-store.ts";
import type { AttributionEvent } from "../schemas/attribution-event.ts";
import { deleteDeclaredProjectionRows, upsertDeclaredProjectionRows } from "./entity-declaration-projection.ts";
import { applyDeclaredSourceManifestDelta, type DeclaredProjectionDelta } from "./sqlite-declared-source-manifest.ts";
import {
  applyAttributionProjectionDelta,
  materializeEntityAttributionSubjects,
  materializeEntityAttributionTargets,
} from "./sqlite-attribution-projection.ts";
import {
  insertCoverageRow,
  insertDecisionRow,
  insertFactAnchor,
  insertRelationEdge,
  insertTaskRow,
  hashAttributionProjectionState,
  queryableTaskFieldExtensions,
  runSqlite
} from "./sqlite-projection-store.ts";

export function updateProjectionDatabase(
  projectionPath: string,
  change: {
    readonly deleteTaskIds: ReadonlyArray<string>;
    readonly upsertTaskRows: ReadonlyArray<TaskProjectionRow>;
    readonly deleteDecisionIds: ReadonlyArray<string>;
    readonly upsertDecisionRows: ReadonlyArray<DecisionProjectionRow>;
    readonly meta: ProjectionMeta;
    readonly graphRows?: ProjectionGraphRows;
    readonly declaredDelta: DeclaredProjectionDelta;
    readonly attributionEvents?: ReadonlyArray<AttributionEvent>;
    readonly taskFieldExtensions?: ReadonlyArray<TaskFieldExtensionProjection>;
  }
): void {
  runSqlite(projectionPath, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projectedTaskFieldExtensions = queryableTaskFieldExtensions(change.taskFieldExtensions ?? []);
    yield* sql`BEGIN IMMEDIATE`;
    try {
      for (const taskId of uniqueProjectionIds(change.deleteTaskIds)) {
        yield* sql`DELETE FROM task_projection WHERE task_id = ${taskId}`;
      }
      for (const row of change.upsertTaskRows) {
        yield* insertTaskRow(sql, row, projectedTaskFieldExtensions);
      }
      for (const decisionId of uniqueProjectionIds(change.deleteDecisionIds)) {
        yield* sql`DELETE FROM decision_projection WHERE decision_id = ${decisionId}`;
      }
      for (const row of change.upsertDecisionRows) {
        yield* insertDecisionRow(sql, row);
      }
      if (change.graphRows) {
        yield* sql`DELETE FROM relation_edges`;
        yield* sql`DELETE FROM relation_coverage`;
        yield* sql`DELETE FROM task_fact_anchors`;
        for (const edge of change.graphRows.relationEdges) yield* insertRelationEdge(sql, edge);
        for (const row of change.graphRows.coverageRows) yield* insertCoverageRow(sql, row);
        for (const row of change.graphRows.factAnchors) yield* insertFactAnchor(sql, row);
      }
      for (const table of change.declaredDelta.tables) {
        yield* deleteDeclaredProjectionRows(sql, table.declaration, table.deletePrimaryKeys);
        yield* upsertDeclaredProjectionRows(sql, table.declaration, table.upsertRows);
      }
      yield* applyDeclaredSourceManifestDelta(sql, change.declaredDelta.manifest);
      if (change.attributionEvents) {
        const affectedSubjects = yield* applyAttributionProjectionDelta(sql, change.attributionEvents);
        yield* materializeEntityAttributionSubjects(sql, affectedSubjects);
        yield* materializeEntityAttributionTargets(sql, changedAttributionTargets(change));
      } else {
        yield* materializeEntityAttributionTargets(sql, changedAttributionTargets(change));
      }
      yield* upsertMeta(sql, "sourceHash", change.meta.sourceHash);
      yield* upsertMeta(sql, "rowsHash", change.meta.rowsHash);
      yield* upsertMeta(sql, "decisionRowsHash", change.meta.decisionRowsHash ?? "");
      yield* upsertMeta(sql, "declaredRowsHash", change.meta.declaredRowsHash ?? "");
      yield* upsertMeta(sql, "declaredManifestHash", change.meta.declaredManifestHash ?? "");
      const attributionRowsHash = yield* hashAttributionProjectionState(sql);
      yield* upsertMeta(sql, "attributionRowsHash", attributionRowsHash);
      yield* upsertMeta(sql, "attributionSourceHash", change.meta.attributionSourceHash ?? "");
      yield* upsertMeta(sql, "taskSourceHash", change.meta.taskSourceHash ?? "");
      yield* upsertMeta(sql, "legacyPersonIdsHash", change.meta.legacyPersonIdsHash ?? "");
      yield* sql`COMMIT`;
    } catch (error) {
      yield* sql`ROLLBACK`;
      throw error;
    }
  }));
}

function changedAttributionTargets(change: {
  readonly upsertTaskRows: ReadonlyArray<TaskProjectionRow>;
  readonly upsertDecisionRows: ReadonlyArray<DecisionProjectionRow>;
  readonly declaredDelta: DeclaredProjectionDelta;
}): ReadonlyArray<{ readonly table: string; readonly id: string }> {
  return [
    ...change.upsertTaskRows.map((row) => ({ table: "task_projection", id: row.taskId })),
    ...change.upsertDecisionRows.map((row) => ({ table: "decision_projection", id: row.decisionId })),
    ...change.declaredDelta.tables.flatMap((table) => {
      const primaryKey = table.declaration.projection.columns.find((column) => column.primaryKey)!;
      return table.upsertRows.map((row) => ({
        table: table.declaration.projection.table,
        id: String(row[primaryKey.name])
      }));
    })
  ];
}

function upsertMeta(sql: SqlClient.SqlClient, key: string, value: string): Effect.Effect<unknown, unknown> {
  return sql`INSERT OR REPLACE INTO projection_meta (key, value) VALUES (${key}, ${value})`;
}

function uniqueProjectionIds(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values)];
}
