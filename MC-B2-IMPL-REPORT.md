# MC-B2 Implementation Checkpoint 1

Task: `task_01KX3W4V1EDPHPTGWYYBQQ2J75-mc-b2-impl-doc-write-intent-daemon-doc-sync-submit-forbidden-touch-valid`

Scope of this checkpoint: forbidden-touch algorithm draft, `doc.sync.submit`
request/response schema, and conflict/forbidden report shape. Phase 1 and Phase
2 implementation have not started.

## 1. Inputs Read

- Worker handbook:
  local worker handbook for fable GPT worker orchestration (private absolute
  path omitted)
- Task contract:
  `harness/tasks/task_01KX3W4V1EDPHPTGWYYBQQ2J75-mc-b2-impl-doc-write-intent-daemon-doc-sync-submit-forbidden-touch-valid/task_plan.md`
- Accepted design:
  `harness/tasks/task_01KX19GHXWJ2R7ZZ1YMSSM32PQ-mc-b2-doc-write-intent-agent-markdown-ledger/artifacts/doc-write-intent-design.md`
- Registry authority:
  `tools/write-road-registry.json`
- Registry checker:
  `tools/check-write-road-registry.mjs`
- Daemon JSON-RPC method registry and receipt envelope:
  `packages/daemon/src/protocol/method-registry.ts`,
  `packages/daemon/src/protocol/json-rpc-server.ts`,
  `packages/daemon/src/protocol/receipt-envelope.ts`
- Existing CAS rejection contract:
  `packages/kernel/src/store/write-journal-rejection.ts`,
  `packages/kernel/src/domain/errors.ts`,
  and MC-A2 report section 3.

## 2. Registry Facts

`tools/write-road-registry.json` is the only machine-readable authority for
write-road and write-channel classification.

Current forbidden-touch definition domain is exactly the registry rows where
`channel.pathClass === "rpc-only"`:

1. `task.package.create`
2. `task.lifecycle.transition`
3. `task.progress.append`
4. `task.force-terminal-audit`
5. `fact.record`
6. `fact.invalidate`
7. `decision.propose`
8. `decision.state.transition`
9. `decision.amend`
10. `decision.relate`
11. `decision.relation.mutate`
12. `module.registry.canonical`

The only pending B2 row is:

- `task.document.write-stage`
  - `road: "D"`
  - `bearing: "task-document"`
  - `channel.pathClass: "doc-sync-allowed-pending-B2"`
  - `channel.zoneClass: "task-authored-prose-or-stage"`

Phase 2 should flip that row to a final doc-sync path class only after the
validator, post-apply checker, CAS, and tests are in place.

## 3. Forbidden-Touch Algorithm Draft

The validator must answer this question:

> Does this proposed doc sync change touch any zone whose authoritative row in
> `tools/write-road-registry.json` is `channel.pathClass === "rpc-only"`?

Algorithm:

1. Load and validate `tools/write-road-registry.json` once at daemon startup or
   per submit with cache invalidation tied to the registry file mtime.
2. Build an in-memory rule index from registry rows only:
   - `forbiddenRows = rows.filter(row.channel.pathClass === "rpc-only")`
   - `allowedDocSyncRows = rows.filter(row.channel.pathClass starts with
     "doc-sync-allowed")`
   - `forbiddenZoneClasses = set(forbiddenRows.map(row.channel.zoneClass))`
   - `allowedZoneClasses = set(allowedDocSyncRows.map(row.channel.zoneClass))`
   - `rpcByBearingAndZone = rows grouped by bearing + zoneClass`
3. For every submitted file, verify the client-declared `pathClass`,
   `zoneClass`, and `bearing` against the registry. The client declaration is
   advisory; daemon-derived classification is authoritative.
4. Resolve the candidate path to an authored-root-relative path. Reject path
   traversal and paths outside the authored/document sync surface before
   reading content.
5. Read the current center blob and compute `currentBlobSha256`.
6. Enforce CAS:
   - If `baseLedgerSha` is stale and the target file changed since
     `baseBlobSha256`, reject with `cas_watermark_mismatch`.
   - If center head advanced but the target file's blob is still
     `baseBlobSha256`, allow fast-forward application and report the rebased
     center head in the accepted response.
7. Produce a structured diff between base/current/proposed content. The diff is
   used only to locate touched hunks; it does not auto-merge.
8. Run a zone extractor over each changed hunk. The extractor must classify by
   registry `bearing`/`zoneClass`, not by extension:
   - task authored structured zones, such as task package frontmatter and
     typed task state, map to `task-authored-structured`;
   - task prose/stage body zones map to `task-authored-prose-or-stage`;
   - decision structured zones, including decision frontmatter and typed
     relation/claim/provenance records, map to
     `decision-authored-structured`;
   - fact flow records map to `task-authored-structured` under `task-fact`;
   - module canonical registry content maps to
     `module-authored-structured`.
9. A touched hunk is forbidden when its daemon-derived `zoneClass` is in
   `forbiddenZoneClasses` or when its derived `bearing + zoneClass` resolves to
   a registry row whose `pathClass` is `rpc-only`.
10. Reject the entire submit if any forbidden touch exists. Return every
    forbidden touch, grouped by file and hunk, with the registry row id and the
    RPC/CLI route from that row.
11. If no forbidden touch and no CAS conflict exists, enqueue the doc sync
    through the daemon single-writer path.
12. After apply, re-run the same zone extractor on the pre-apply and post-apply
    center content for every submitted file. If any `rpc-only` zone changed,
    restore backups and fail hard. This is the post-apply checker.

Important implementation constraint: the code may contain parsers for
registered zone classes, but it must not contain an independent allow/deny list.
The allow/deny decision is always computed from registry rows.

## 4. Zone-Granularity Risk

No blocker is declared at this checkpoint, but Phase 2 must treat zone
classification as fail-closed.

The registry already names the mixed-zone model with separate zone classes:

- `task-authored-structured`
- `task-authored-prose-or-stage`
- `decision-authored-structured`
- `module-authored-structured`

It does not currently store selector details such as frontmatter-key lists or
markdown typed-record block selectors. Therefore the implementation must add a
zone extractor that emits those registry zone-class names, while keeping the
registry as the only allow/deny authority. If implementation proves that the
extractor cannot distinguish "same file frontmatter structured, body prose
allowed" without adding a second policy list, Phase 2 must stop and return this
as a classification-model problem.

Required C1/C2 controls from this risk:

- A `.md` file hunk that changes bearing structured frontmatter must be
  rejected.
- A non-`.md` free-text sync candidate must be accepted if its daemon-derived
  bearing/zone resolves to an allowed doc-sync row.
- A disguised prose edit that mutates typed records or frontmatter must be
  rejected with a forbidden-touch report.

## 5. `doc.sync.submit` Request Schema Draft

Daemon method contract:

```ts
method: "repo.doc.sync.submit"
mode: "active"
namespace: "repo"
auth: "local-session-token"
requiresRepo: true
commandClass: "repo-write"
inputSchemaId: "daemon.doc-sync-submit-request/v1"
outputSchemaId: "daemon.doc-sync-submit-result/v1"
errorSchemaId: "daemon.protocol-error/v1"
```

Request shape:

```ts
interface DocSyncSubmitRequestV1 {
  readonly repo: {
    readonly repoId: string;
  };
  readonly session?: {
    readonly sessionId?: string;
    readonly runtime?: "human" | "claude-code" | "codex" | "zcode" | "antigravity" | "unknown";
  };
  readonly payload: {
    readonly baseLedgerSha: string;
    readonly intentId: string;
    readonly declaredIntent:
      | "prose-edit"
      | "manual-artifact"
      | "generated-artifact"
      | "session-export";
    readonly changes: ReadonlyArray<DocSyncChangeV1>;
  };
}

interface DocSyncChangeV1 {
  readonly path: string;
  readonly baseBlobSha256: string | null;
  readonly newBlobSha256: string;
  readonly mediaType: string;
  readonly size: number;
  readonly declaredPathClass?: string;
  readonly declaredZoneClass?: string;
  readonly declaredBearing?: string;
  readonly content:
    | { readonly kind: "inline"; readonly body: string }
    | { readonly kind: "blob-ref"; readonly ref: string; readonly sha256: string; readonly size: number; readonly mediaType: string }
    | { readonly kind: "patch"; readonly unifiedDiff: string };
}
```

Notes:

- The daemon recomputes `newBlobSha256`; client-supplied hashes are assertions,
  not authority.
- `baseBlobSha256: null` represents file creation. Deletion should be explicit
  in a later schema revision if allowed; this checkpoint does not authorize
  delete via doc sync.
- Large content should use the existing MC-A6 content-addressed blob route.
- `declaredPathClass`, `declaredZoneClass`, and `declaredBearing` are accepted
  only for diagnostics and preview parity. They cannot override daemon
  classification.

## 6. `doc.sync.submit` Response Schema Draft

The daemon should continue returning `command-receipt/v2` envelopes. The
receipt `details.data` carries the doc-sync result.

Accepted:

```ts
interface DocSyncAcceptedV1 {
  readonly ok: true;
  readonly schema: "daemon.doc-sync-submit-result/v1";
  readonly status: "accepted";
  readonly intentId: string;
  readonly baseLedgerSha: string;
  readonly appliedLedgerSha: string;
  readonly rebasedFromLedgerSha?: string;
  readonly appliedChanges: ReadonlyArray<{
    readonly path: string;
    readonly baseBlobSha256: string | null;
    readonly newBlobSha256: string;
    readonly zoneClassesTouched: ReadonlyArray<string>;
  }>;
}
```

Rejected:

```ts
interface DocSyncRejectedV1 {
  readonly ok: false;
  readonly schema: "daemon.doc-sync-submit-result/v1";
  readonly status: "rejected";
  readonly intentId: string;
  readonly code:
    | "doc_sync_forbidden_touch"
    | "cas_watermark_mismatch"
    | "doc_sync_conflict"
    | "doc_sync_post_apply_bearing_changed"
    | "doc_sync_invalid_payload";
  readonly reason: string;
  readonly retryable: boolean;
  readonly currentWatermark?: string | null;
  readonly expectedWatermark?: string | null;
  readonly conflicts?: ReadonlyArray<DocSyncConflictV1>;
  readonly forbiddenTouches?: ReadonlyArray<DocSyncForbiddenTouchV1>;
  readonly postApplyViolations?: ReadonlyArray<DocSyncForbiddenTouchV1>;
}
```

CAS rejection must reuse the MC-A2 contract:

```ts
{
  "_tag": "WriteRejected",
  "code": "cas_watermark_mismatch",
  "currentWatermark": "<current ledger sha or blob watermark>",
  "expectedWatermark": "<request baseLedgerSha or baseBlobSha256>",
  "retryable": true
}
```

The command receipt should expose the same fields in `error` and
`details.data`; lower layers can keep using `WriteRejected`.

## 7. Forbidden-Touch Report Shape

```ts
interface DocSyncForbiddenTouchV1 {
  readonly path: string;
  readonly hunks: ReadonlyArray<{
    readonly hunkId: string;
    readonly oldStartLine: number | null;
    readonly oldEndLine: number | null;
    readonly newStartLine: number | null;
    readonly newEndLine: number | null;
    readonly bearing: string;
    readonly zoneClass: string;
    readonly registryRowId: string;
    readonly pathClass: "rpc-only";
    readonly summary: string;
    readonly requiredRpc: {
      readonly registryRowId: string;
      readonly cliActions?: ReadonlyArray<string>;
      readonly apiRoutes?: ReadonlyArray<string>;
      readonly guiBridgeMethods?: ReadonlyArray<string>;
      readonly writeKinds?: ReadonlyArray<string>;
    };
  }>;
}
```

Example:

```json
{
  "path": "harness/tasks/task_x/INDEX.md",
  "hunks": [
    {
      "hunkId": "hunk-1",
      "oldStartLine": 1,
      "oldEndLine": 12,
      "newStartLine": 1,
      "newEndLine": 12,
      "bearing": "task-lifecycle",
      "zoneClass": "task-authored-structured",
      "registryRowId": "task.lifecycle.transition",
      "pathClass": "rpc-only",
      "summary": "Changed task lifecycle frontmatter through doc sync.",
      "requiredRpc": {
        "registryRowId": "task.lifecycle.transition",
        "cliActions": ["status-set", "task-complete", "task-review"],
        "apiRoutes": ["tasks.status.set", "tasks.review"],
        "writeKinds": ["transition_local"]
      }
    }
  ]
}
```

## 8. Conflict Report Shape

```ts
interface DocSyncConflictV1 {
  readonly path: string;
  readonly code: "base_blob_changed" | "base_ledger_changed" | "content_hash_mismatch";
  readonly baseLedgerSha: string;
  readonly currentLedgerSha: string;
  readonly baseBlobSha256: string | null;
  readonly currentBlobSha256: string | null;
  readonly submittedNewBlobSha256: string;
  readonly retryable: true;
  readonly action:
    | "rerun-doc-status"
    | "refresh-base-and-resubmit"
    | "resolve-local-conflict";
  readonly message: string;
}
```

Example:

```json
{
  "path": "harness/tasks/task_x/task_plan.md",
  "code": "base_blob_changed",
  "baseLedgerSha": "9f2c...",
  "currentLedgerSha": "a817...",
  "baseBlobSha256": "51aa...",
  "currentBlobSha256": "0be1...",
  "submittedNewBlobSha256": "c733...",
  "retryable": true,
  "action": "refresh-base-and-resubmit",
  "message": "Center file changed since the submitted base; no automatic merge was performed."
}
```

## 9. Post-Apply Checker Shape

The checker should run inside the submit transaction after writing candidate
files and before committing/flushing success. It compares extracted rpc-only
zones from pre-apply and post-apply content.

If the checker fails:

1. Restore file backups.
2. Do not emit an accepted receipt.
3. Return `doc_sync_post_apply_bearing_changed` with
   `postApplyViolations`.
4. Preserve all failure details in the runtime event summary if runtime-event
   append is configured.

The checker is intentionally redundant with pre-submit validation. It catches
implementation errors, race conditions, and malformed zone extraction.

## 10. Test Obligations for Phase 1/2

The implementation must include positive controls that prove the detector can
fail:

1. Pure prose change passes.
2. Task frontmatter bearing/structured change in `.md` rejects.
3. Decision typed record change rejects.
4. Disguised prose edit that mutates typed record/frontmatter rejects.
5. Stale `baseLedgerSha` or `baseBlobSha256` rejects with
   `cas_watermark_mismatch`, `_tag: "WriteRejected"`, current/expected
   watermark, and `retryable: true`.
6. Post-apply mutation of rpc-only zones fails and rolls back.
7. Extension counterexamples: structured `.md` rejects; non-`.md` free text
   allowed only when daemon-derived bearing/zone resolves to doc-sync allowed.

Identity/commit tests must be hermetic with empty `HOME` and
`GIT_CONFIG_GLOBAL=/dev/null`.

## 11. Checkpoint Decision

Proceed to Phase 1 only after CEO accepts this shape.

Current checkpoint does not change code, registry, or reckon behavior. It also
does not claim `dec_mrcda9kw` coverage.

## 12. CEO Verdict Revisions Applied Before Phase 1

Checkpoint 1 verdict file read:
`harness/tasks/task_01KX3W4V1EDPHPTGWYYBQQ2J75-mc-b2-impl-doc-write-intent-daemon-doc-sync-submit-forbidden-touch-valid/artifacts/orchestration/checkpoint1-verdict.md`.

The Phase 2 design is revised as follows:

1. Registry rule freshness must key on the registry file content `sha256`, not
   mtime. If the registry cannot be read, parsed, or validated during submit,
   submit must fail closed. Phase 1 reports the registry sha256 in
   `doc-sync-status/v1`.
2. Forbidden touch has one authority path: derive a touched `bearing +
   zoneClass`, resolve registry row(s), then read each row's
   `channel.pathClass`. There is no separate `forbiddenZoneClasses` decision
   path. If no row resolves, submit must fail closed. Phase 1 surfaces these
   as `unresolvedTouches`.
3. `doc.sync.submit` runtime events must reserve actor fields
   `{ principal, executor, responsibleHuman }`. Phase 1 does not implement
   submit events. Human anchoring remains pending `dec_mrdrbkp7`; do not map an
   agent id into a fake person id.
4. Deletion through doc sync remains undefined. Phase 1 reports deletions with
   `deletionPolicy: "undefined-pending-phase-2"` and excludes them from
   submittable preview changes. Phase 2 must either define an explicit delete
   change type or reject with a replacement path.

## 13. Phase 1 Implementation

Implemented scope:

- `ha doc status` is read-only and reports dirty authored files, registry
  sha256, forbidden touches, unresolved touches, explicit deletion gaps, and
  candidate blobs.
- `ha doc sync --dry-run` builds a `daemon.doc-sync-submit-request/v1-preview`
  style preview from doc-sync candidates only; it does not submit or write.
- `task complete` and `decision propose` attach a soft `doc_sync_dirty` warning
  when authored doc-sync state is dirty. The warning is advisory and does not
  block the command.

Files changed:

- `packages/cli/src/commands/core/doc-sync.ts`: Phase 1 doc-sync status and
  preview builder. Registry decision uses registry rows only; parser code emits
  registry zone names but does not keep an independent allow/deny list.
- `packages/cli/src/commands/core/doc.ts`,
  `packages/cli/src/cli/parsers/doc.ts`,
  `packages/cli/src/cli/types.ts`, and
  `packages/cli/src/cli/command-spec/command-spec-runtime-docs.ts`: command
  surface for `doc-status` and `doc-sync-dry-run`.
- `packages/cli/src/commands/core/task-gates.ts` and
  `packages/cli/src/commands/core/decision-propose.ts`: soft dirty reminders.
- `packages/cli/test/docmap-cli.test.ts` and
  `packages/cli/test/parse-args.test.ts`: parser and CLI behavior coverage.
- `tools/write-road-registry.json`: added the new read-only git inspection
  callsite to the existing `public-code-change.git` direct git coverage row so
  the registry checker remains authoritative.

Phase 1 classifier notes:

- Task prose/stage documents under `tasks/**` map to
  `task-document/task-authored-prose-or-stage` and resolve through
  `task.document.write-stage`.
- `tasks/**/facts.md`, decision documents, module registry, and task
  `INDEX.md` frontmatter map to registry structured zones and report matching
  `rpc-only` rows as forbidden touches.
- Multiple registry rows can share a `bearing + zoneClass` pair. Phase 1
  expands all matching rows in the report rather than inventing a second
  selector. Phase 2 submit may need a finer registry selector if CEO wants
  one-row hunk attribution for fact/decision variants.

## 14. Phase 1 Verification Evidence

Commands run in this session:

- `npm run typecheck` -> passed.
- `node --test packages/cli/test/docmap-cli.test.ts packages/cli/test/parse-args.test.ts`
  -> passed, 140 tests.
- `npm run harness:check-cli-structure` -> passed.
- `npm run harness:check-cli-help-contract` -> passed.
- `npm run harness:check-write-road-registry` -> passed, 31 registry rows and
  297 discovered write surfaces.
- `npm run check:local` -> passed fast tier in 25.4s.

The new negative control is
`CLI doc status reports prose candidates and forbidden structured touches`: it
mutates a prose task document and `facts.md` in the same dirty tree, then
asserts only the prose file appears as a candidate blob while the structured
fact file reports an RPC-only forbidden touch.

## 15. Remaining Phase 2 Work / Known Gaps

- `doc.sync.submit`, submit validator, CAS, post-apply checker, rollback, and
  runtime event emission are intentionally not implemented in Phase 1.
- `dec_mrcda9kw` coverage is not claimed in this Phase 1 report.
- Actor `{ principal, executor, responsibleHuman }` event fields are reserved
  in the design only; principal/responsibleHuman population waits for
  `dec_mrdrbkp7`.
- Deletion remains the explicit Phase 2 decision point described above.
- Phase 1 does not flip `task.document.write-stage` from
  `doc-sync-allowed-pending-B2`; that belongs with Phase 2 submit enforcement.

## 16. Phase 2 Implementation

Implemented scope:

- Added the shared doc-sync zone extractor in `packages/application/src/doc-sync.ts`.
  CLI preview/status and daemon submit validation now consume this same module;
  there is no daemon-side copied classifier.
- Moved physical fs/git submit work into the CLI daemon adapter
  `packages/cli/src/daemon/doc-sync-service.ts`, keeping application doc-sync
  classification pure and under the existing physical-I/O boundary.
- Added `repo.doc.sync.submit` to the daemon JSON-RPC method registry as an
  active repo-write method with schema ids
  `daemon.doc-sync-submit-request/v1` and
  `daemon.doc-sync-submit-result/v1`.
- Implemented submit-time validation with explicit fail-closed unresolved zone
  handling. A doc-sync candidate now requires `unresolvedTouches.length === 0`;
  unresolved path/zone cases reject instead of being treated as outside the
  forbidden set.
- Implemented `baseLedgerSha` / per-file `baseBlobSha256` CAS. Stale center
  blob rejects with `_tag: "WriteRejected"`, `code:
  "cas_watermark_mismatch"`, current/expected watermarks, `retryable: true`,
  and a conflict report. Content hash assertion mismatches reject as
  `doc_sync_conflict`.
- Implemented post-apply rpc-only zone checking and rollback before the doc-sync
  commit. The checker snapshots rpc-only zone signatures before apply and
  restores changed files on violation.
- Added runtime event `actorAxes` support with
  `{ principal, executor, responsibleHuman }`. Submit events fill executor from
  session runtime where available. If there is no authenticated person,
  `principal` and `responsibleHuman` remain `null`; no agent id is mapped into a
  fake person id pending `dec_mrdrbkp7`.
- Flipped `tools/write-road-registry.json` row
  `task.document.write-stage` from `doc-sync-allowed-pending-B2` to
  `doc-sync-allowed`, and registered the new doc-sync submit direct fs/git write
  surface under that row.
- Reduced forbidden-touch report noise by selecting a single best registry row
  for duplicate `bearing + zoneClass` rpc-only matches using registry-declared
  route richness. The task frontmatter case now reports
  `task.lifecycle.transition` instead of three task-lifecycle rows.

Files changed:

- `packages/application/src/doc-sync.ts`
- `packages/cli/src/daemon/doc-sync-service.ts`
- `packages/cli/src/commands/core/doc-sync.ts`
- `packages/cli/src/index.ts`
- `packages/daemon/src/protocol/method-registry.ts`
- `packages/daemon/src/protocol/json-rpc-server.ts`
- `packages/kernel/src/domain/runtime-event.ts`
- `packages/kernel/src/schemas/runtime-event.ts`
- `packages/application/src/runtime-event-ledger-service.ts`
- `packages/application/src/index.ts`
- `packages/cli/test/doc-sync-service.test.ts`
- `packages/daemon/test/doc-sync-protocol.test.ts`
- `packages/daemon/test/json-rpc-protocol.test.ts`
- `packages/cli/test/docmap-cli.test.ts`
- `tools/test-tier-manifest.mjs`
- `tools/write-road-registry.json`

Deletion policy remains explicit: deletion through doc sync is still rejected as
undefined. This report continues to mark the replacement path as pending
governance; no silent delete path was added.

## 17. Phase 2 Verification Evidence

TDD red controls were run before implementation:

- `node --test packages/application/test/doc-sync-service.test.ts
  packages/daemon/test/json-rpc-protocol.test.ts` initially failed because the
  shared module and daemon method did not exist.

Commands run after implementation:

- `node --test packages/cli/test/doc-sync-service.test.ts
  packages/daemon/test/doc-sync-protocol.test.ts
  packages/daemon/test/json-rpc-protocol.test.ts
  packages/cli/test/docmap-cli.test.ts` -> passed, 37 tests after the protocol
  split.
- `npm run typecheck` -> passed.
- `npm run lint` -> passed.
- `npm run harness:check-write-road-registry` -> passed, 31 registry rows and
  305 discovered write surfaces.
- `npm run check:local` -> passed fast tier in 25.2s.
- `npm run build -w @harness-anything/cli` -> passed before running reckon.

Doc-sync dedicated coverage added in `packages/cli/test/doc-sync-service.test.ts`
and `packages/daemon/test/doc-sync-protocol.test.ts`:

1. Pure task prose submit passes and commits with hermetic git author.
2. Same `.md` extension counterexample is fixed in tests: `task_plan.md` prose is
   accepted while `INDEX.md` frontmatter rejects.
3. Decision typed record mutation rejects.
4. Disguised task fact record mutation rejects.
5. Stale `baseLedgerSha` / `baseBlobSha256` rejects with A2 CAS shape.
6. Post-apply rpc-only mutation fails and rolls back changed files.
7. Non-`.md` task prose is allowed when daemon-derived bearing/zone resolves to
   the doc-sync registry row.
8. Daemon protocol exposes `repo.doc.sync.submit` and appends dual-axis actor
   fields without inventing a responsible human.

## 18. Reckon Stop Point

The required reckon command did not turn green in this worker environment.

Evidence:

- `ha decision reckon dec_mrcda9kw --task
  task_01KX3W4V1EDPHPTGWYYBQQ2J75 --json` from this worktree failed with
  `decision_read_failed` because this worktree does not contain the private
  authored decision ledger.
- After rebuilding the CLI, `node packages/cli/dist/cli/src/index.js --root
  /Users/lizeyu/Projects/coding-agent-harness/harness-anything --json decision
  reckon dec_mrcda9kw --task task_01KX3W4V1EDPHPTGWYYBQQ2J75` read the decision
  but returned `uncoveredClaimRefs:
  ["decision/dec_mrcda9kw/C1","decision/dec_mrcda9kw/C2"]` and failed while
  trying to record the reckon fact with `JournalUnavailable`.
- The same rebuilt CLI with `--dry-run` avoided fact writing and still returned
  `decision_reckon_uncovered` for C1 and C2, so the blocker is uncovered
  ledger-side claim evidence rather than only the fact-write failure.

Per the Phase 2 redline, I did not modify reckon, add claim/checker exemptions,
or write ledger facts from this worker. The remaining action is for CEO to run
or record the ledger-side coverage/fact path from the canonical checkout once
this code diff is reviewed.
