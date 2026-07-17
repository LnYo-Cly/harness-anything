# Offer delivery slot selection

Task Contract: harness-task v1

## Brief

Give customers a live, understandable order journey from confirmation to delivery.

## Goal

Ship a responsive tracking timeline with current status, next expected event, delivery window, and exception guidance.

## Context

Start from carrier webhook contracts, order-state mappings, notification preferences, and the existing order-detail page.

## Constraints

Do not promise carrier times as guarantees, expose internal status codes, or send notifications without respecting customer preferences.

## Checkpoint

Stop when carrier states cannot map without losing meaning or delivery estimates lack a trustworthy source; report before enabling notifications.

## CI/Gate Authority Stop Condition

If this task is not a CI/gate/governance task but requires modifying CI/gate authority surfaces to pass, stop implementation, record the blocker, and request or create a governance task. Explicit CI/gate/governance tasks and break-glass main recovery are the only exceptions; break-glass must record reason, scope, and a follow-up governance task.

## Implementation Plan

1. Normalize carrier events into customer-facing states.
2. Build the live timeline and exception cards.
3. Add notification preferences and deep links.
4. Test delayed, split, returned, and delivered orders.

## Verification

Verify event mappings, stale-data behavior, accessibility, notification consent, and operations approval.
