// harness-test-tier: fast
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupRetiredAttributionFields,
  countContentPinArbitersInDocument,
  hasRetiredAttributionFields
} from "../../src/domain/retired-attribution-field-cleanup.ts";

test("task cleanup deletes only the top-level createdBy block and preserves authored body bytes", () => {
  const before = [
    "---",
    "schema: task-package/v2",
    "task_id: task_TEST",
    "title: Historical task",
    "createdBy:",
    "  name: ZeyuLi",
    "  email: historical@example.test",
    "---",
    "",
    "# Historical task",
    "",
    "## Lifecycle Note",
    "",
    "createdBy: this body text is not frontmatter",
    ""
  ].join("\n");

  const result = cleanupRetiredAttributionFields(before, "task-index");

  assert.deepEqual(result.removedKeys, ["createdBy"]);
  assert.equal(result.authoredBodyAfter, result.authoredBodyBefore);
  assert.match(result.body, /## Lifecycle Note/u);
  assert.match(result.body, /createdBy: this body text is not frontmatter/u);
  assert.equal(hasRetiredAttributionFields(result.body, "task-index"), false);
  assert.equal(result.removedByteCount, Buffer.byteLength("createdBy:\n  name: ZeyuLi\n  email: historical@example.test\n"));
});

test("decision cleanup preserves CRLF, contentPins[].arbiter, and body bytes", () => {
  const before = [
    "---",
    "schema: decision-package/v1",
    "decision_id: dec_TEST",
    "proposedBy: { kind: \"agent\", id: \"legacy\" }",
    "arbiter: { kind: \"human\", id: \"zeyu\" }",
    "contentPins:",
    "  - { action: \"accept\", arbiter: { kind: \"human\", id: \"zeyu\" }, digest: \"sha256:test\" }",
    "---",
    "",
    "# Decision",
    "",
    "Body keeps proposedBy: and arbiter: as prose.",
    ""
  ].join("\r\n");

  const result = cleanupRetiredAttributionFields(before, "decision");

  assert.deepEqual(result.removedKeys, ["proposedBy", "arbiter"]);
  assert.equal(result.authoredBodyAfter, result.authoredBodyBefore);
  assert.equal(result.contentPinArbitersBefore, 1);
  assert.equal(result.contentPinArbitersAfter, 1);
  assert.equal(countContentPinArbitersInDocument(result.body), 1);
  assert.match(result.body, /^  - .*arbiter:/mu);
  assert.doesNotMatch(result.body, /(?<!^)\n(?:proposedBy|arbiter):/u);
  assert.equal(result.body.includes("\n") && !result.body.includes("\r\n"), false);
});

test("cleanup rejects partial, duplicate, or nested-only retired fields", () => {
  const partialDecision = "---\ndecision_id: dec_TEST\nproposedBy: legacy\n---\n\n# Body\n";
  assert.throws(() => cleanupRetiredAttributionFields(partialDecision, "decision"), /exactly one top-level arbiter/u);

  const duplicateTask = "---\ntask_id: task_TEST\ncreatedBy: one\ncreatedBy: two\n---\n";
  assert.throws(() => cleanupRetiredAttributionFields(duplicateTask, "task-index"), /found 2/u);

  const nestedOnly = "---\ntask_id: task_TEST\nmetadata:\n  createdBy: nested\n---\n";
  assert.equal(hasRetiredAttributionFields(nestedOnly, "task-index"), false);
  assert.throws(() => cleanupRetiredAttributionFields(nestedOnly, "task-index"), /found 0/u);
});
