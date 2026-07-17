# Audit checkout accessibility

Task Contract: harness-task v1

## Brief

Audit the complete checkout journey against WCAG 2.2 AA and real assistive-technology workflows.

## Goal

Produce a prioritized findings report, verified fixes for critical barriers, and regression coverage for checkout accessibility.

## Context

Audit checkout components, design tokens, validation messages, payment embeds, and analytics with VoiceOver, NVDA, keyboard-only, zoom, and reduced motion.

## Constraints

Do not treat automated scans as sufficient, remove visible focus indicators, or ship critical-severity barriers with a waiver.

## Checkpoint

Stop and escalate if a third-party payment surface blocks remediation or a fix changes payment semantics; report after audit and after retest.

## CI/Gate Authority Stop Condition

If this task is not a CI/gate/governance task but requires modifying CI/gate authority surfaces to pass, stop implementation, record the blocker, and request or create a governance task. Explicit CI/gate/governance tasks and break-glass main recovery are the only exceptions; break-glass must record reason, scope, and a follow-up governance task.

## Implementation Plan

1. Run automated and manual journey audits.
2. Rank findings by severity and customer impact.
3. Fix critical and serious barriers.
4. Retest with assistive technologies and add regressions.

## Verification

Verify zero critical barriers, documented serious findings, keyboard and screen-reader journeys, zoom/reflow, reduced motion, and accessibility review approval.
