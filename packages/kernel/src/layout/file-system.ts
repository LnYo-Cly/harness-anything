import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";

export interface LayoutFileSystem {
  readonly exists: (inputPath: string) => boolean;
  readonly readText: (inputPath: string) => string;
  readonly readDirents: (inputPath: string) => ReadonlyArray<Dirent<string>>;
}

export const layoutFileSystem: LayoutFileSystem = {
  exists: (inputPath) => existsSync(inputPath),
  readText: (inputPath) => readFileSync(inputPath, "utf8"),
  readDirents: (inputPath) => readdirSync(inputPath, { withFileTypes: true })
};
