import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { compileTaskContractSnapshot, parseTaskContractSnapshot } from "../../../../application/src/index.ts";
import { listTaskIndexPaths, readFrontmatter, readScalar, resolveHarnessLayout } from "../../../../kernel/src/index.ts";
import type { CliResult } from "../../cli/types.ts";
import type { CommandRunner } from "../../cli/runner-registry.ts";
import { bundledTemplateCatalog } from "../extensions/bundled.ts";
import { isInvalidPreset, materializePresetTaskDocuments, resolvePresetEntry } from "../extensions/state.ts";
import { readProjectHarnessSettings } from "../settings.ts";

type TaskContractMigrateAction = Extract<Parameters<CommandRunner>[1]["action"], { readonly kind: "task-contract-migrate" }>;

interface MigrationEntry {
  readonly taskId: string;
  readonly status: "planned" | "current" | "manual" | "applied";
  readonly reason?: string;
  readonly path?: string;
}

interface PlannedSnapshot {
  readonly taskId: string;
  readonly body: string;
  readonly path: string;
}

export const runTaskContractMigration: CommandRunner = (context, command) => Effect.gen(function* () {
  const action = command.action as TaskContractMigrateAction;
  const settingsResult = readProjectHarnessSettings(context.layoutInput, action.kind);
  if (!settingsResult.ok) return settingsResult.result;
  const locale = settingsResult.settings.locale ?? "zh-CN";
  const rootDir = resolveHarnessLayout(context.layoutInput).rootDir;
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
    if (existsSync(contractPath)) {
      try {
        const snapshot = parseTaskContractSnapshot(readFileSync(contractPath, "utf8"));
        if (snapshot.vertical !== vertical || snapshot.preset.id !== presetId || (profileId && snapshot.profile.id !== profileId)) {
          entries.push({ taskId, status: "manual", reason: "existing_snapshot_metadata_mismatch", path: relativeContractPath });
          continue;
        }
        entries.push({ taskId, status: "current", path: relativeContractPath });
      } catch (error) {
        entries.push({ taskId, status: "manual", reason: `invalid_existing_snapshot:${error instanceof Error ? error.message : String(error)}`, path: relativeContractPath });
      }
      continue;
    }

    if (!vertical || !presetId || vertical === "default" || presetId === "default") {
      entries.push({ taskId, status: "manual", reason: "contract_metadata_incomplete" });
      continue;
    }
    const catalog = bundledTemplateCatalog(vertical);
    if (!catalog) {
      entries.push({ taskId, status: "manual", reason: `template_catalog_unavailable:${vertical}` });
      continue;
    }
    const preset = resolvePresetEntry(context.layoutInput, presetId, vertical);
    if (!preset) {
      entries.push({ taskId, status: "manual", reason: `preset_not_found:${presetId}` });
      continue;
    }
    if (isInvalidPreset(preset)) {
      entries.push({ taskId, status: "manual", reason: `preset_invalid:${presetId}` });
      continue;
    }
    const materialized = materializePresetTaskDocuments(preset.manifest, { profileId, locale });
    if (!materialized.ok || !materialized.profile) {
      entries.push({ taskId, status: "manual", reason: `preset_profile_unresolvable:${profileId ?? preset.manifest.defaultProfile}` });
      continue;
    }
    try {
      const snapshot = compileTaskContractSnapshot({
        vertical,
        preset: preset.manifest,
        profileId: materialized.profile.id,
        catalog,
        documents: materialized.documents,
        capturedAt,
        capturedBy: "legacy-migration"
      });
      planned.push({ taskId, body: `${JSON.stringify(snapshot, null, 2)}\n`, path: relativeContractPath });
      entries.push({ taskId, status: "planned", path: relativeContractPath });
    } catch (error) {
      entries.push({ taskId, status: "manual", reason: `snapshot_compile_failed:${error instanceof Error ? error.message : String(error)}` });
    }
  }

  if (action.mode === "apply") {
    for (const item of planned) {
      yield* context.engine.replaceTaskDocument({ taskId: item.taskId, path: "task-contract.json", body: item.body });
      const entry = entries.find((candidate) => candidate.taskId === item.taskId && candidate.status === "planned");
      if (entry) entries[entries.indexOf(entry)] = { taskId: item.taskId, status: "applied", path: item.path };
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
