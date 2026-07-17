---
schema: decision-package/v1
decision_id: dec_01KXQR5AFYRB0R965WV4XHNEZ6
_coordinatorWatermark: 1784282262044-0dddf5ef-4f84a4498ed74e5c
title: "Reserve inventory before authorization"
state: proposed
riskTier: high
urgency: high
vertical: "software/coding"
preset: "architecture-decision"
applies_to:
  modules: []
  productLines: []
proposedAt: "2026-07-17T09:57:42.014Z"
provenance:
  - { runtime: "codex", sessionId: "demo-aurora-commerce", boundAt: "2026-07-17T09:57:42.014Z" }
question: "When should Aurora reserve scarce inventory during checkout?"
chosen:
  - { id: "CH1", text: "Create a short inventory hold before payment authorization" }
rejected:
  - { id: "RJ1", text: "Reserve inventory only after payment succeeds", why_not: "Post-payment reservation allows successful payments for inventory that has already sold out." }
claims:
  - { id: "C1", text: "A temporary pre-authorization hold prevents oversells during high-concurrency launches." }
relations:
  - { relation_id: "rel_e80258edea9e75bc", source: "decision/dec_01KXQR5AFYRB0R965WV4XHNEZ6/C1", target: "fact/task_01KXQQ58F6QCBZCC2N66QAT59H/F-A11CE004", type: "evidenced-by", strength: "strong", direction: "directed", origin: "declared", rationale: "The incident review quantifies oversells without a hold.", state: "active" }
  - { relation_id: "rel_e35842fde85cee78", source: "decision/dec_01KXQR5AFYRB0R965WV4XHNEZ6/CH1", target: "task/task_01KXQQ58F6QCBZCC2N66QAT59H", type: "derives", strength: "strong", direction: "directed", origin: "declared", rationale: "The reservation policy directly creates the inventory-hold implementation task.", state: "active" }
---

## Context

Flash-sale traffic lets several customers attempt to buy the final units at the same time. Payment success is not proof that inventory remains available.

## Trade-off

A short hold reduces oversells but requires expiry and abandonment handling. Reserving after payment is simpler but creates refunds and broken trust.

## Decision

Create a time-bounded inventory hold before payment authorization and release it automatically on expiry or failure.
