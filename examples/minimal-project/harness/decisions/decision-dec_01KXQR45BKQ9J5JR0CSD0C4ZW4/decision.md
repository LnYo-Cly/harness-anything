---
schema: decision-package/v1
decision_id: dec_01KXQR45BKQ9J5JR0CSD0C4ZW4
_coordinatorWatermark: 1784282224022-b9a2d7ed-45d721107945cbb1
title: "Prioritize native wallets on mobile"
state: proposed
riskTier: medium
urgency: high
vertical: "software/coding"
preset: "architecture-decision"
applies_to:
  modules: []
  productLines: []
proposedAt: "2026-07-17T09:57:03.987Z"
provenance:
  - { runtime: "codex", sessionId: "demo-aurora-commerce", boundAt: "2026-07-17T09:57:03.987Z" }
question: "Which fast payment path should Aurora ship first for mobile customers?"
chosen:
  - { id: "CH1", text: "Prioritize Apple Pay and Google Pay" }
rejected:
  - { id: "RJ1", text: "Build a custom saved-card quick-pay flow first", why_not: "A custom flow duplicates secure wallet capabilities and requires more payment-data handling." }
claims:
  - { id: "C1", text: "Native wallets materially reduce mobile payment completion time." }
relations:
  - { relation_id: "rel_3669f7306186ea03", source: "decision/dec_01KXQR45BKQ9J5JR0CSD0C4ZW4/C1", target: "fact/task_01KXQQ4CMEYZRMW9N2Y7GAYQKY/F-A11CE003", type: "evidenced-by", strength: "strong", direction: "directed", origin: "declared", rationale: "The prototype measures faster completion with native wallets.", state: "active" }
  - { relation_id: "rel_f851bd1a9ad6c140", source: "decision/dec_01KXQR45BKQ9J5JR0CSD0C4ZW4/CH1", target: "task/task_01KXQQ4CMEYZRMW9N2Y7GAYQKY", type: "derives", strength: "strong", direction: "directed", origin: "declared", rationale: "The wallet choice directly creates the mobile wallet delivery task.", state: "active" }
---

## Context

Mobile customers lose time entering card and billing details on small screens. The prototype compared native wallets with the existing card-entry path.

## Trade-off

Native wallets reduce data entry and payment-data exposure, while a custom quick-pay flow offers more visual control but increases implementation and compliance scope.

## Decision

Prioritize Apple Pay and Google Pay for the first fast-payment release.
