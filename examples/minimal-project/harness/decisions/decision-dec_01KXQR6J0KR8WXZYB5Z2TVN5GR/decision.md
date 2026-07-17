---
schema: decision-package/v1
decision_id: dec_01KXQR6J0KR8WXZYB5Z2TVN5GR
_coordinatorWatermark: 1784282302595-9573bea6-c91fb567989d12a0
title: "Enforce a checkout performance budget"
state: proposed
riskTier: medium
urgency: high
vertical: "software/coding"
preset: "architecture-decision"
applies_to:
  modules: []
  productLines: []
proposedAt: "2026-07-17T09:58:22.483Z"
provenance:
  - { runtime: "codex", sessionId: "demo-aurora-commerce", boundAt: "2026-07-17T09:58:22.483Z" }
question: "How should Aurora prevent checkout performance regressions?"
chosen:
  - { id: "CH1", text: "Gate releases on a measurable mobile performance budget" }
rejected:
  - { id: "RJ1", text: "Monitor performance after release without a gate", why_not: "Post-release monitoring discovers conversion damage only after customers experience it." }
claims:
  - { id: "C1", text: "A release budget keeps mobile checkout within the product latency target." }
relations:
  - { relation_id: "rel_54b9d8c5d7eb571d", source: "decision/dec_01KXQR6J0KR8WXZYB5Z2TVN5GR/C1", target: "fact/task_01KXQQ6575HXY3QJ0HSH519Y47/F-A11CE005", type: "evidenced-by", strength: "strong", direction: "directed", origin: "declared", rationale: "Production Web Vitals show the current checkout exceeds its target.", state: "active" }
  - { relation_id: "rel_225dfa2d177b4e2e", source: "decision/dec_01KXQR6J0KR8WXZYB5Z2TVN5GR/CH1", target: "task/task_01KXQQ6575HXY3QJ0HSH519Y47", type: "derives", strength: "strong", direction: "directed", origin: "declared", rationale: "The budget policy creates the performance enforcement task.", state: "active" }
---

## Context

Checkout performance affects conversion, but regressions often arrive through small independent changes that look harmless in review.

## Trade-off

A hard budget adds release friction and demands stable measurement. Monitoring alone is cheaper but reacts after impact.

## Decision

Gate checkout releases on agreed mobile Web Vitals and JavaScript budgets, with an explicit exception record for emergencies.
