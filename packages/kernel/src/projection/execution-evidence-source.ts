import path from "node:path";
import { executionDeclaration } from "../entity/execution-declaration.ts";
import { sha256Text, stablePayloadHash } from "../integrity/stable-hash.ts";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { localProjectionSourceFileSystem } from "../local/local-layout-file-system.ts";
import { readFrontmatter, readScalar } from "../markdown/frontmatter.ts";
import {
  projectDeclaredEntitySource,
  readDeclaredEntitySource,
  type DeclaredEntitySourceHint,
  type DeclaredEntitySourceInput,
  type DeclaredEntitySourceResult,
  type DeclaredProjectionRow
} from "./entity-declaration-projection.ts";
import type {
  DeclaredEntitySourceSnapshot,
  DeclaredProjectionSnapshot
} from "./projection-source-snapshot.ts";

export interface ExecutionEvidenceTaskTitleRow {
  readonly taskId: string;
  readonly title: string;
}

export interface ExecutionEvidenceSourceSnapshot {
  readonly taskTitles: ReadonlyArray<ExecutionEvidenceTaskTitleRow>;
  readonly executionRows: ReadonlyArray<DeclaredProjectionRow>;
  readonly executionTable: DeclaredProjectionSnapshot;
  readonly sourceHash: string;
}

export interface IncrementalExecutionEvidenceSourceSnapshot {
  readonly taskTitles: ReadonlyArray<ExecutionEvidenceTaskTitleRow>;
  readonly executionSource: DeclaredEntitySourceSnapshot;
  readonly sourceHash: string;
}

export function captureStableExecutionEvidenceSource(
  rootInput: HarnessLayoutInput
): ExecutionEvidenceSourceSnapshot {
  let previous = captureExecutionEvidenceSource(rootInput);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = captureExecutionEvidenceSource(rootInput);
    if (current.sourceHash === previous.sourceHash) return current;
    previous = current;
  }
  throw new Error("execution evidence authored sources did not stabilize");
}

export function captureExecutionEvidenceTaskTitles(
  rootInput: HarnessLayoutInput
): ReadonlyArray<ExecutionEvidenceTaskTitleRow> {
  return readExecutionEvidenceTaskTitles(rootInput);
}

export function captureStableIncrementalExecutionEvidenceSource(
  rootInput: HarnessLayoutInput,
  taskTitles: ReadonlyArray<ExecutionEvidenceTaskTitleRow>,
  sourceHints: ReadonlyArray<DeclaredEntitySourceHint>,
  touchedPaths: ReadonlyArray<string>
): IncrementalExecutionEvidenceSourceSnapshot {
  let previous = captureIncrementalExecutionEvidenceSource(rootInput, taskTitles, sourceHints, touchedPaths);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = captureIncrementalExecutionEvidenceSource(rootInput, taskTitles, sourceHints, touchedPaths);
    if (current.sourceHash === previous.sourceHash) return current;
    previous = current;
  }
  throw new Error("incremental execution evidence authored sources did not stabilize");
}

export function executionEvidenceTaskTitleSourceTouched(
  rootInput: HarnessLayoutInput,
  touchedPaths: ReadonlyArray<string>
): boolean {
  const tasksRoot = canonicalProjectionSourcePath(resolveHarnessLayout(rootInput).tasksRoot);
  return touchedPaths.some((inputPath) => {
    const relative = path.relative(tasksRoot, canonicalProjectionSourcePath(inputPath));
    return relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      path.basename(relative) === "INDEX.md";
  });
}

function captureExecutionEvidenceSource(
  rootInput: HarnessLayoutInput
): ExecutionEvidenceSourceSnapshot {
  const taskTitles = readExecutionEvidenceTaskTitles(rootInput);
  const executionSource = readDeclaredEntitySource(rootInput, executionDeclaration);
  const executions = projectDeclaredEntitySource(rootInput, executionDeclaration, executionSource);
  const executionTable = {
    declaration: executionDeclaration,
    table: executionDeclaration.projection.table,
    rows: executions.rows,
    documents: executions.documents
  } satisfies DeclaredProjectionSnapshot;
  return {
    taskTitles,
    executionRows: executions.rows,
    executionTable,
    sourceHash: executionEvidenceSourceHash(taskTitles, executionSource.hash)
  };
}

function captureIncrementalExecutionEvidenceSource(
  rootInput: HarnessLayoutInput,
  taskTitles: ReadonlyArray<ExecutionEvidenceTaskTitleRow>,
  sourceHints: ReadonlyArray<DeclaredEntitySourceHint>,
  touchedPaths: ReadonlyArray<string>
): IncrementalExecutionEvidenceSourceSnapshot {
  const source = readIncrementalExecutionSource(rootInput, sourceHints, touchedPaths);
  return {
    taskTitles,
    executionSource: {
      declaration: executionDeclaration,
      table: executionDeclaration.projection.table,
      source
    },
    sourceHash: executionEvidenceSourceHash(taskTitles, source.hash)
  };
}

function readIncrementalExecutionSource(
  rootInput: HarnessLayoutInput,
  sourceHints: ReadonlyArray<DeclaredEntitySourceHint>,
  touchedPaths: ReadonlyArray<string>
): DeclaredEntitySourceResult {
  const authoredRoot = canonicalProjectionSourcePath(resolveHarnessLayout(rootInput).authoredRoot);
  const touchedSourcePaths = new Set(touchedPaths
    .map((inputPath) => relativeExecutionSourcePath(authoredRoot, inputPath))
    .filter((sourcePath): sourcePath is string => sourcePath !== undefined));
  const previousInputs = sourceHints
    .filter((hint) => hint.sourceKind === executionDeclaration.kind)
    .map((hint) => ({
      relativePath: hint.sourcePath,
      statSignature: hint.statSignature,
      contentSha256: hint.contentSha256
    }));
  const inputs: DeclaredEntitySourceInput[] = previousInputs
    .filter((input) => !touchedSourcePaths.has(input.relativePath));
  for (const sourcePath of touchedSourcePaths) {
    const current = readExecutionSourceInput(authoredRoot, sourcePath);
    if (current) inputs.push(current);
  }
  inputs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    inputs,
    hash: stablePayloadHash({
      schema: "declared-entity-source/v1",
      kind: executionDeclaration.kind,
      inputs: inputs.map(({ relativePath, contentSha256 }) => ({ relativePath, contentSha256 }))
    }),
    stats: {
      directoriesVisited: 0,
      entriesVisited: touchedSourcePaths.size,
      filesMatched: inputs.length,
      cacheHit: true
    }
  };
}

function readExecutionSourceInput(
  authoredRoot: string,
  sourcePath: string
): DeclaredEntitySourceInput | undefined {
  const documentPath = path.join(authoredRoot, sourcePath);
  if (localProjectionSourceFileSystem.statSignature(documentPath) === null) return undefined;
  const source = localProjectionSourceFileSystem.readStableText(documentPath);
  return {
    relativePath: sourcePath,
    body: source.body,
    statSignature: source.signature,
    contentSha256: sha256Text(source.body)
  };
}

function relativeExecutionSourcePath(authoredRoot: string, inputPath: string): string | undefined {
  const relative = path.relative(authoredRoot, canonicalProjectionSourcePath(inputPath));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  const sourcePath = relative.split(path.sep).join("/");
  return /^tasks\/[^/]+\/executions\/[^/]+\.md$/u.test(sourcePath) ? sourcePath : undefined;
}

function canonicalProjectionSourcePath(inputPath: string): string {
  let current = path.resolve(inputPath);
  const suffix: string[] = [];
  while (true) {
    try {
      return path.join(localProjectionSourceFileSystem.realpath(current), ...suffix.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(inputPath);
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

function executionEvidenceSourceHash(
  taskTitles: ReadonlyArray<ExecutionEvidenceTaskTitleRow>,
  executionSourceHash: string
): string {
  return stablePayloadHash({
    schema: "execution-evidence-source/v1",
    taskTitles,
    executionSourceHash
  });
}

function readExecutionEvidenceTaskTitles(rootInput: HarnessLayoutInput): ReadonlyArray<ExecutionEvidenceTaskTitleRow> {
  const tasksRoot = resolveHarnessLayout(rootInput).tasksRoot;
  if (localProjectionSourceFileSystem.statSignature(tasksRoot) === null) return [];
  const directory = localProjectionSourceFileSystem.readStableDirents(tasksRoot);
  const rows: ExecutionEvidenceTaskTitleRow[] = [];
  const signatures = new Map<string, string>();
  for (const entry of directory.entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(tasksRoot, entry.name, "INDEX.md");
    if (localProjectionSourceFileSystem.statSignature(indexPath) === null) continue;
    const source = localProjectionSourceFileSystem.readStableText(indexPath);
    signatures.set(indexPath, source.signature);
    const frontmatter = readFrontmatter(source.body);
    if (!frontmatter) continue;
    const taskId = readScalar(frontmatter, "task_id") || entry.name;
    rows.push({
      taskId,
      title: readScalar(frontmatter, "title") || taskId
    });
  }
  if (localProjectionSourceFileSystem.statSignature(tasksRoot) !== directory.signature) {
    throw new Error("execution evidence task-title directory changed while reading");
  }
  for (const [indexPath, signature] of signatures) {
    if (localProjectionSourceFileSystem.statSignature(indexPath) !== signature) {
      throw new Error(`execution evidence task title changed while reading: ${indexPath}`);
    }
  }
  return rows.sort((left, right) => left.taskId.localeCompare(right.taskId));
}
