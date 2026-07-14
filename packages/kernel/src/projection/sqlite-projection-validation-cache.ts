import type { DeclaredSourceManifestRow } from "./sqlite-declared-source-manifest.ts";
import { projectionDatabaseFileSignature } from "./sqlite-projection-database-signature.ts";
import type { DecisionProjectionRow, ProjectionMeta, TaskProjectionRow } from "./types.ts";
import type { ProjectionSourceCacheSnapshot } from "./sqlite-projection-source-cache.ts";

export interface ProjectionValidationCacheEntry {
  readonly signature: string;
  readonly declaredManifest: ReadonlyArray<DeclaredSourceManifestRow>;
  readonly projection?: {
    readonly rows: ReadonlyArray<TaskProjectionRow>;
    readonly decisionRows: ReadonlyArray<DecisionProjectionRow>;
    readonly meta: ProjectionMeta;
  };
  readonly sourceCache?: ProjectionSourceCacheSnapshot;
}

const projectionValidationCache = new Map<string, ProjectionValidationCacheEntry>();
const projectionValidationCacheLimit = 16;

export function readCachedProjectionValidation(projectionPath: string): ProjectionValidationCacheEntry | null {
  const cached = projectionValidationCache.get(projectionPath);
  if (!cached || projectionDatabaseFileSignature(projectionPath) !== cached.signature) return null;
  projectionValidationCache.delete(projectionPath);
  projectionValidationCache.set(projectionPath, cached);
  return cached;
}

export function rememberProjectionValidation(
  projectionPath: string,
  declaredManifest: ReadonlyArray<DeclaredSourceManifestRow>,
  projection?: ProjectionValidationCacheEntry["projection"],
  sourceCache?: ProjectionSourceCacheSnapshot
): void {
  const signature = projectionDatabaseFileSignature(projectionPath);
  if (signature === null) return;
  projectionValidationCache.delete(projectionPath);
  projectionValidationCache.set(projectionPath, {
    signature,
    declaredManifest,
    ...(projection ? { projection } : {}),
    ...(sourceCache ? { sourceCache } : {})
  });
  while (projectionValidationCache.size > projectionValidationCacheLimit) {
    const oldest = projectionValidationCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    projectionValidationCache.delete(oldest);
  }
}
