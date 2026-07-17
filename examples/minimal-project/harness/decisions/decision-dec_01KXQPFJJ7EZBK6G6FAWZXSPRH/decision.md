---
schema: decision-package/v1
decision_id: dec_01KXQPFJJ7EZBK6G6FAWZXSPRH
_coordinatorWatermark: 1784280503704-8fa08c56-bc128cd7b09f74ec
title: "Make express checkout the default"
state: proposed
riskTier: medium
urgency: high
vertical: "software/coding"
preset: "architecture-decision"
applies_to:
  modules: []
  productLines: []
proposedAt: "2026-07-17T09:28:20.807Z"
provenance:
  - { runtime: "codex", sessionId: "demo-aurora-commerce", boundAt: "2026-07-17T09:28:20.807Z" }
question: "Which checkout path should Aurora present to returning customers?"
chosen:
  - { id: "CH1", text: "Lead with a one-click express checkout backed by passkeys" }
rejected:
  - { id: "RJ1", text: "Keep the multi-step checkout as the default", why_not: "It repeats address and payment confirmation, the largest observed source of mobile abandonment." }
claims:
  - { id: "C1", text: "Returning customers can complete checkout securely in under 30 seconds." }
relations:
  - { relation_id: "rel_b8c613f8690c079c", source: "decision/dec_01KXQPFJJ7EZBK6G6FAWZXSPRH/C1", target: "fact/task_01KXQPDM8866CM9HW1RMTT37N7/F-A11CE001", type: "evidenced-by", strength: "strong", direction: "directed", origin: "declared", rationale: "The funnel analysis identifies repeated confirmation as the primary conversion loss.", state: "active" }
  - { relation_id: "rel_a8fbcec56b9febda", source: "decision/dec_01KXQPFJJ7EZBK6G6FAWZXSPRH/C1", target: "fact/task_01KXQPDM8866CM9HW1RMTT37N7/F-A11CE002", type: "evidenced-by", strength: "strong", direction: "directed", origin: "declared", rationale: "The prototype shows passkeys materially reduce authentication time.", state: "active" }
  - { relation_id: "rel_3c20daf0b38c4786", source: "decision/dec_01KXQPFJJ7EZBK6G6FAWZXSPRH/CH1", target: "task/task_01KXQPDM8866CM9HW1RMTT37N7", type: "derives", strength: "strong", direction: "directed", origin: "declared", rationale: "The express-checkout choice directly creates the implementation work captured by this task.", state: "active" }
---

## Context

Returning customers already have trusted shipping and payment details, yet the current flow asks them to confirm the same information across three screens. Mobile completion dropped after the third confirmation was introduced.

## Trade-off

Express checkout removes repeated steps and uses passkeys for a fast, phishing-resistant confirmation. The existing multi-step flow remains available as a fallback for unsupported devices, changed orders, or user preference.

## Decision

Present express checkout first to eligible returning customers, keep the full checkout one tap away, and limit the initial rollout to 10% until conversion, fraud, accessibility, and support signals are healthy.
