import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { compileTaskContractSnapshot, parseTaskContractSnapshot } from "../../../../application/src/index.ts";
import {
  listTaskIndexPaths,
  readFrontmatter,
  readNestedScalar,
  readScalar,
  resolveHarnessLayout,
  type MaterializedTemplatePlan,
  type PresetManifest,
  type TemplateCatalog
} from "../../../../kernel/src/index.ts";
import type { CliResult } from "../../cli/types.ts";
import type { CommandRunner } from "../../cli/runner-registry.ts";
import { bundledTemplateCatalog } from "../extensions/bundled.ts";
import { isInvalidPreset, materializePresetTaskDocuments, resolvePresetEntry } from "../extensions/state.ts";
import { renderTemplateBody } from "../preset-task.ts";
import { readProjectHarnessSettings } from "../settings.ts";
import { createAuthoredTaskCreationResolver, createHistoricalTaskContractResolver, type AuthoredTaskCreationEvidence } from "./task-contract-history.ts";

type TaskContractMigrateAction = Extract<Parameters<CommandRunner>[1]["action"], { readonly kind: "task-contract-migrate" }>;

interface MigrationEntry {
  readonly taskId: string;
  readonly status: "planned" | "current" | "manual" | "applied";
  readonly reason?: string;
  readonly path?: string;
  readonly preset?: string;
  readonly provenance?: "exact-current-scaffold" | "source-git-history";
  readonly sourceCommit?: string;
  readonly authoredCommit?: string;
}

interface PlannedSnapshot {
  readonly taskId: string;
  readonly body: string;
  readonly path: string;
}

interface SelectedContract {
  readonly preset: PresetManifest;
  readonly profileId: string;
  readonly catalog: TemplateCatalog;
  readonly documents: ReadonlyArray<MaterializedTemplatePlan>;
  readonly provenance: "exact-current-scaffold" | "source-git-history";
  readonly sourceCommit?: string;
  readonly authoredCommit?: string;
}

export const runTaskContractMigration: CommandRunner = (context, command) => Effect.gen(function* () {
  const action = command.action as TaskContractMigrateAction;
  const settingsResult = readProjectHarnessSettings(context.layoutInput, action.kind);
  if (!settingsResult.ok) return settingsResult.result;
  const locale = settingsResult.settings.locale ?? "zh-CN";
  const layout = resolveHarnessLayout(context.layoutInput);
  const rootDir = layout.rootDir;
  const resolveHistoricalTaskContract = createHistoricalTaskContractResolver(rootDir);
  const resolveAuthoredTaskCreation = createAuthoredTaskCreationResolver(layout.authoredRoot, layout.tasksRoot);
  const capturedAt = new Date().toISOString();
  const entries: MigrationEntry[] = [];
  const planned: PlannedSnapshot[] = [];
  const indexPaths = listTaskIndexPaths(context.layoutInput)
    .filter((indexPath) => !action.taskId || readMigrationTaskId(indexPath) === action.taskId);

  if (action.taskId && indexPaths.length === 0) {
    entries.push({ taskId: action.taskId, status: "manual", reason: "task_not_found" });
  }

  for (const indexPath of indexPaths) {
    const indexBody = readFileSync(indexPath, "utf8");
    const frontmatter = readFrontmatter(indexBody);
    const taskId = frontmatter ? readScalar(frontmatter, "task_id") : readMigrationTaskId(indexPath);
    if (!frontmatter || !taskId) {
      entries.push({ taskId: taskId || path.basename(path.dirname(indexPath)), status: "manual", reason: "task_frontmatter_missing" });
      continue;
    }
    const contractPath = path.join(path.dirname(indexPath), "task-contract.json");
    const relativeContractPath = path.relative(rootDir, contractPath).split(path.sep).join("/");
    const vertical = readScalar(frontmatter, "vertical");
    const presetId = readScalar(frontmatter, "preset");
    const profileId = readScalar(frontmatter, "profile") || undefined;
    const title = readScalar(frontmatter, "title");
    if (existsSync(contractPath)) {
      try {
        const snapshot = parseTaskContractSnapshot(readFileSync(contractPath, "utf8"));
        if (snapshot.vertical !== vertical || snapshot.preset.id !== presetId || (profileId && snapshot.profile.id !== profileId)) {
          entries.push({ taskId, status: "manual", reason: "existing_snapshot_metadata_mismatch", path: relativeContractPath, ...(presetId ? { preset: presetId } : {}) });
          continue;
        }
        entries.push({ taskId, status: "current", path: relativeContractPath, ...(presetId ? { preset: presetId } : {}) });
      } catch (error) {
        entries.push({ taskId, status: "manual", reason: `invalid_existing_snapshot:${error instanceof Error ? error.message : String(error)}`, path: relativeContractPath, ...(presetId ? { preset: presetId } : {}) });
      }
      continue;
    }

    if (!vertical || !presetId || vertical === "default" || presetId === "default") {
      entries.push({ taskId, status: "manual", reason: "contract_metadata_incomplete", ...(presetId ? { preset: presetId } : {}) });
      continue;
    }
    const preset = resolvePresetEntry(context.layoutInput, presetId, vertical);
    if (!preset) {
      entries.push({ taskId, status: "manual", reason: `preset_not_found:${presetId}`, preset: presetId });
      continue;
    }
    if (isInvalidPreset(preset)) {
      entries.push({ taskId, status: "manual", reason: `preset_invalid:${presetId}`, preset: presetId });
      continue;
    }
    const catalog = bundledTemplateCatalog(vertical);
    const materialized = materializePresetTaskDocuments(preset.manifest, { profileId, locale });
    let selected: SelectedContract | undefined = catalog && materialized.ok && materialized.profile && title && isExactScaffold(path.dirname(indexPath), title, materialized.documents)
      ? {
          preset: preset.manifest,
          profileId: materialized.profile.id,
          catalog,
          documents: materialized.documents,
          provenance: "exact-current-scaffold" as const,
          sourceCommit: undefined
        }
      : undefined;
    if (!selected && preset.layer === "builtin") {
      const bindingCreatedAt = readNestedScalar(frontmatter, "bindingCreatedAt");
      const historical = resolveHistoricalTaskContract({
        capturedAt: bindingCreatedAt,
        vertical,
        presetId,
        profileId,
        locale
      });
      const authoredEvidence = historical.ok
        ? resolveAuthoredTaskCreation(path.dirname(indexPath), historical.documents.map((document) => document.materializeAs))
        : undefined;
      if (historical.ok && title && isHistoricalScaffoldCompatible(path.dirname(indexPath), title, historical.documents, authoredEvidence)) {
        selected = {
          preset: historical.preset,
          profileId: historical.profile.id,
          catalog: historical.catalog,
          documents: historical.documents,
          provenance: "source-git-history",
          sourceCommit: historical.sourceCommit,
          ...(authoredEvidence ? { authoredCommit: authoredEvidence.sourceCommit } : {})
        };
      }
    }
    if (!selected) {
      entries.push({ taskId, status: "manual", reason: "contract_provenance_unverified", preset: presetId });
      continue;
    }
    try {
      const snapshot = compileTaskContractSnapshot({
        vertical,
        preset: selected.preset,
        profileId: selected.profileId,
        catalog: selected.catalog,
        documents: selected.documents,
        capturedAt,
        capturedBy: "legacy-migration"
      });
      planned.push({ taskId, body: `${JSON.stringify(snapshot, null, 2)}\n`, path: relativeContractPath });
      entries.push({
        taskId,
        status: "planned",
        path: relativeContractPath,
        preset: presetId,
        provenance: selected.provenance,
        ...(selected.sourceCommit ? { sourceCommit: selected.sourceCommit } : {}),
        ...(selected.authoredCommit ? { authoredCommit: selected.authoredCommit } : {})
      });
    } catch (error) {
      entries.push({ taskId, status: "manual", reason: `snapshot_compile_failed:${error instanceof Error ? error.message : String(error)}`, preset: presetId });
    }
  }

  if (action.mode === "apply") {
    for (const item of planned) {
      yield* context.engine.replaceTaskDocument({ taskId: item.taskId, path: "task-contract.json", body: item.body });
      const entry = entries.find((candidate) => candidate.taskId === item.taskId && candidate.status === "planned");
      if (entry) entries[entries.indexOf(entry)] = {
        taskId: item.taskId,
        status: "applied",
        path: item.path,
        ...(entry.preset ? { preset: entry.preset } : {}),
        ...(entry.provenance ? { provenance: entry.provenance } : {}),
        ...(entry.sourceCommit ? { sourceCommit: entry.sourceCommit } : {}),
        ...(entry.authoredCommit ? { authoredCommit: entry.authoredCommit } : {})
      };
    }
  }

  const counts = {
    examined: entries.length,
    planned: entries.filter((entry) => entry.status === "planned").length,
    applied: entries.filter((entry) => entry.status === "applied").length,
    current: entries.filter((entry) => entry.status === "current").length,
    manual: entries.filter((entry) => entry.status === "manual").length
  };
  return {
    ok: true,
    command: action.kind,
    report: {
      schema: "task-contract-migration-report/v1",
      mode: action.mode,
      counts,
      entries
    }
  } satisfies CliResult;
});

function readMigrationTaskId(indexPath: string): string {
  try {
    const frontmatter = readFrontmatter(readFileSync(indexPath, "utf8"));
    return frontmatter ? readScalar(frontmatter, "task_id") : "";
  } catch {
    return "";
  }
}

function isExactScaffold(
  taskDir: string,
  title: string,
  documents: ReadonlyArray<{ readonly materializeAs: string; readonly body: string }>
): boolean {
  return documents.every((document) => {
    const documentPath = path.join(taskDir, document.materializeAs);
    return existsSync(documentPath) && readFileSync(documentPath, "utf8") === renderTemplateBody(document.body, title);
  });
}

function isHistoricalScaffoldCompatible(
  taskDir: string,
  title: string,
  documents: ReadonlyArray<{
    readonly materializeAs: string;
    readonly body: string;
    readonly requiredAnchors: ReadonlyArray<string>;
  }>,
  authoredEvidence?: AuthoredTaskCreationEvidence
): boolean {
  let exactFingerprintCount = 0;
  for (const document of documents) {
    const documentPath = path.join(taskDir, document.materializeAs);
    if (!existsSync(documentPath)) return false;
    const actual = readFileSync(documentPath, "utf8");
    if (document.requiredAnchors.some((anchor) => !actual.includes(anchor))) return false;
    const evidenceBody = authoredEvidence?.documents.get(document.materializeAs) ?? actual;
    const evidenceTitle = authoredEvidence?.title ?? title;
    if (evidenceBody === renderTemplateBody(document.body, evidenceTitle)) exactFingerprintCount += 1;
  }
  return exactFingerprintCount > 0;
}
