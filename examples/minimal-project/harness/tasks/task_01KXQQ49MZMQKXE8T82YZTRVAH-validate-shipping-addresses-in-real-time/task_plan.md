# Validate shipping addresses in real time

Task Contract: harness-task v1

## Brief

Launch a secure one-click checkout for returning Aurora customers on web and mobile.

## Goal

Returning customers can review, authenticate, and place an order in under 30 seconds without re-entering saved address or payment details. The first release ships to 10% of returning customers behind the `express-checkout` feature flag.

## Context

The June mobile funnel shows the sharpest abandonment at repeated address and payment confirmation. Start with the checkout shell, passkey authentication contract, payment orchestration API, and rollout dashboard. Facts record observed funnel and usability evidence; the linked decision records why express checkout is the default path.

## Constraints

- Preserve the existing multi-step checkout as an instant fallback.
- Never expose full payment credentials to the client.
- Do not expand the rollout above 10% without payment, fraud, and support sign-off.
- Meet WCAG 2.2 AA for the complete keyboard and screen-reader flow.

## Checkpoint

Stop if passkey support falls below the agreed browser baseline, the payment authorization contract must change, or the experiment increases fraud-review rate by more than 0.2 percentage points. Report after prototype validation and before production rollout.

## CI/Gate Authority Stop Condition

If this task is not a CI/gate/governance task but requires modifying CI/gate authority surfaces to pass, stop implementation, record the blocker, and request or create a governance task. Explicit CI/gate/governance tasks and break-glass main recovery are the only exceptions; break-glass must record reason, scope, and a follow-up governance task.

## Implementation Plan

1. Build the express-checkout summary and explicit fallback path.
2. Integrate passkey authentication and server-side payment authorization.
3. Add analytics for completion time, fallback use, errors, and fraud review.
4. Validate keyboard, screen-reader, mobile, and payment-failure journeys.
5. Roll out to 10% of returning customers and compare against the control.

## Verification

- Contract, integration, accessibility, and payment-failure tests pass.
- Median returning-customer completion time is below 30 seconds in the pilot.
- Product, payments, fraud, accessibility, and support owners approve the 10% rollout.
- CI and code-document reconciliation receipts are attached before completion.
