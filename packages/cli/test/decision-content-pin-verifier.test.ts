// harness-test-tier: integration
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyDecisionContentPins } from "../src/commands/core/decision-content-pin-verifier.ts";
import { computeDecisionContentDigest, type DecisionPackage } from "../../kernel/src/index.ts";

test("decision content pin verifier treats a missing decisions ledger as empty", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-pin-verifier-empty-"));
  try {
    assert.deepEqual(verifyDecisionContentPins(rootDir), {
      schema: "decision-content-pin-verification-report/v1",
      checkedDecisionCount: 0,
      pinnedDecisionCount: 0,
      matchCount: 0,
      mismatchCount: 0,
      unpinnedDecisionCount: 0,
      warnings: []
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("decision content pin verifier leaves malformed document enforcement to the check profile", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-pin-verifier-malformed-"));
  try {
    const decisionRoot = path.join(rootDir, "harness/decisions/decision-dec_MALFORMED");
    mkdirSync(decisionRoot, { recursive: true });
    writeFileSync(path.join(decisionRoot, "decision.md"), "---\ndecision_id: dec_MALFORMED\n---\n", "utf8");

    const report = verifyDecisionContentPins(rootDir);

    assert.equal(report.checkedDecisionCount, 1);
    assert.equal(report.unpinnedDecisionCount, 1);
    assert.equal(report.mismatchCount, 0);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("decision content pin verifier reports the changed field and Git commit", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-pin-verifier-"));
  try {
    git(rootDir, "init", "-q");
    git(rootDir, "config", "user.name", "Verifier Test");
    git(rootDir, "config", "user.email", "verifier@example.com");
    const original = pinnedDecision();
    writeDecision(rootDir, original, "wm-accept");
    git(rootDir, "add", ".");
    git(rootDir, "commit", "-m", "decision(accept): dec_TEST");
    const initialReport = verifyDecisionContentPins(rootDir, { decisionIds: ["dec_TEST"] });
    assert.equal(initialReport.matchCount, 1);
    assert.equal(initialReport.mismatchCount, 0);

    const tampered = {
      ...original,
      chosen: [{ id: "CH1", text: "Tampered outside the decision write service." }]
    };
    writeDecision(rootDir, tampered, "wm-tamper");
    git(rootDir, "add", ".");
    git(rootDir, "commit", "-m", "tamper chosen directly");
    const tamperCommit = git(rootDir, "rev-parse", "HEAD").trim();

    const report = verifyDecisionContentPins(rootDir, { decisionIds: ["dec_TEST"] });

    assert.equal(report.pinnedDecisionCount, 1);
    assert.equal(report.mismatchCount, 1);
    assert.equal(report.warnings.length, 1);
    assert.deepEqual(report.warnings[0]?.changedFields, ["chosen"]);
    assert.deepEqual(report.warnings[0]?.gitChanges, [{
      commit: tamperCommit,
      subject: "tamper chosen directly",
      changedFields: ["chosen"]
    }]);
    assert.match(report.warnings[0]?.message ?? "", /chosen/u);
    assert.match(report.warnings[0]?.message ?? "", new RegExp(tamperCommit.slice(0, 12), "u"));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function pinnedDecision(): DecisionPackage {
  const unsigned = {
    schema: "decision-package/v1",
    decision_id: "dec_TEST",
    title: "Pinned decision",
    state: "active",
    riskTier: "high",
    urgency: "high",
    vertical: "software/coding",
    preset: "architecture-decision",
    applies_to: { modules: ["m3-triadic-kernel"], productLines: [] },
    proposedAt: "2026-07-14T00:00:00.000Z",
    decidedAt: "2026-07-14T00:01:00.000Z",
    provenance: [{ runtime: "codex", sessionId: "session-test", boundAt: "2026-07-14T00:00:00.000Z" }],
    question: "Should this content remain pinned?",
    chosen: [{ id: "CH1", text: "Keep the signed choice." }],
    rejected: [{ id: "RJ1", text: "Allow silent edits.", why_not: "Silent edits defeat tamper evidence." }],
    claims: [{ id: "C1", text: "A mismatch must be observable." }],
    relations: []
  } as const satisfies Omit<DecisionPackage, "contentPins">;
  return {
    ...unsigned,
    contentPins: [{
      action: "accept",
      state: "active",
      decidedAt: "2026-07-14T00:01:00.000Z",
      arbiter: { kind: "human", id: "person_zeyu" },
      canonicalization: "decision-content/v1",
      digest: computeDecisionContentDigest(unsigned)
    }]
  };
}

function writeDecision(rootDir: string, decision: DecisionPackage, watermark: string): void {
  const decisionRoot = path.join(rootDir, "harness/decisions/decision-dec_TEST");
  mkdirSync(decisionRoot, { recursive: true });
  const pin = decision.contentPins?.[0];
  assert.ok(pin);
  writeFileSync(path.join(decisionRoot, "decision.md"), [
    "---",
    "schema: decision-package/v1",
    "decision_id: dec_TEST",
    `_coordinatorWatermark: ${watermark}`,
    `title: ${JSON.stringify(decision.title)}`,
    "state: active",
    "riskTier: high",
    "urgency: high",
    `vertical: ${JSON.stringify(decision.vertical)}`,
    `preset: ${JSON.stringify(decision.preset)}`,
    "applies_to:",
    "  modules: [\"m3-triadic-kernel\"]",
    "  productLines: []",
    `proposedAt: ${JSON.stringify(decision.proposedAt)}`,
    `decidedAt: ${JSON.stringify(decision.decidedAt)}`,
    "contentPins:",
    `  - { action: "accept", state: "active", decidedAt: ${JSON.stringify(pin.decidedAt)}, arbiter: { kind: "human", id: "person_zeyu" }, canonicalization: "decision-content/v1", digest: ${JSON.stringify(pin.digest)} }`,
    "provenance:",
    "  - { runtime: \"codex\", sessionId: \"session-test\", boundAt: \"2026-07-14T00:00:00.000Z\" }",
    `question: ${JSON.stringify(decision.question)}`,
    "chosen:",
    `  - { id: "CH1", text: ${JSON.stringify(decision.chosen[0]?.text)} }`,
    "rejected:",
    "  - { id: \"RJ1\", text: \"Allow silent edits.\", why_not: \"Silent edits defeat tamper evidence.\" }",
    "claims:",
    "  - { id: \"C1\", text: \"A mismatch must be observable.\" }",
    "relations:",
    "---",
    "",
    "# Pinned decision",
    ""
  ].join("\n"), "utf8");
}

function git(rootDir: string, ...args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-C", rootDir, ...args], { encoding: "utf8" });
}
