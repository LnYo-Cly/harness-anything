// harness-test-tier: integration
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runJson, withTempRoot } from "./helpers/preset-script-fixtures.ts";

test("preset inspect and check fail closed when a declared entrypoint script is missing", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "missing-entrypoint", {
      scaffold: {
        type: "script",
        command: "scripts/scaffold.mjs",
        writes: ["{{outputRoot}}/**"]
      }
    });

    for (const command of ["inspect", "check"] as const) {
      const result = runJson(rootDir, ["preset", command, "missing-entrypoint"], false);
      assert.equal(result.ok, false);
      assert.equal(result.preset.valid, false);
      assert.equal(result.preset.issueCount, 1);
      assert.equal(result.issues[0].entrypoint, "scaffold");
      assert.equal(result.issues[0].code, "preset_entrypoint_script_missing");
      assert.match(result.error.hint, /ha preset install <preset-folder> --project/u);
    }
  });
});

test("preset check runs the real scope resolver and rejects writes that miss outputRoot", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "wrong-output-scope", {
      check: {
        type: "script",
        command: "scripts/check.mjs",
        writes: ["{{paths.milestonesRoot}}/**"]
      }
    });
    write(rootDir, ".harness/presets/wrong-output-scope/scripts/check.mjs", "console.log('must not execute during smoke');\n");

    const result = runJson(rootDir, ["preset", "check", "wrong-output-scope"], false);

    assert.equal(result.ok, false);
    assert.equal(result.issues[0].entrypoint, "check");
    assert.equal(result.issues[0].code, "preset_entrypoint_smoke_failed");
    assert.match(result.issues[0].message, /write scope covering its outputRoot/u);
  });
});

test("preset check rejects a present script that cannot be parsed by the runtime", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "syntax-error", {
      check: {
        type: "script",
        command: "scripts/check.mjs",
        writes: ["{{outputRoot}}/**"]
      }
    });
    write(rootDir, ".harness/presets/syntax-error/scripts/check.mjs", "const broken = ;\n");

    const result = runJson(rootDir, ["preset", "check", "syntax-error"], false);

    assert.equal(result.ok, false);
    assert.equal(result.issues[0].entrypoint, "check");
    assert.match(result.issues[0].message, /not executable JavaScript/u);
  });
});

test("preset check rejects an entrypoint name absent from the parser capability registry", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "unreachable", {
      capture: {
        type: "script",
        command: "scripts/capture.mjs",
        writes: ["{{outputRoot}}/**"]
      }
    });
    write(rootDir, ".harness/presets/unreachable/scripts/capture.mjs", "console.log('never reached');\n");

    const result = runJson(rootDir, ["preset", "check", "unreachable"], false);

    assert.equal(result.issues[0].code, "preset_entrypoint_runtime_unregistered");
    assert.equal(result.issues[0].entrypoint, "capture");
    assert.match(result.issues[0].message, /capability registry does not expose/u);
    assert.equal(result.issues[0].nextCommand, "ha preset run --help");
  });
});

test("preset check executes the script and rejects script-result ok false", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "failed-result", {
      check: {
        type: "script",
        command: "scripts/check.mjs",
        writes: ["{{outputRoot}}/**"]
      }
    });
    write(rootDir, ".harness/presets/failed-result/scripts/check.mjs", [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(process.env.HARNESS_SCRIPT_RESULT, JSON.stringify({ schema: 'script-result/v1', ok: false, report: { reason: 'positive-control' }, produced: [] }));",
      ""
    ].join("\n"));

    const result = runJson(rootDir, ["preset", "check", "failed-result"], false);

    assert.equal(result.issues[0].code, "preset_entrypoint_smoke_failed");
    assert.equal(result.issues[0].entrypoint, "check");
    assert.match(result.issues[0].message, /script-result ok:false/u);
    assert.equal(result.issues[0].nextCommand, "ha preset check failed-result --json");

    const list = runJson(rootDir, ["preset", "list"]);
    assert.equal(list.presets.find((preset: Record<string, unknown>) => preset.id === "failed-result").valid, false);
    assert.equal(list.issues.some((issue: Record<string, unknown>) => issue.entrypoint === "check"), true);
  });
});

test("preset audit reports a script ingest rejection instead of aborting the scan", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "unmanaged-output", {
      scaffold: {
        type: "script",
        command: "scripts/scaffold.mjs",
        writes: ["{{outputRoot}}/**"]
      }
    });
    write(rootDir, ".harness/presets/unmanaged-output/scripts/scaffold.mjs", [
      "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "const context = JSON.parse(readFileSync(process.env.HARNESS_PRESET_CONTEXT, 'utf8'));",
      "mkdirSync(context.outputRoot, { recursive: true });",
      "writeFileSync(path.join(context.outputRoot, 'undeclared.md'), '# not ingestible\\n');",
      ""
    ].join("\n"));

    const result = runJson(rootDir, ["preset", "audit"], false);

    assert.equal(result.error.code, "preset_manifest_invalid");
    assert.equal(result.presets.find((preset: Record<string, unknown>) => preset.id === "unmanaged-output").valid, false);
    const issue = result.issues.find((candidate: Record<string, unknown>) =>
      candidate.entrypoint === "scaffold" && typeof candidate.message === "string" && candidate.message.includes("SEMANTIC_DIFF_REQUIRED"));
    assert.ok(issue);
    assert.match(issue.message, /SEMANTIC_DIFF_REQUIRED/u);
  });
});

test("usage-acceptance regression fixture reports each broken entrypoint and turns valid only after all three are repaired", () => {
  withTempRoot((rootDir) => {
    writePreset(rootDir, "usage-acceptance", {
      capture: { type: "script", command: "scripts/capture.mjs", writes: ["{{outputRoot}}/**"] },
      "scaffold-plan": { type: "script", command: "scripts/scaffold-plan.mjs", writes: ["{{outputRoot}}/**"] },
      check: { type: "script", command: "scripts/check.mjs", writes: ["{{paths.milestonesRoot}}/**"] }
    });
    write(rootDir, ".harness/presets/usage-acceptance/scripts/check.mjs", "console.log('check');\n");

    const broken = runJson(rootDir, ["preset", "check", "usage-acceptance"], false);
    assert.equal(broken.preset.valid, false);
    assert.deepEqual(broken.issues.map((issue: Record<string, unknown>) => issue.entrypoint), [
      "capture",
      "scaffold-plan",
      "check"
    ]);

    writePreset(rootDir, "usage-acceptance", {
      plan: { type: "script", command: "scripts/scaffold-plan.mjs", writes: ["{{outputRoot}}/**"] },
      scaffold: { type: "script", command: "scripts/capture.mjs", writes: ["{{outputRoot}}/**"] },
      check: { type: "script", command: "scripts/check.mjs", writes: ["{{outputRoot}}/**"] }
    });
    write(rootDir, ".harness/presets/usage-acceptance/scripts/capture.mjs", "console.log('scaffold');\n");
    write(rootDir, ".harness/presets/usage-acceptance/scripts/scaffold-plan.mjs", "console.log('scaffold-plan');\n");

    const repaired = runJson(rootDir, ["preset", "check", "usage-acceptance"]);
    assert.equal(repaired.preset.valid, true);
    assert.equal(repaired.preset.issueCount, 0);
  });
});

function writePreset(rootDir: string, id: string, entrypoints: Record<string, unknown>): void {
  write(rootDir, `.harness/presets/${id}/preset.json`, JSON.stringify({
    schema: "preset-manifest/v2",
    id,
    title: id,
    vertical: "software/coding",
    version: "1.0.0",
    kind: "process-action",
    kernelVersionRange: { min: "1.0.0", maxExclusive: "2.0.0" },
    capabilityImports: [],
    entrypoints,
    profiles: [{
      id: "baseline",
      title: "Baseline",
      checkerProfile: "standard",
      completionGates: [],
      templateSelections: []
    }],
    defaultProfile: "baseline"
  }, null, 2));
}

function write(rootDir: string, relativePath: string, body: string): void {
  const target = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
}
