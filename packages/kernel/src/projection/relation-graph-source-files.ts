import path from "node:path";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { relationDecisionAuthoredSourceKind } from "./relation-source-manifest.ts";
import type { TaskProjectionSourceHashInput } from "./sqlite-task-source.ts";
import { readDirIfPresent, readTextFileIfPresent, statPathIfPresent } from "./toctou-safe-fs.ts";

export function listRelationTaskDirs(tasksRoot: string): ReadonlyArray<string> {
  if (!statPathIfPresent(tasksRoot)?.isDirectory()) return [];
  const entries = readDirIfPresent(tasksRoot);
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tasksRoot, entry.name))
    .sort();
}

export function listRelationTextFiles(inputPath: string): ReadonlyArray<string> {
  const stat = statPathIfPresent(inputPath);
  if (stat === null) return [];
  if (stat.isFile()) return relationDecisionAuthoredSourceKind(inputPath) === null ? [] : [inputPath];
  if (!stat.isDirectory()) return [];
  const entries = readDirIfPresent(inputPath);
  if (entries === null) return [];
  return entries
    .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
    .flatMap((entry) => listRelationTextFiles(path.join(inputPath, entry.name)))
    .sort();
}

export function relationSourceBodyHints(
  rootInput: HarnessLayoutInput,
  sourceInputs: ReadonlyArray<TaskProjectionSourceHashInput>
): ReadonlyMap<string, string> {
  const rootDir = resolveHarnessLayout(rootInput).rootDir;
  return new Map(sourceInputs.map((input) => [path.resolve(rootDir, input.sourcePath), input.body]));
}

export function relationSourceSnapshot(
  rootInput: HarnessLayoutInput,
  sourceInputs: ReadonlyArray<TaskProjectionSourceHashInput>
): { readonly taskDirs: ReadonlyArray<string>; readonly decisionFiles: ReadonlyArray<string> } | null {
  if (sourceInputs.length === 0) return null;
  const rootDir = resolveHarnessLayout(rootInput).rootDir;
  const taskDirs = sourceInputs
    .filter((input) => input.kind === "task-index")
    .map((input) => path.dirname(path.resolve(rootDir, input.sourcePath)))
    .sort();
  const decisionFiles = sourceInputs
    .filter((input) => input.kind === "decision-document")
    .map((input) => path.resolve(rootDir, input.sourcePath))
    .sort();
  return { taskDirs, decisionFiles };
}

export function readRelationSourceBody(
  filePath: string,
  sourceBodies: ReadonlyMap<string, string>
): string | null {
  return sourceBodies.get(filePath) ?? readTextFileIfPresent(filePath);
}
