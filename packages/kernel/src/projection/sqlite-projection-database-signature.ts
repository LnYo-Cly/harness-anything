import { localProjectionSourceFileSystem } from "../local/local-layout-file-system.ts";

export function projectionDatabaseFileSignature(projectionPath: string): string | null {
  const database = localProjectionSourceFileSystem.statSignature(projectionPath);
  if (database === null) return null;
  return JSON.stringify({
    database,
    rollbackJournal: localProjectionSourceFileSystem.statSignatureIfNonEmpty(`${projectionPath}-journal`),
    writeAheadLog: localProjectionSourceFileSystem.statSignatureIfNonEmpty(`${projectionPath}-wal`)
  });
}
