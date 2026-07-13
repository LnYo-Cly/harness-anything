import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { readDeclaredSourceManifestRows } from "./sqlite-declared-source-manifest.ts";
import { captureProjectionSourceFingerprint } from "./projection-source-snapshot.ts";

export function captureAuthoredProjectionFingerprint(rootInput: HarnessLayoutInput): string {
  const projectionPath = resolveHarnessLayout(rootInput).projectionPath;
  let hints: ReturnType<typeof readDeclaredSourceManifestRows> = [];
  try {
    hints = readDeclaredSourceManifestRows(projectionPath);
  } catch {
    // A missing or invalid generated manifest is not authoritative; source capture still proceeds.
  }
  return captureProjectionSourceFingerprint(rootInput, hints).fingerprint;
}
