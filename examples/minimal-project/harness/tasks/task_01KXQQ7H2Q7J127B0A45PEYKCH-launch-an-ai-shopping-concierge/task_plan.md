# Launch an AI shopping concierge

Task Contract: harness-task v1

## Brief

Explore and ship a trustworthy AI-assisted commerce capability with measurable customer value.

## Goal

Deliver a production-ready experience that improves product discovery or purchase confidence while keeping customers in control and making uncertainty visible.

## Context

Start from catalog quality, search and recommendation telemetry, customer research, evaluation datasets, and the existing shopping journey. Treat model output as a fallible suggestion rather than product truth.

## Constraints

- Never invent price, inventory, compatibility, sustainability, or policy claims.
- Provide a clear non-AI fallback and preserve customer control.
- Do not use sensitive customer data without an explicit approved purpose.
- Measure quality across languages, devices, and representative customer cohorts.

## Checkpoint

Stop if grounding coverage is insufficient, evaluation results regress a protected cohort, or the experience cannot explain uncertainty. Report after offline evaluation and before customer rollout.

## CI/Gate Authority Stop Condition

If this task is not a CI/gate/governance task but requires modifying CI/gate authority surfaces to pass, stop implementation, record the blocker, and request or create a governance task.

## Implementation Plan

1. Define the customer job, success metric, and non-AI baseline.
2. Build a grounded prototype with observable sources and confidence signals.
3. Evaluate relevance, safety, latency, cost, and cohort quality.
4. Run a guarded pilot with feedback and instant fallback.
5. Review results before expanding traffic.

## Verification

Verify grounding, offline evaluation thresholds, latency and cost budgets, accessibility, fallback behavior, privacy review, and product approval.
