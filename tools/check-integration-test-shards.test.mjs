import assert from "node:assert/strict";
import test from "node:test";
import { checkIntegrationTestShards } from "./check-integration-test-shards.mjs";
import { evaluateIntegrationShardResult } from "./check-integration-shard-result.mjs";

test("integration shard declaration is non-overlapping and complete", () => {
  const result = checkIntegrationTestShards();
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.fileCount, 78);
  assert.equal(result.summaries.length, 6);
  assert.ok(result.summaries.every((summary) => summary.files > 0));
});

test("integration shard aggregate fails closed for every non-success result", () => {
  assert.equal(evaluateIntegrationShardResult("success").ok, true);
  assert.equal(evaluateIntegrationShardResult("failure").ok, false);
  assert.equal(evaluateIntegrationShardResult("cancelled").ok, false);
  assert.equal(evaluateIntegrationShardResult("skipped").ok, false);
  assert.equal(evaluateIntegrationShardResult("unexpected").ok, false);
});
