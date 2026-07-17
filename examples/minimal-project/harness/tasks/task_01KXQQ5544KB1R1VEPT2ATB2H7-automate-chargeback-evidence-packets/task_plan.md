# Automate chargeback evidence packets

Task Contract: harness-task v1

## Brief

Design a calm, recoverable payment-failure experience that preserves customer trust.

## Goal

Deliver production-ready failure states, recovery copy, and retry rules for declined, timed-out, and duplicated payment attempts.

## Context

Review payment-provider error contracts, support transcripts, existing checkout components, and retry telemetry before changing the recovery flow.

## Constraints

Never imply that a failed authorization charged the customer, never retry without explicit consent, and preserve the order draft throughout recovery.

## Checkpoint

Stop if provider error semantics are ambiguous or recovery requires a payment-contract change; report before user testing and rollout.

## CI/Gate Authority Stop Condition

If this task is not a CI/gate/governance task but requires modifying CI/gate authority surfaces to pass, stop implementation, record the blocker, and request or create a governance task. Explicit CI/gate/governance tasks and break-glass main recovery are the only exceptions; break-glass must record reason, scope, and a follow-up governance task.

## Implementation Plan

1. Map provider errors to customer-safe states.
2. Prototype retry, alternate-payment, and support paths.
3. Validate copy and accessibility with customers.
4. Ship behind a feature flag and monitor recovery rate.

## Verification

Verify error mapping, keyboard and screen-reader behavior, duplicate-charge protection, analytics, and payments/support approval.
