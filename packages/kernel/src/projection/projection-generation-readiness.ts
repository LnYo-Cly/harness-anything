import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { HarnessLayoutOverrides } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { projectionDatabaseFileSignature } from "./sqlite-projection-database-signature.ts";
import { projectionVersion } from "./sqlite-projection-store.ts";
import { defaultTaskProjectionPath, readTaskProjection } from "./sqlite-task-projection.ts";
import type { ProjectionReadResult } from "./types.ts";

const readyProjectionGenerationBrand = Symbol("ready-projection-generation");
const issuedReadyProjectionGenerations = new WeakSet<object>();

export interface ReadyProjectionGeneration {
  readonly projectionPath: string;
  readonly sourceHash: string;
  readonly version: string;
  readonly databaseSignature: string;
  readonly [readyProjectionGenerationBrand]: true;
}

export interface EnsureProjectionGenerationOptions {
  readonly rootDir: string;
  readonly layoutOverrides?: HarnessLayoutOverrides;
}

export interface EnsureProjectionGenerationResult {
  readonly ready: ReadyProjectionGeneration;
  readonly warnings: ProjectionReadResult["warnings"];
}

export interface ProjectionGenerationReadinessObserver {
  readonly afterProjectionValidated?: () => void;
}

export class ProjectionGenerationChangedError extends Error {
  constructor(message = "ready projection generation changed; reacquire it before querying") {
    super(message);
    this.name = "ProjectionGenerationChangedError";
  }
}

class ReadyProjectionGenerationHandle implements ReadyProjectionGeneration {
  readonly [readyProjectionGenerationBrand] = true as const;
  readonly projectionPath: string;
  readonly sourceHash: string;
  readonly version: string;
  readonly databaseSignature: string;

  constructor(
    projectionPath: string,
    sourceHash: string,
    version: string,
    databaseSignature: string
  ) {
    this.projectionPath = projectionPath;
    this.sourceHash = sourceHash;
    this.version = version;
    this.databaseSignature = databaseSignature;
    issuedReadyProjectionGenerations.add(this);
    Object.freeze(this);
  }
}

export function ensureProjectionGenerationReady(
  options: EnsureProjectionGenerationOptions,
  observer?: ProjectionGenerationReadinessObserver
): EnsureProjectionGenerationResult {
  const rootDir = path.resolve(options.rootDir);
  const projectionPath = options.layoutOverrides
    ? resolveHarnessLayout({ rootDir, layoutOverrides: options.layoutOverrides }).projectionPath
    : defaultTaskProjectionPath(rootDir);
  const warnings: ProjectionReadResult["warnings"][number][] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = projectionDatabaseFileSignature(projectionPath);
    const projection = readTaskProjection({ rootDir, layoutOverrides: options.layoutOverrides });
    warnings.push(...projection.warnings);
    observer?.afterProjectionValidated?.();
    const snapshot = captureStableProjectionDatabaseIdentity(projectionPath, projectionVersion);
    if (before !== null && before === snapshot.databaseSignature) {
      return {
        ready: new ReadyProjectionGenerationHandle(
          projectionPath,
          snapshot.sourceHash,
          snapshot.version,
          snapshot.databaseSignature
        ),
        warnings
      };
    }
  }
  throw new ProjectionGenerationChangedError("projection database did not stabilize across validation");
}

export function establishReadyProjectionGeneration(
  projectionPath: string,
  expectedVersion: string
): ReadyProjectionGeneration {
  const snapshot = captureStableProjectionDatabaseIdentity(projectionPath, expectedVersion);
  return new ReadyProjectionGenerationHandle(
    projectionPath,
    snapshot.sourceHash,
    snapshot.version,
    snapshot.databaseSignature
  );
}

export function assertReadyProjectionGeneration(
  ready: ReadyProjectionGeneration
): asserts ready is ReadyProjectionGenerationHandle {
  if (!(ready instanceof ReadyProjectionGenerationHandle) || !issuedReadyProjectionGenerations.has(ready)) {
    throw new TypeError("ready projection generation handle was not established by the projection validator");
  }
}

export function assertReadyProjectionDatabaseUnchanged(ready: ReadyProjectionGeneration): void {
  assertReadyProjectionGeneration(ready);
  if (projectionDatabaseSignature(ready.projectionPath) !== ready.databaseSignature) {
    throw new ProjectionGenerationChangedError();
  }
}

export function projectionDatabaseSignature(projectionPath: string): string {
  const signature = projectionDatabaseFileSignature(projectionPath);
  if (signature === null) throw new ProjectionGenerationChangedError("ready projection database is unavailable");
  return signature;
}

function captureStableProjectionDatabaseIdentity(projectionPath: string, expectedVersion: string): {
  readonly sourceHash: string;
  readonly version: string;
  readonly databaseSignature: string;
} {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = projectionDatabaseSignature(projectionPath);
    const db = new DatabaseSync(projectionPath, { readOnly: true });
    let sourceHash: string;
    let version: string;
    try {
      db.exec("BEGIN");
      sourceHash = readRequiredMeta(db, "sourceHash");
      version = readRequiredMeta(db, "version");
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
    const after = projectionDatabaseSignature(projectionPath);
    if (before === after) {
      if (version !== expectedVersion) throw new ProjectionGenerationChangedError("ready projection schema version changed");
      return { sourceHash, version, databaseSignature: after };
    }
  }
  throw new ProjectionGenerationChangedError("projection database did not stabilize while acquiring a ready generation");
}

function readRequiredMeta(db: DatabaseSync, key: string): string {
  const row = db.prepare("SELECT value FROM projection_meta WHERE key = ?").get(key) as { readonly value?: unknown } | undefined;
  if (!row || typeof row.value !== "string" || row.value.length === 0) {
    throw new ProjectionGenerationChangedError(`ready projection metadata is missing ${key}`);
  }
  return row.value;
}
