// harness-test-tier: fast
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeDecisionContent,
  computeDecisionContentDigest
} from "../../src/integrity/decision-content-digest.ts";

const signedContent = {
  question: "Should content be pinned?",
  applies_to: {
    modules: ["kernel", "application"],
    productLines: ["decision-ledger"]
  },
  chosen: [{ id: "CH1", text: "Pin it.", load_bearing: true }],
  rejected: [{ id: "RJ1", text: "Trust history.", why_not: "History can move." }],
  claims: [{ id: "C1", text: "Pins preserve meaning." }]
};

test("decision content digest canonicalization is pinned by a golden vector", () => {
  assert.equal(
    canonicalizeDecisionContent(signedContent),
    "{\"applies_to\":{\"modules\":[\"kernel\",\"application\"],\"productLines\":[\"decision-ledger\"]},\"chosen\":[{\"id\":\"CH1\",\"load_bearing\":true,\"text\":\"Pin it.\"}],\"claims\":[{\"id\":\"C1\",\"text\":\"Pins preserve meaning.\"}],\"question\":\"Should content be pinned?\",\"rejected\":[{\"id\":\"RJ1\",\"text\":\"Trust history.\",\"why_not\":\"History can move.\"}],\"schema\":\"decision-content/v1\"}"
  );
  assert.equal(
    computeDecisionContentDigest(signedContent),
    "sha256:e216d18ccaa40138e579485bafaa107c8a3cc1a47b995b7c6bb8c9507ef5c4a2"
  );
});

test("decision content digest preserves array order while sorting object keys", () => {
  const reorderedObjectKeys = {
    claims: signedContent.claims,
    rejected: signedContent.rejected,
    chosen: signedContent.chosen,
    applies_to: {
      productLines: signedContent.applies_to.productLines,
      modules: signedContent.applies_to.modules
    },
    question: signedContent.question
  };
  const reversedChosen = { ...signedContent, chosen: [...signedContent.chosen].reverse() };

  assert.equal(computeDecisionContentDigest(reorderedObjectKeys), computeDecisionContentDigest(signedContent));
  assert.equal(computeDecisionContentDigest(reversedChosen), computeDecisionContentDigest(signedContent));

  const twoChosen = { ...signedContent, chosen: [...signedContent.chosen, { id: "CH2", text: "Second." }] };
  const reversedTwoChosen = { ...twoChosen, chosen: [...twoChosen.chosen].reverse() };
  assert.notEqual(computeDecisionContentDigest(reversedTwoChosen), computeDecisionContentDigest(twoChosen));
});
