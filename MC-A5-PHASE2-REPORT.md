# MC-A5 Phase 2 Report

## What Changed

- Added `tools/write-road-registry.json` as the single machine-readable authority for write-road and write-channel classification.
- Added `tools/check-write-road-registry.mjs`, an AST/manifest/preset checker covering:
  - `WriteOpKind` string unions.
  - machine artifact boundary unions.
  - `writeCoordinatedPayload`, `writeCoordinatedTaskDocuments`, and `coordinator.enqueue` callsites.
  - direct `node:fs`, `node:fs/promises`, and direct `git` process sinks.
  - daemon `repo.command.run` write/arbiter action classes.
  - mutating GUI/API routes and GUI bridge methods.
  - preset/script declared `writes` and `produces`.
- Added `tools/check-write-road-registry.test.mjs` with one positive fixture and five negative fixtures.
- Registered the new gate in `package.json`, `tools/gate-manifest.json`, and `tools/test-tier-manifest.mjs`.
- Preserved existing `check-bypass-write-boundary` and `check-write-coordinator-boundary`; no weakening changes were made to either checker or allowlist.

## Registry And Manifest Shape

Decision: one registry file carries both dimensions:

- `road`: A/B/C/D write-road classification.
- `channel.pathClass` and `channel.zoneClass`: the write-channel manifest dimension required by `dec_mrcda9kw`.

Reason: this avoids two competing authorities. The checker consumes only `tools/write-road-registry.json`; `tools/gate-manifest.json` only registers the checker as a PR-required boundary gate.

Registry reconciliation:

- Phase1 functional rows: 26.
- Registry rows: 31.
- Difference: +5 rows from required splits/infrastructure coverage:
  - module canonical registry vs generated view.
  - runtime-event coordinated JSONL vs direct fallback.
  - script declared writes vs declared produces.
  - public code truth vs worktree binding cache.
  - WriteCoordinator runtime substrate row for WAL/locks/durable flush internals.

Terminal session mutating routes were discovered by the daemon/GUI route scan and classified under D/local runtime in `repository.bootstrap.admin`; they fit A/B/C/D and did not require a fifth road.

## Negative Fixtures

`node --test tools/check-write-road-registry.test.mjs` demonstrates each red path independently:

- Unregistered `writeCoordinatedPayload` callsite: fails on `unregistered.ts#coordinator-callsite`.
- Unregistered machine artifact boundary: fails on `machine artifact boundary unregistered-boundary`.
- Unregistered direct fs write: fails on `unregistered-fs.ts#direct-write`.
- Unregistered mutating GUI/API route: fails on `tasks.unregistered` and `unregisteredBridge`.
- Unregistered preset script output scope: fails on `{{paths.tasksRoot}}/*/**`.

The positive fixture also passes, proving the checker can be quiet when all discovered surfaces are covered.

## Verification

- `npm run harness:check-write-road-registry`
  - Passed: `Write-road registry check passed (31 row(s), 296 discovered write surface(s)).`
- `node --test tools/check-write-road-registry.test.mjs`
  - Passed: 6 tests, including 5 negative fixtures.
- `npm run harness:check-gate-surface`
  - Passed: `Gate surface check passed (51 manifest gates, 0 drift findings).`
- `npm run harness:check-bypass-write-boundary`
  - Passed: `current=125 previous=125 delta=0`.
- `npm run harness:check-write-coordinator-boundary`
  - Passed: `current=9 previous=9 delta=0`.
- Manifest-runner proof:
  - `node tools/run-manifest-gates.mjs --package-surface check ...`
  - Passed with one selected command: `check-write-road-registry`.
- `npm run check:local`
  - Passed in 24.8s.

## Unverified

- Full `npm run check` was not run; the requested local stop gate was `npm run check:local`.
- Cloud CI, push, PR creation, and tags were not run by design.
