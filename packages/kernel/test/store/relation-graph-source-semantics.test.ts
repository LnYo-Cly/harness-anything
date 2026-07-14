// harness-test-tier: integration
import assert from "node:assert/strict";
import test from "node:test";
import { relationGraphSourceSemanticHash } from "../../src/projection/relation-graph-source-semantics.ts";

test("relation source semantics ignore display titles but retain decision scope", () => {
  const decision = [
    "---",
    "schema: decision-package/v1",
    "decision_id: dec_SEMANTIC",
    "_coordinatorWatermark: wm-semantic",
    "title: Original title",
    "applies_to:",
    "  modules: [projection]",
    "  productLines: []",
    "claims:",
    "relations:",
    "---",
    ""
  ].join("\n");

  assert.equal(
    relationGraphSourceSemanticHash("decision.md", decision),
    relationGraphSourceSemanticHash("decision.md", decision.replace("title: Original title", "title: Updated title"))
  );
  assert.notEqual(
    relationGraphSourceSemanticHash("decision.md", decision),
    relationGraphSourceSemanticHash("decision.md", decision.replace("modules: [projection]", "modules: [runtime]"))
  );
});
