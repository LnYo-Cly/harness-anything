import path from "node:path";
import { SqlClient } from "@effect/sql";
import { Effect, Schema } from "effect";
import type {
  EntityDeclaration
} from "../entity/declaration.ts";
import { readField, resolveEntityDocumentPath } from "../entity/declaration.ts";
import type { EntityProjectionColumnDeclaration } from "../entity/registry.ts";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { stablePayloadHash } from "../integrity/stable-hash.ts";
import {
  localLayoutFileSystem,
  localProjectionSourceFileSystem,
  localRuntimeStateFileSystem
} from "../local/local-layout-file-system.ts";
import { quoteIdentifier, runSqlite } from "./sqlite-projection-store.ts";

export type DeclaredProjectionValue = string | number | null;
export type DeclaredProjectionRow = Readonly<Record<string, DeclaredProjectionValue>>;

export interface DeclaredProjectionResult {
  readonly table: string;
  readonly rows: ReadonlyArray<DeclaredProjectionRow>;
}

export interface DeclaredEntityDiscoveryStats {
  readonly directoriesVisited: number;
  readonly entriesVisited: number;
  readonly filesMatched: number;
  readonly cacheHit: boolean;
}

export interface DeclaredEntityDiscoveryResult {
  readonly rows: ReadonlyArray<DeclaredProjectionRow>;
  readonly stats: DeclaredEntityDiscoveryStats;
}

export interface DeclaredEntitySourceInput {
  readonly relativePath: string;
  readonly body: string;
}

export interface DeclaredEntitySourceResult {
  readonly inputs: ReadonlyArray<DeclaredEntitySourceInput>;
  readonly hash: string;
  readonly stats: DeclaredEntityDiscoveryStats;
}

interface DeclaredEntitySourceCacheEntry {
  readonly result: DeclaredEntitySourceResult;
  readonly directorySignatures: ReadonlyMap<string, string>;
  readonly fileSignatures: ReadonlyMap<string, string>;
}

const declaredEntitySourceCache = new Map<string, DeclaredEntitySourceCacheEntry>();
const declaredEntitySourceCacheLimit = 32;

export function projectDeclaredEntities(
  rootInput: HarnessLayoutInput,
  declaration: EntityDeclaration,
  projectionPath: string
): DeclaredProjectionResult {
  const rows = discoverDeclaredEntityRows(rootInput, declaration);
  return projectDeclaredEntityRows(declaration, projectionPath, rows);
}

export function projectDeclaredEntityRows(
  declaration: EntityDeclaration,
  projectionPath: string,
  rows: ReadonlyArray<DeclaredProjectionRow>
): DeclaredProjectionResult {
  localRuntimeStateFileSystem.mkdirp(path.dirname(projectionPath));
  runSqlite(projectionPath, Effect.flatMap(SqlClient.SqlClient, (sql) =>
    replaceDeclaredProjectionRows(sql, declaration, rows)));
  return { table: declaration.projection.table, rows };
}

export function replaceDeclaredProjectionRows(
  sql: SqlClient.SqlClient,
  declaration: EntityDeclaration,
  rows: ReadonlyArray<DeclaredProjectionRow>
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    yield* sql.unsafe(`DROP TABLE IF EXISTS ${quoteIdentifier(declaration.projection.table)}`);
    yield* sql.unsafe(createTableSql(declaration));
    for (const row of rows) yield* insertRow(sql, declaration, row);
  });
}

export function readDeclaredProjectionRows(
  projectionPath: string,
  declaration: EntityDeclaration
): ReadonlyArray<DeclaredProjectionRow> {
  return runSqlite(projectionPath, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = declaration.projection.columns.map((column) => quoteIdentifier(column.name)).join(", ");
    const primaryKey = declaration.projection.columns.find((column) => column.primaryKey)!;
    return yield* sql.unsafe<DeclaredProjectionRow>(
      `SELECT ${columns} FROM ${quoteIdentifier(declaration.projection.table)} ORDER BY ${quoteIdentifier(primaryKey.name)}`
    );
  }));
}

export function discoverDeclaredEntityRows(
  rootInput: HarnessLayoutInput,
  declaration: EntityDeclaration
): ReadonlyArray<DeclaredProjectionRow> {
  return discoverDeclaredEntityProjection(rootInput, declaration).rows;
}

export function discoverDeclaredEntityProjection(
  rootInput: HarnessLayoutInput,
  declaration: EntityDeclaration
): DeclaredEntityDiscoveryResult {
  return projectDeclaredEntitySource(rootInput, declaration, readDeclaredEntitySource(rootInput, declaration));
}

export function readDeclaredEntitySource(
  rootInput: HarnessLayoutInput,
  declaration: EntityDeclaration
): DeclaredEntitySourceResult {
  const layout = resolveHarnessLayout(rootInput);
  const cacheKey = `${layout.authoredRoot}\0${declaration.kind}\0${declaration.rootResolver.pathTemplate}`;
  const cached = declaredEntitySourceCache.get(cacheKey);
  if (cached && sourceCacheEntryMatches(cached)) {
    declaredEntitySourceCache.delete(cacheKey);
    declaredEntitySourceCache.set(cacheKey, cached);
    return {
      ...cached.result,
      stats: { ...cached.result.stats, cacheHit: true }
    };
  }
  const matcher = templateMatcher(declaration.rootResolver.pathTemplate);
  const discovered = listTemplateFiles(layout.authoredRoot, declaration.rootResolver.pathTemplate);
  const inputs: DeclaredEntitySourceInput[] = [];
  for (const relativePath of discovered.files) {
    const match = matcher.pattern.exec(relativePath);
    if (!match) continue;
    const identity = Object.fromEntries(matcher.keys.map((key, index) => [key, match[index + 1]!]));
    resolveEntityDocumentPath(rootInput, declaration, identity);
    const documentPath = path.join(layout.authoredRoot, relativePath);
    inputs.push({ relativePath, body: localLayoutFileSystem.readText(documentPath) });
  }
  const result: DeclaredEntitySourceResult = {
    inputs,
    hash: stablePayloadHash({
      schema: "declared-entity-source/v1",
      kind: declaration.kind,
      inputs
    }),
    stats: {
      directoriesVisited: discovered.directoriesVisited,
      entriesVisited: discovered.entriesVisited,
      filesMatched: inputs.length,
      cacheHit: false
    }
  };
  const directorySignatures = readPathSignatures(discovered.directories);
  const fileSignatures = readPathSignatures(inputs.map((input) => path.join(layout.authoredRoot, input.relativePath)));
  if (directorySignatures && fileSignatures) {
    declaredEntitySourceCache.delete(cacheKey);
    declaredEntitySourceCache.set(cacheKey, { result, directorySignatures, fileSignatures });
    evictDeclaredEntitySourceCache();
  } else {
    declaredEntitySourceCache.delete(cacheKey);
  }
  return result;
}

export function projectDeclaredEntitySource(
  rootInput: HarnessLayoutInput,
  declaration: EntityDeclaration,
  source: DeclaredEntitySourceResult
): DeclaredEntityDiscoveryResult {
  const matcher = templateMatcher(declaration.rootResolver.pathTemplate);
  const rows: DeclaredProjectionRow[] = [];
  for (const input of source.inputs) {
    const match = matcher.pattern.exec(input.relativePath);
    if (!match) continue;
    const identity = Object.fromEntries(matcher.keys.map((key, index) => [key, match[index + 1]!]));
    resolveEntityDocumentPath(rootInput, declaration, identity);
    const raw = declaration.documentCodec.decode(input.body);
    if (raw === undefined) continue;
    const decoded = Schema.decodeUnknownSync(declaration.schema)(raw) as Readonly<Record<string, unknown>>;
    rows.push(projectRow(decoded, declaration.projection.columns));
  }
  const primaryKey = declaration.projection.columns.find((column) => column.primaryKey)!;
  return {
    rows: rows.sort((left, right) => String(left[primaryKey.name]).localeCompare(String(right[primaryKey.name]))),
    stats: source.stats
  };
}

function projectRow(
  entity: Readonly<Record<string, unknown>>,
  columns: ReadonlyArray<EntityProjectionColumnDeclaration>
): DeclaredProjectionRow {
  return Object.fromEntries(columns.map((column) => [column.name, projectValue(readField(entity, column.field), column)]));
}

function projectValue(value: unknown, column: EntityProjectionColumnDeclaration): DeclaredProjectionValue {
  if (value === undefined || value === null) return null;
  if (column.type === "json") return JSON.stringify(value);
  if (column.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`projection field ${column.field} must be boolean`);
    return value ? 1 : 0;
  }
  if (column.type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`projection field ${column.field} must be an integer`);
    return value as number;
  }
  if (typeof value !== "string") throw new Error(`projection field ${column.field} must be text`);
  return value;
}

function createTableSql(declaration: EntityDeclaration): string {
  const columns = declaration.projection.columns.map((column) => {
    const primaryKey = column.primaryKey ? " PRIMARY KEY" : "";
    return `${quoteIdentifier(column.name)} ${sqliteType(column.type)}${primaryKey}`;
  });
  columns.push("attribution_json TEXT NOT NULL DEFAULT '{\"originator\":null,\"latestActor\":null,\"trailCount\":0,\"completeness\":\"unresolved\"}'");
  return `CREATE TABLE ${quoteIdentifier(declaration.projection.table)} (${columns.join(", ")})`;
}

function insertRow(
  sql: SqlClient.SqlClient,
  declaration: EntityDeclaration,
  row: DeclaredProjectionRow
): Effect.Effect<unknown, unknown> {
  const columns = declaration.projection.columns.map((column) => quoteIdentifier(column.name));
  const placeholders = columns.map(() => "?").join(", ");
  const values = declaration.projection.columns.map((column) => row[column.name] ?? null);
  return sql.unsafe(
    `INSERT INTO ${quoteIdentifier(declaration.projection.table)} (${columns.join(", ")}) VALUES (${placeholders})`,
    values
  );
}

function sqliteType(type: EntityProjectionColumnDeclaration["type"]): string {
  return type === "integer" || type === "boolean" ? "INTEGER" : "TEXT";
}

function templateMatcher(template: string): { readonly pattern: RegExp; readonly keys: ReadonlyArray<string> } {
  const keys: string[] = [];
  let source = "";
  let cursor = 0;
  for (const match of template.matchAll(/\{([^{}]+)\}/gu)) {
    source += escapeRegExp(template.slice(cursor, match.index));
    source += "([^/]+)";
    keys.push(match[1]!);
    cursor = match.index + match[0].length;
  }
  source += escapeRegExp(template.slice(cursor));
  return { pattern: new RegExp(`^${source}$`, "u"), keys };
}

function listTemplateFiles(rootPath: string, template: string): {
  readonly files: ReadonlyArray<string>;
  readonly directories: ReadonlyArray<string>;
  readonly directoriesVisited: number;
  readonly entriesVisited: number;
} {
  if (!localLayoutFileSystem.exists(rootPath)) return { files: [], directories: [], directoriesVisited: 0, entriesVisited: 0 };
  const segments = template.split("/");
  const segmentMatchers = segments.map(templateSegmentMatcher);
  const files: string[] = [];
  const directories: string[] = [];
  let directoriesVisited = 0;
  let entriesVisited = 0;
  function visit(directory: string, segmentIndex: number, relativeSegments: ReadonlyArray<string>): void {
    directoriesVisited += 1;
    directories.push(directory);
    for (const entry of localLayoutFileSystem.readDirents(directory)) {
      entriesVisited += 1;
      if (!segmentMatchers[segmentIndex]!.test(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      const nextRelativeSegments = [...relativeSegments, entry.name];
      if (segmentIndex === segments.length - 1) {
        if (!entry.isDirectory()) files.push(nextRelativeSegments.join("/"));
      } else if (entry.isDirectory()) {
        visit(fullPath, segmentIndex + 1, nextRelativeSegments);
      }
    }
  }
  visit(rootPath, 0, []);
  return { files: files.sort(), directories, directoriesVisited, entriesVisited };
}

function sourceCacheEntryMatches(entry: DeclaredEntitySourceCacheEntry): boolean {
  return pathSignaturesMatch(entry.directorySignatures) && pathSignaturesMatch(entry.fileSignatures);
}

function pathSignaturesMatch(signatures: ReadonlyMap<string, string>): boolean {
  for (const [inputPath, expected] of signatures) {
    if (readPathSignature(inputPath) !== expected) return false;
  }
  return true;
}

function readPathSignatures(inputPaths: ReadonlyArray<string>): ReadonlyMap<string, string> | null {
  const signatures = new Map<string, string>();
  for (const inputPath of inputPaths) {
    const signature = readPathSignature(inputPath);
    if (signature === null) return null;
    signatures.set(inputPath, signature);
  }
  return signatures;
}

function readPathSignature(inputPath: string): string | null {
  return localProjectionSourceFileSystem.statSignature(inputPath);
}

function evictDeclaredEntitySourceCache(): void {
  while (declaredEntitySourceCache.size > declaredEntitySourceCacheLimit) {
    const oldest = declaredEntitySourceCache.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    declaredEntitySourceCache.delete(oldest);
  }
}

function templateSegmentMatcher(segment: string): RegExp {
  let source = "";
  let cursor = 0;
  for (const match of segment.matchAll(/\{([^{}]+)\}/gu)) {
    source += escapeRegExp(segment.slice(cursor, match.index));
    source += "[^/]+";
    cursor = match.index + match[0].length;
  }
  source += escapeRegExp(segment.slice(cursor));
  return new RegExp(`^${source}$`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
