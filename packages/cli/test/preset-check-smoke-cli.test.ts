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
      capture: { type: "script", command: "scripts/capture.mjs", writes: ["{{outputRoot}}/**"] },
      "scaffold-plan": { type: "script", command: "scripts/scaffold-plan.mjs", writes: ["{{outputRoot}}/**"] },
      check: { type: "script", command: "scripts/check.mjs", writes: ["{{outputRoot}}/**"] }
    });
    write(rootDir, ".harness/presets/usage-acceptance/scripts/capture.mjs", "console.log('capture');\n");
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
