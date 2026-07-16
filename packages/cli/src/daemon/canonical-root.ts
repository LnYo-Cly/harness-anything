import { realpathSync } from "node:fs";
import path from "node:path";

export function canonicalRootIdentity(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}
