# Operator GUI V2 设计缺陷修复：Terminal 嵌入 + 三元语闭环 + 关系图规模化 + 视图职责重构 - Task Package Index

Task Contract: harness-task/v1

## Task Identity

| Field | Value |
| --- | --- |
| Task ID | `2026-06-27-harness` |
| Budget | `complex` |
| Preset | `none` |
| Module | `n/a` |
| Long-running | `no` |
| Created | 2026-06-27 |

## Task Backend Binding

| Field | Value |
| --- | --- |
| Binding Schema | `task-binding/v1` |
| State Backend | `local` |
| Issue Backend | `none` |
| Sync Mode | `local-only` |
| Binding Role | `root` |
| Harness Task Ref | `TASKS/2026-06-27-harness` |
| Task Package Path | `coding-agent-harness/planning/tasks/2026-06-27-harness` |
| External Provider | `none` |
| External ID | `none` |
| External Identifier | `none` |
| Title Snapshot | `n/a` |
| Binding Created | 2026-06-27 |

## Task Audit Metadata

| Field | Value |
| --- | --- |
| Created By | harness new-task |
| Created At | 2026-06-27 |
| Command Shape | harness new-task harness --budget complex --locale en-US --title 'Operator GUI V2 设计缺陷修复：Terminal 嵌入 + 三元语闭环 + 关系图规模化 + 视图职责重构' . |
| Budget | complex |
| Template Source | templates/planning/INDEX.md |
| Task Creator | ZeyuLi <lizeyu990625@gmail.com> |
| Task Creator Source | git-config |
| Human Review Status | not-confirmed |
| Confirmation ID | n/a |
| Confirmed At | n/a |
| Reviewer | n/a |
| Reviewer Email | n/a |
| Confirm Text | n/a |
| Evidence Checked | n/a |
| Review Commit SHA | n/a |
| Audit Source | native-index |
| Audit Status | created |
| Exception Reason | n/a |
| Message | n/a |
| Migration Status | native |
| Migrated From | n/a |
| Legacy Extra Fields | {} |
| Migration Notes | n/a |

## Core Contract Files

| File | Purpose |
| --- | --- |
| `brief.md` | Human-readable task summary and context entry. |
| `task_plan.md` | Current task goal, scope, selected budget, acceptance, and operating decisions. |
| `visual_map.md` | Phase map, evidence status, next lifecycle commands, and supporting diagrams. |
| `progress.md` | Execution log, verification evidence, decisions, and handoff notes. |
| `walkthrough.md` | Task-local closeout summary, verification, review disposition, residual risk, and links. |

## Standard Task Files

These files exist for standard and complex tasks.

| File | Purpose |
| --- | --- |
| `execution_strategy.md` | Execution mode, ownership, conflict control, and evidence strategy. |
| `findings.md` | Findings, research notes, accepted risks, and unresolved questions. |
| `lesson_candidates.md` | Task-local lesson candidate decisions before closeout. |
| `review.md` | Agent review submission, adversarial review, findings, evidence, and routing. |

## Optional Indexes

| Index | Purpose |
| --- | --- |
| `references/INDEX.md` | References and preset-provided required reads. |
| `artifacts/INDEX.md` | Generated outputs, evidence bundles, screenshots, reports, and command artifacts. |

## Preset Summary

This section is system-rendered. Presets may not add custom root-level files or arbitrary root `INDEX.md` content.

| Field | Value |
| --- | --- |
| Preset | `none` |
| Preset Version | `n/a` |
| Evidence Bundle | `n/a` |
| Resource Indexes | `references/INDEX.md`; `artifacts/INDEX.md` |

## Update Rules

- Update status and decisions in `progress.md`.
- Keep task-specific goals and acceptance in `task_plan.md`.
- Put large command output, screenshots, reports, and generated files in `artifacts/INDEX.md`.
- Put source material, external links, and preset required reads in `references/INDEX.md`.
- Do not rename the task directory automatically after an external title changes; update binding/display fields only.
