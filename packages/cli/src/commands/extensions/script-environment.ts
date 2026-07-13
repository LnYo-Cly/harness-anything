import path from "node:path";
import { fileURLToPath } from "node:url";
import { lstatSync } from "node:fs";
import { permissionPathsForScope, scopePathContainsSymlink } from "./script-scope.ts";

interface PresetEntrypointProvenance {
  readonly layer: "project" | "user" | "builtin";
  readonly presetId: string;
  readonly entrypointName: string;
  readonly command: string;
  readonly sourcePath: string;
}

export interface ScriptEnvironmentCapabilities {
  readonly githubIssueRepairToken?: true;
}

export function scriptChildEnvironment(
  declared: Readonly<Record<string, string | undefined>>,
  capabilities: ScriptEnvironmentCapabilities = {},
  hostEnvironment: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries({
      ...declared,
      ...(capabilities.githubIssueRepairToken === true ? {
        GITHUB_TOKEN: hostEnvironment.GITHUB_TOKEN,
        GH_TOKEN: hostEnvironment.GH_TOKEN
      } : {})
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function trustedPresetEnvironmentCapabilities(input: PresetEntrypointProvenance): ScriptEnvironmentCapabilities {
  return isTrustedBundledGitHubIssueRepairEntrypoint(input)
    ? { githubIssueRepairToken: true }
    : {};
}

export function trustedPresetMayIngestFailedDiagnostics(input: PresetEntrypointProvenance): boolean {
  return isTrustedBundledGitHubIssueRepairEntrypoint(input);
}

export function trustedPresetPackageReadPermissions(input: PresetEntrypointProvenance): ReadonlyArray<string> {
  if (!isTrustedBundledCreateMilestoneRenderer(input)) return [];
  const softwareCodingRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets/software-coding");
  const templatePath = path.join(softwareCodingRoot, "templates/dossier.editorial.shell/zh-CN.md");
  try {
    if (!lstatSync(templatePath).isFile() || scopePathContainsSymlink(templatePath, softwareCodingRoot)) return [];
  } catch {
    return [];
  }
  return permissionPathsForScope(templatePath, false);
}

function isTrustedBundledGitHubIssueRepairEntrypoint(input: PresetEntrypointProvenance): boolean {
  const bundledSourcePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "assets/software-coding/presets/github-issue-repair/preset.json"
  );
  return input.layer === "builtin" &&
    input.presetId === "github-issue-repair" &&
    input.entrypointName === "plan" &&
    input.command === "scripts/preset-action.mjs" &&
    path.resolve(input.sourcePath) === path.resolve(bundledSourcePath);
}

function isTrustedBundledCreateMilestoneRenderer(input: PresetEntrypointProvenance): boolean {
  const bundledSourcePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "assets/software-coding/presets/create-milestone/preset.json"
  );
  return input.layer === "builtin" &&
    input.presetId === "create-milestone" &&
    ["scaffold", "render-html"].includes(input.entrypointName) &&
    input.command === "scripts/preset-action.mjs" &&
    path.resolve(input.sourcePath) === path.resolve(bundledSourcePath);
}
