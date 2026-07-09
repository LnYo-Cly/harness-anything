import assert from "node:assert/strict";
import test from "node:test";
import {
  checkMergifyQueueContexts,
  parseMergifyQueueCheckSuccessContexts
} from "./check-mergify-queue-contexts.mjs";

function manifestWithContexts(contexts) {
  return JSON.stringify({
    gates: [
      {
        id: "fixture",
        executionSurfaces: {
          branchProtection: {
            contexts
          }
        }
      }
    ]
  });
}

function mergifyWithQueueContexts(contextLines, extraPullRequestRuleConditions = []) {
  return [
    "queue_rules:",
    "  - name: default",
    "    merge_method: merge",
    "    queue_conditions:",
    "      - base = main",
    ...contextLines.map((context) => `      - check-success = ${context}`),
    "    merge_conditions: []",
    "",
    "pull_request_rules:",
    "  - name: merge via queue",
    "    conditions:",
    "      - base = main",
    ...extraPullRequestRuleConditions.map((condition) => `      - ${condition}`)
  ].join("\n");
}

test("mergify queue context check accepts matching context sets", () => {
  const result = checkMergifyQueueContexts({
    mergifyText: mergifyWithQueueContexts(["boundaries", "\"integration-shard (1)\""]),
    gateManifestText: manifestWithContexts(["boundaries", "integration-shard (1)"])
  });

  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("mergify queue context check rejects missing required contexts", () => {
  const result = checkMergifyQueueContexts({
    mergifyText: mergifyWithQueueContexts(["boundaries"]),
    gateManifestText: manifestWithContexts(["boundaries", "integration-shard (3)"])
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /integration-shard \(3\)/u);
});

test("mergify queue context check rejects extra queue contexts", () => {
  const result = checkMergifyQueueContexts({
    mergifyText: mergifyWithQueueContexts(["boundaries", "nonexistent-job"]),
    gateManifestText: manifestWithContexts(["boundaries"])
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /nonexistent-job/u);
});

test("mergify queue context check rejects dual empty context sets", () => {
  const result = checkMergifyQueueContexts({
    mergifyText: mergifyWithQueueContexts([]),
    gateManifestText: manifestWithContexts([])
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    "gate manifest declares no branch-protection contexts",
    ".mergify.yml queue_conditions declares no check-success contexts"
  ]);
});

test("mergify queue context parser unquotes quoted context names", () => {
  assert.deepEqual(parseMergifyQueueCheckSuccessContexts(mergifyWithQueueContexts([
    "\"integration-shard (1)\"",
    "'typecheck (24)'"
  ])), [
    "integration-shard (1)",
    "typecheck (24)"
  ]);
});

test("mergify queue context parser ignores pull request rule conditions", () => {
  assert.deepEqual(parseMergifyQueueCheckSuccessContexts(mergifyWithQueueContexts(
    ["boundaries"],
    ["check-success = nonexistent-job"]
  )), ["boundaries"]);
});
