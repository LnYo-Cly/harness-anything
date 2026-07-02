<div align="center">

# Harness Anything

**An agent task harness for long-horizon software work.**

<p>
  <a href="#architecture-overview">Architecture</a> ·
  <a href="#core-concepts">Concepts</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#command-reference">Commands</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#contributing">Contributing</a>
</p>

<p>
  <a href="./LICENSE"><img alt="License: AGPL-3.0-or-later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue"></a>
  <a href="https://github.com/FairladyZ625/harness-anything/actions/workflows/rewrite-ci.yml"><img alt="CI" src="https://github.com/FairladyZ625/harness-anything/actions/workflows/rewrite-ci.yml/badge.svg"></a>
  <a href="https://github.com/FairladyZ625/harness-anything/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/FairladyZ625/harness-anything?style=flat&logo=github&color=yellow"></a>
  <a href="https://github.com/FairladyZ625/harness-anything/issues"><img alt="Issues" src="https://img.shields.io/github/issues/FairladyZ625/harness-anything"></a>
  <img alt="Status: early" src="https://img.shields.io/badge/status-early%20%26%20unstable-orange">
</p>

<p>
  <a href="./README.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="./README.zh-CN.md"><img alt="简体中文 README" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
</p>

</div>

---

Harness Anything gives coding agents a durable task layer: local task packages,
governance checks, migration evidence, and a small kernel that adapters, CLIs,
and GUIs can build on without owning lifecycle state.

Agents are getting better at changing code. They still need a reliable way to
carry work across long sessions, split tasks, preserve review evidence, and
prove that local state has not drifted from the repository. Harness Anything
treats that operating layer as a first-class, inspectable artifact.

## What this is

- A local-first task harness for coding-agent work.
- A TypeScript monorepo with kernel, CLI, GUI, application, and adapter
  packages.
- A governance surface for checking task packages, file complexity, import
  boundaries, private/public boundaries, schema contracts, and Legacy Intake
  readiness.
- A supply-chain release gate: high-severity npm advisory checks, CycloneDX
  SBOM generation, OSV readiness, license policy, and the AGPL network-service
  release-note checklist all run before anything is allowed to ship.
- A clean-room rewrite workspace for the public Harness product surface.

## What this is not

- Not an agent runtime, model router, or chat UI.
- Not a replacement for Git, GitHub, or CI.
- Not a cloud task database.
- Not a published npm release yet. All workspace packages stay private at
  version `0.0.0`; publication is gated behind OSV, license, and SBOM
  evidence.

## Architecture overview

The kernel is the single semantic authority. It owns the domain model — task
identity, the six-state lifecycle, external bindings, package disposition,
closeout readiness — plus the schemas and storage ports that everything else
consumes. Lifecycle transitions are validated in exactly one place; no edge
layer redefines what "done" means.

Everything around the kernel is a consumer. The CLI parses commands and renders
receipts, the GUI foundation maps daemon and API contracts, the application
layer keeps controller/service orchestration out of UI code, and adapters
collect or publish evidence at the boundary. Contracts — command receipts,
API registries, schema definitions — derive from one canonical source rather
than being re-declared per surface, and governance checks enforce that
derivation stays intact.

Authored state is plain markdown under Git; generated state is a rebuildable
local cache. The markdown task package is the source of truth, a SQLite
projection is derived from it, and checks can always prove whether the two
agree.

| Layer | What it does | Current status |
| --- | --- | --- |
| **Kernel** | Owns domain types, the six-state lifecycle, schemas, task projection, lifecycle validation, and storage ports. | Implemented in `@harness-anything/kernel`. |
| **CLI** | Exposes local commands for init, doctor, status, checks, task operations, presets, modules, migration evidence, and Git diff evidence. | Implemented in `@harness-anything/cli`. |
| **Application layer** | Keeps controller/service orchestration out of UI and adapter code. | Implemented in `@harness-anything/application`. |
| **GUI foundation** | Provides the Electron desktop shell, daemon/API contracts, terminal/session policies, workspace shell model, and distribution/update policy boundary. | M2.5 GUI/daemon foundation in `@harness-anything/gui`; not a complete GUI product. |
| **Adapters** | Connect external systems without taking ownership of harness state. | Local and Multica surfaces exist; GitHub Issues and Linear packages are explicit M4 placeholders. |

## Core concepts

- **Task package.** A markdown package under `harness/planning/tasks/` with a
  random `task_<ULID>` identity. It is the source of truth for one unit of
  work; slugs and titles are display metadata, not identity.
- **Evidence.** Typed pointers (`type:path:summary`) attached to task progress,
  review, and completion — plus dedicated evidence commands for Git diffs and
  legacy migration. Evidence is recorded, not inferred.
- **Binding.** A fingerprinted link between a task and an external engine
  reference. Core binding fields are immutable after creation, so tampering
  with an external link is detectable.
- **Lifecycle.** Six states: `planned`, `active`, `blocked`, `in_review`,
  `done`, `cancelled`. `done` and `cancelled` are terminal; follow-up work uses
  supersede, not reopen. Archive and tombstone are package dispositions, not
  extra states.
- **Vertical and preset.** A vertical (like `software/coding`) defines the task
  domain and its contracts; a preset (like `standard-task`) layers workflow
  choices — templates, checks, actions — on top for a concrete use case.
- **Module.** A registered slice of the project (key, title, source scope)
  that tasks can target, so multi-module work stays filterable and scoped.

## Getting started

Use Node.js 24 or newer.

```bash
npm ci
npm run check
```

`npm run check` is the full local gate: typecheck, tests, governance checks,
package smoke, and supply-chain checks. The `rewrite-ci` workflow runs the same
public gates on Node 24 and Node 26.

During development the CLI runs straight from source (Node's built-in
TypeScript execution). Confirm your environment first:

```bash
node packages/cli/src/index.ts doctor --json
```

The minimal project loop:

```bash
node packages/cli/src/index.ts --root /path/to/project init --json
node packages/cli/src/index.ts --root /path/to/project new-task --title "First task" --json
node packages/cli/src/index.ts --root /path/to/project status --json
node packages/cli/src/index.ts --root /path/to/project check --post-merge --json
```

For coding-agent work, create tasks through the coding vertical and preset
surface, then close them through the review/CI gate:

```bash
node packages/cli/src/index.ts --root /path/to/project new-task --title "Implement slice" --vertical software/coding --preset standard-task --json
node packages/cli/src/index.ts --root /path/to/project task-complete <task-id> --ci passed --reviewer <reviewer-id>
```

Unfinished old task state is treated as Legacy Intake evidence. Rebuild it into
a new Harness task with provenance instead of expecting bulk conversion:

```bash
node packages/cli/src/index.ts --root /path/to/project new-task --from-legacy <legacy-id> --json
```

## Command reference

The CLI is `harness-anything`, with `ha` as the short alias. It exposes 50+
commands across these families; every command supports `--json` receipts.

| Family | What it covers | Example |
| --- | --- | --- |
| Project setup | Initialize the harness layout; read-only environment diagnostics. | `harness-anything init --name my-project` |
| Task creation | Create task packages, optionally through a vertical, preset, or module, or from legacy evidence. | `harness-anything new-task --title "Implement slice" --vertical software/coding --preset standard-task` |
| Task lifecycle | Status transitions, progress with evidence, archive, supersede, delete, reopen. | `harness-anything task status set task_01ABC active --reason "work started"` |
| Task gates | Review and completion gates tied to reviewer and CI results. | `harness-anything task-complete task_01ABC --ci passed --reviewer reviewer-id` |
| Query and checks | Task listing with filters, harness status, governance health checks, lesson promotion. | `harness-anything check --post-merge --json` |
| Migration and Legacy Intake | Scan, plan, index, and verify legacy state; adopt external Multica snapshots. | `harness-anything legacy verify --json` |
| Evidence and diagnostics | Git diff evidence against a base ref; doctor. | `harness-anything git-diff --base origin/main --json` |
| Extension surface | Templates, presets, modules, vertical validation, and the GUI launcher. | `harness-anything preset list --json` |

The full command surface, receipts, and check profiles are documented in
[M2 coding vertical](./docs-release/m2-coding-vertical.md).

## Packages

This repository is a single Git monorepo. Packages under `packages/` are npm
workspace packages, not nested Git repositories. All workspace packages are
`private: true` at version `0.0.0`; nothing is published to npm.

| Package | Purpose |
| --- | --- |
| `@harness-anything/kernel` | Domain model, six-state lifecycle, schemas, task projection, storage ports. |
| `@harness-anything/cli` | Local command surface for project, task, preset, module, migration, evidence, and check workflows. |
| `@harness-anything/application` | Shared controller/service layer used by CLI and GUI surfaces. |
| `@harness-anything/gui` | Electron GUI foundation, daemon/API contracts, and renderer boundary. |
| `@harness-anything/adapter-local` | Local adapter surface. |
| `@harness-anything/adapter-multica` | Multica issue snapshot/adopt surface. |
| `@harness-anything/adapter-github-issues` | M4 placeholder slot for GitHub Issues integration. |
| `@harness-anything/adapter-linear` | M4 placeholder slot for Linear integration. |

## Documentation

- [M1 minimal loop](./docs-release/m1-minimal-loop.md)
- [M2 coding vertical](./docs-release/m2-coding-vertical.md)
- [M2.5 product line map](./docs-release/m2-5-product-line.md)
- [M2.5 GUI distribution and update](./docs-release/m2-5-gui-distribution.md)
- [M2.5 runtime and release readiness](./docs-release/m2-5-runtime-release.md)
- [M2.5 supply-chain and license gate](./docs-release/m2-5-supply-chain-license.md)
- [Harness agent skill](./docs-release/harness-agent-skill.md)
- [Minimal example project](./examples/minimal-project/)

Architecture decision records live in the private planning tree; the public
docs above cover the shipped and foundation contracts.

## Current release boundary

**Shipped in this repository:**

- Kernel, CLI, application layer, governance checks, behavior corpus, and
  Legacy Intake readiness evidence (M2).
- GUI/daemon foundation: service/API mappability, daemon API contract
  registry, terminal session registry, durable terminal backend policy, remote
  daemon tunnel policy, workspace shell model, and distribution/update policy
  (M2.5).
- Supply-chain/license release gate and runtime/release reproducibility
  (M2.5).

**Foundation, not product:**

- The GUI daemon contracts exist and are checked, but there is no complete
  desktop GUI product, signed installer, notarized build, or auto-update
  capability.

**Not shipped:**

- No npm package release. Packages remain `private: true` at `0.0.0`; any
  future release must include OSV evidence, license evidence, and release
  artifact SBOM evidence.
- GitHub Issues and Linear adapters remain M4 placeholders.

Expect breaking changes while the public package surface stabilizes. The full
local gate is `npm run check`.

## Roadmap

**M2 — coding vertical workflow** ✓

- [x] Kernel, CLI, package layout, governance checks, behavior corpus, and
  Legacy Intake readiness evidence.
- [x] Local smoke coverage for the Legacy Intake and private CLI package
  artifact.

**M2.5 — GUI/daemon foundation** ✓

- [x] Service/API mappability, daemon API contract registry, terminal session
  registry, durable terminal backend policy, remote daemon tunnel policy,
  workspace shell model, and distribution/update policy.
- [x] Product-line docs hardening.
- [x] Electron browser/preview security hardening.
- [x] Runtime/release reproducibility.
- [x] Supply-chain/license release gate.

**Next**

- [ ] Placeholder/dormant surface cleanup before claiming self-host migration
  readiness.
- [ ] M3 task hierarchy and relation semantics.
- [ ] M4 external adapter implementation after the kernel/CLI contract is
  stable.
- [ ] M5–M7 cross-harness product line, full GUI product surface, npm
  publication, and release hardening.

## Design principles

- **Semantics live in the kernel.** Edge layers — CLI, GUI, adapters — consume
  the domain model; they never redefine lifecycle, identity, or validation.
- **Contracts derive from one canonical source.** Command receipts, API
  registries, and schemas are generated or checked against a single authority,
  and governance checks fail when a surface drifts.
- **Authored state is truth; generated state is a cache.** Markdown task
  packages under Git are canonical; the SQLite projection is rebuildable and
  its integrity is verifiable.
- **Dormant code does not ship.** Placeholder surfaces are named as
  placeholders, and release gates require evidence — OSV, license, SBOM —
  before anything is published.

## Contributing

The most useful contributions right now are sharp bug reports, failing test
cases, architecture questions, and small documentation fixes. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

Before opening a pull request:

```bash
npm run check
```

Please keep public changes out of private harness state. Do not add
`.harness-private/`, root-local agent instructions, or private planning docs to
public commits.

## License

[AGPL-3.0-or-later](./LICENSE). Harness Anything keeps the task harness open,
including when someone offers it as a service.
