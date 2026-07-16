// harness-test-tier: fast
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateRegistry } from "./main-watch.mjs";

test("the flake registry has the v1 schema and every entry anchors a repair task", () => {
  const registry = JSON.parse(readFileSync(new URL("./flake-registry.json", import.meta.url), "utf8"));

  assert.doesNotThrow(() => validateRegistry(registry));
  assert.deepEqual(registry.entries[0], {
    testName: "daemon start service status and stop expose productized status contract",
    file: "packages/cli/test/daemon-thin-client-cli.test.ts",
    anchoredTask: "task_01KXNQABV1XSQHPXVQQCQNGWVA",
    firstSeen: "2026-07-16",
    notes: "Known daemon lifecycle timing flake; observed failing main five times, including runs 29512159972 and 29513133791 on Node 24 and 26."
  });
});

test("registry validation rejects an entry without an anchored repair task", () => {
  assert.throws(() => validateRegistry({
    schema: "harness-anything/flake-registry/v1",
    entries: [{
      testName: "known failure",
      file: "tools/example.test.mjs",
      anchoredTask: "",
      firstSeen: "2026-07-17",
      notes: "fixture"
    }]
  }), /requires non-empty anchoredTask/u);
});
