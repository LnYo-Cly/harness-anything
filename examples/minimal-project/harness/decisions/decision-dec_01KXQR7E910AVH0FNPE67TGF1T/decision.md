---
schema: decision-package/v1
decision_id: dec_01KXQR7E910AVH0FNPE67TGF1T
_coordinatorWatermark: 1784282331460-a0c3fa7d-779fdf5cfa1e89fa
title: "Keep shopping AI grounded in catalog truth"
state: proposed
riskTier: high
urgency: medium
vertical: "software/coding"
preset: "architecture-decision"
applies_to:
  modules: []
  productLines: []
proposedAt: "2026-07-17T09:58:51.425Z"
provenance:
  - { runtime: "codex", sessionId: "demo-aurora-commerce", boundAt: "2026-07-17T09:58:51.425Z" }
question: "What boundary should govern Aurora AI shopping assistance?"
chosen:
  - { id: "CH1", text: "Generate suggestions only from retrievable catalog and policy sources" }
rejected:
  - { id: "RJ1", text: "Allow open-ended model answers when catalog evidence is incomplete", why_not: "Ungrounded answers can invent product, price, availability, compatibility, or policy claims." }
claims:
  - { id: "C1", text: "Grounded assistance improves discovery without turning model confidence into product truth." }
relations:
  - { relation_id: "rel_537a051b82729e73", source: "decision/dec_01KXQR7E910AVH0FNPE67TGF1T/C1", target: "fact/task_01KXQQ7H2Q7J127B0A45PEYKCH/F-A11CE006", type: "evidenced-by", strength: "strong", direction: "directed", origin: "declared", rationale: "The grounded pilot improved add-to-cart behavior.", state: "active" }
  - { relation_id: "rel_92375b855a375ed8", source: "decision/dec_01KXQR7E910AVH0FNPE67TGF1T/CH1", target: "task/task_01KXQQ7H2Q7J127B0A45PEYKCH", type: "derives", strength: "strong", direction: "directed", origin: "declared", rationale: "The grounding boundary shapes the concierge implementation task.", state: "active" }
---

## Context

Customers may treat shopping guidance as authoritative even when a model is uncertain. Catalog and policy facts must remain the source of truth.

## Trade-off

Grounding limits conversational breadth and may require a fallback. Open-ended answers feel more fluid but create unacceptable factual and trust risk.

## Decision

Restrict shopping assistance to retrieved catalog and policy sources, show uncertainty, and provide a non-AI fallback whenever evidence is incomplete.
