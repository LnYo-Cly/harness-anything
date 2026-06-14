import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const cliEntry = path.resolve("packages/cli/src/index.ts");

test("CLI process preset script entrypoint requires authorization and writes evidence", () => {
  withTempRoot((rootDir) => {
    const inspected = runJson(rootDir, ["preset", "inspect", "publish-standard"]);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.preset.kind, "process-action");
    assert.match(inspected.preset.title, /Capability Smoke/u);
    assert.deepEqual(inspected.preset.entrypoints, ["plan", "scaffold"]);

    const unauthorized = runJson(rootDir, ["preset", "action", "publish-standard", "scaffold", "--task", "task-1"], false);
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.error.code, "preset_script_authorization_required");
    assert.equal(unauthorized.report.scriptAuthorized, false);
    assert.equal(unauthorized.evidenceBundle.startsWith(".harness/evidence/presets/publish-standard/"), true);
    assert.equal(existsSync(path.join(rootDir, unauthorized.evidenceBundle, "evidence.json")), true);
    assert.equal(existsSync(path.join(rootDir, "harness/planning/tasks/task-1/artifacts/evidence.json")), false);

    const result = runJson(rootDir, ["preset", "action", "publish-standard", "scaffold", "--task", "task-1", "--allow-scripts"]);

    assert.equal(result.ok, true);
    assert.equal(result.command, "preset-action");
    assert.equal(result.report.scriptAuthorized, true);
    assert.equal(result.generated.some((filePath: string) => filePath.endsWith("references/publish-standard.md")), true);
    assert.equal(result.generated.some((filePath: string) => filePath.endsWith("artifacts/evidence.json")), true);
    assert.equal(result.generated.every((filePath: string) => filePath.startsWith("harness/planning/tasks/task-1/")), true);
    assert.equal(result.evidenceBundle.startsWith(".harness/evidence/presets/publish-standard/"), true);
    assert.equal(existsSync(path.join(rootDir, result.evidenceBundle, "context.json")), true);
    assert.equal(existsSync(path.join(rootDir, result.evidenceBundle, "stdout.txt")), true);
    assert.equal(existsSync(path.join(rootDir, result.evidenceBundle, "stderr.txt")), true);
    const scriptEvidence = JSON.parse(readFileSync(path.join(rootDir, "harness/planning/tasks/task-1/artifacts/evidence.json"), "utf8"));
    assert.equal(scriptEvidence.mode, "capability-smoke");
  });
});

test("CLI process preset script entrypoint rejects undeclared output write scope", () => {
  withTempRoot((rootDir) => {
    writeFile(rootDir, ".harness/presets/bad-script/preset.json", JSON.stringify({
      schema: "preset-manifest/v2",
      id: "bad-script",
      title: "Bad Script",
      vertical: "software/coding",
      version: "1.0.0",
      kind: "process-action",
      kernelVersionRange: { min: "1.0.0", maxExclusive: "2.0.0" },
      capabilityImports: [],
      entrypoints: {
        scaffold: { type: "script", command: "scripts/preset-action.mjs", writes: ["{{paths.generatedRoot}}/**"] }
      },
      profiles: [{
        id: "baseline",
        title: "Baseline",
        checkerProfile: "standard",
        templateSelections: []
      }],
      defaultProfile: "baseline"
    }, null, 2));
    writeFile(rootDir, ".harness/presets/bad-script/scripts/preset-action.mjs", [
      "#!/usr/bin/env node",
      "console.log('should not execute');",
      ""
    ].join("\n"));

    const result = runJson(rootDir, ["preset", "action", "bad-script", "scaffold", "--task", "task-1", "--allow-scripts"], false);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "preset_write_scope_invalid");
    assert.equal(existsSync(path.join(rootDir, ".harness/generated/preset-scripts/bad-script")), false);
  });
});

test("CLI process preset script entrypoint blocks out-of-scope filesystem writes", () => {
  withTempRoot((rootDir) => {
    writeFile(rootDir, ".harness/presets/escape-script/preset.json", JSON.stringify({
      schema: "preset-manifest/v2",
      id: "escape-script",
      title: "Escape Script",
      vertical: "software/coding",
      version: "1.0.0",
      kind: "process-action",
      kernelVersionRange: { min: "1.0.0", maxExclusive: "2.0.0" },
      capabilityImports: [],
      entrypoints: {
        scaffold: { type: "script", command: "scripts/preset-action.mjs", writes: ["{{outputRoot}}/**"] }
      },
      profiles: [{
        id: "baseline",
        title: "Baseline",
        checkerProfile: "standard",
        templateSelections: []
      }],
      defaultProfile: "baseline"
    }, null, 2));
    writeFile(rootDir, ".harness/presets/escape-script/scripts/preset-action.mjs", [
      "#!/usr/bin/env node",
      "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "const context = JSON.parse(readFileSync(process.env.HARNESS_PRESET_CONTEXT, 'utf8'));",
      "mkdirSync(path.join(context.outputRoot, 'artifacts'), { recursive: true });",
      "writeFileSync(path.join(context.outputRoot, 'artifacts/evidence.json'), '{}', 'utf8');",
      "writeFileSync(path.join(context.paths.rootDir, 'escaped.txt'), 'bad', 'utf8');",
      ""
    ].join("\n"));

    const result = runJson(rootDir, ["preset", "action", "escape-script", "scaffold", "--task", "task-1", "--allow-scripts"], false);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "preset_write_scope_violation");
    assert.equal(existsSync(path.join(rootDir, "escaped.txt")), false);
  });
});

function runJson(rootDir: string, args: ReadonlyArray<string>, expectSuccess = true): Record<string, any> {
  try {
    const output = execFileSync(process.execPath, [cliEntry, "--root", rootDir, "--json", ...args], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(output) as Record<string, any>;
    if (expectSuccess) assert.equal(parsed.ok, true, output);
    return parsed;
  } catch (error) {
    if (expectSuccess) throw error;
    const failure = error as { readonly stdout?: string };
    return JSON.parse(failure.stdout ?? "{}") as Record<string, any>;
  }
}

function withTempRoot<T>(fn: (rootDir: string) => T): T {
  const rootDir = mkdtempSync(path.join(tmpdir(), "harness-preset-script-"));
  try {
    return fn(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function writeFile(rootDir: string, relativePath: string, body: string): void {
  const target = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
}
