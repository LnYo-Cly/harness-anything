import type { DecisionPackage } from "../schemas/decision-package.ts";
import { sha256Text, stableStringify } from "./stable-hash.ts";

export const decisionContentCanonicalization = "decision-content/v1" as const;

export type DecisionContentDigestSource = Pick<
  DecisionPackage,
  "question" | "applies_to" | "chosen" | "rejected" | "claims" | "decisionClass"
>;

export function canonicalizeDecisionContent(decision: DecisionContentDigestSource): string {
  return stableStringify({
    schema: decisionContentCanonicalization,
    question: decision.question,
    ...(decision.decisionClass ? { decisionClass: decision.decisionClass } : {}),
    applies_to: decision.applies_to,
    chosen: decision.chosen,
    rejected: decision.rejected,
    claims: decision.claims
  });
}

export function computeDecisionContentDigest(decision: DecisionContentDigestSource): `sha256:${string}` {
  return `sha256:${sha256Text(canonicalizeDecisionContent(decision))}`;
}
