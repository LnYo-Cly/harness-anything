<div align="center">

# Harness Anything

**面向长周期软件工作的 Agent 任务 Harness。**

<p>
  <a href="#架构概览">架构概览</a> ·
  <a href="#核心概念">核心概念</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#命令参考">命令参考</a> ·
  <a href="#文档">文档</a> ·
  <a href="#贡献">贡献</a>
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

Harness Anything 为 coding agent 提供一层持久的任务结构：本地任务包（task
package）、治理检查、迁移证据，以及一个足够小的 kernel（内核）。CLI、GUI 和
adapter（适配器）都可以构建在它之上，但不拥有生命周期状态。

Agent 越来越擅长改代码，但它们仍然需要一种可靠方式来跨长会话承载工作、拆分任
务、保留 review 证据，并证明本地状态没有偏离仓库。Harness Anything 把这层操作
层变成一等的、可检查的工程制品。

## 这是什么

- 一个 local-first 的 coding-agent 任务 harness。
- 一个 TypeScript monorepo，包含 kernel、CLI、GUI、application 和 adapter 包。
- 一套治理表面，用于检查任务包、文件复杂度、import 边界、private/public 边界、
  schema 契约和 Legacy Intake readiness。
- 一道供应链发布门槛：高危 npm advisory 检查、CycloneDX SBOM 生成、OSV
  readiness、license 策略，以及 AGPL 网络服务发布说明清单，全部在任何东西被
  允许发布之前运行。
- 一个面向公开 Harness 产品表面的 clean-room rewrite workspace。

## 这不是什么

- 不是 agent runtime、model router 或 chat UI。
- 不是 Git、GitHub 或 CI 的替代品。
- 不是云端任务数据库。
- 还不是已发布的 npm release。所有 workspace 包保持 `private: true`、版本
  `0.0.0`；发布被 OSV、license 和 SBOM 证据门槛拦住。

## 架构概览

Kernel 是唯一的语义权威。它拥有领域模型——任务身份、六态 lifecycle（生命周
期）、外部 binding（绑定）、包处置、closeout readiness——以及所有其他部分消
费的 schema 和存储端口。生命周期转换只在一个地方校验；任何边缘层都不会重新定
义什么叫 "done"。

Kernel 之外的一切都是消费方。CLI 解析命令并渲染回执，GUI foundation 映射
daemon/API 契约，application 层把 controller/service 编排隔离在 UI 代码之外，
adapter 在边界上收集或发布证据。契约——命令回执、API 注册表、schema 定义——
从单一权威源派生，而不是每个表面各自声明一份；治理检查负责保证这种派生关系不
被破坏。

Authored 状态是 Git 里的纯 markdown；generated 状态是可重建的本地缓存。
markdown 任务包是事实来源，SQLite 投影从它派生，检查随时可以证明两者是否一致。

| 层 | 作用 | 当前状态 |
| --- | --- | --- |
| **Kernel** | 拥有领域类型、六态 lifecycle、schema、任务投影、生命周期校验和存储端口。 | 已在 `@harness-anything/kernel` 中实现。 |
| **CLI** | 暴露 init、doctor、status、check、任务操作、preset、module、迁移证据和 Git diff 证据等本地命令。 | 已在 `@harness-anything/cli` 中实现。 |
| **Application layer** | 将 controller/service 编排从 UI 和 adapter 代码中隔离出来。 | 已在 `@harness-anything/application` 中实现。 |
| **GUI foundation** | 提供 Electron 桌面壳、daemon/API 契约、终端/会话策略、workspace shell 模型和分发/更新策略边界。 | M2.5 GUI/daemon foundation 位于 `@harness-anything/gui`；不是完整的 GUI 产品。 |
| **Adapters** | 连接外部系统，但不接管 harness 状态。 | Local 和 Multica 表面已存在；GitHub Issues 和 Linear 包是明确的 M4 占位。 |

## 核心概念

- **Task package（任务包）。** 位于 `harness/planning/tasks/` 下的 markdown
  包，身份是随机的 `task_<ULID>`。它是一个工作单元的事实来源；slug 和标题只是
  展示元数据，不是身份。
- **Evidence（证据）。** 附加在任务进度、review 和完成记录上的类型化指针
  （`type:path:summary`），另有面向 Git diff 和 legacy 迁移的专用证据命令。
  证据靠记录，不靠推断。
- **Binding（绑定）。** 任务与外部引擎引用之间的一条带指纹的链接。核心绑定字
  段创建后不可变，因此篡改外部链接是可检测的。
- **Lifecycle（生命周期）。** 六个状态：`planned`、`active`、`blocked`、
  `in_review`、`done`、`cancelled`。`done` 和 `cancelled` 是终态；后续工作走
  supersede，不走 reopen。归档和 tombstone 是包处置，不是额外的状态。
- **Vertical 与 preset。** Vertical（如 `software/coding`）定义任务领域和它
  的契约；preset（如 `standard-task`）在其上叠加具体用例的工作流选择——模
  板、检查、动作。
- **Module（模块）。** 项目里一块注册过的切片（key、标题、源码 scope），任务
  可以指向它，让多模块工作保持可过滤、可限定范围。

## 快速开始

使用 Node.js 24 或更高版本。

```bash
npm ci
npm run check
```

`npm run check` 是完整的本地 gate：typecheck、测试、治理检查、package smoke 和
供应链检查。`rewrite-ci` workflow 在 Node 24 和 Node 26 上运行同样的公开 gate。

开发期间 CLI 直接从源码运行（依赖 Node 内建的 TypeScript 执行）。先确认环境：

```bash
node packages/cli/src/index.ts doctor --json
```

最小项目循环：

```bash
node packages/cli/src/index.ts --root /path/to/project init --json
node packages/cli/src/index.ts --root /path/to/project new-task --title "First task" --json
node packages/cli/src/index.ts --root /path/to/project status --json
node packages/cli/src/index.ts --root /path/to/project check --post-merge --json
```

coding-agent 工作通过 coding vertical 和 preset 表面创建任务，再经由
review/CI gate 关闭：

```bash
node packages/cli/src/index.ts --root /path/to/project new-task --title "Implement slice" --vertical software/coding --preset standard-task --json
node packages/cli/src/index.ts --root /path/to/project task-complete <task-id> --ci passed --reviewer <reviewer-id>
```

未完成的旧任务状态只作为 Legacy Intake 证据处理。把它带着 provenance 重建成新
的 Harness 任务，不承诺自动批量转换：

```bash
node packages/cli/src/index.ts --root /path/to/project new-task --from-legacy <legacy-id> --json
```

## 命令参考

CLI 命令是 `harness-anything`，短别名 `ha`。它暴露 50+ 个命令，分为以下命令
族；所有命令都支持 `--json` 回执。

| 命令族 | 覆盖范围 | 示例 |
| --- | --- | --- |
| 项目初始化 | 初始化 harness 目录结构；只读环境诊断。 | `harness-anything init --name my-project` |
| 任务创建 | 创建任务包，可经由 vertical、preset、module 或 legacy 证据。 | `harness-anything new-task --title "Implement slice" --vertical software/coding --preset standard-task` |
| 任务生命周期 | 状态转换、带证据的进度、归档、supersede、删除、reopen。 | `harness-anything task status set task_01ABC active --reason "work started"` |
| 任务门槛 | 与 reviewer 和 CI 结果绑定的 review 与完成 gate。 | `harness-anything task-complete task_01ABC --ci passed --reviewer reviewer-id` |
| 查询与检查 | 带过滤器的任务列表、harness 状态、治理健康检查、lesson 提炼。 | `harness-anything check --post-merge --json` |
| 迁移与 Legacy Intake | 扫描、规划、索引和校验 legacy 状态；采纳外部 Multica 快照。 | `harness-anything legacy verify --json` |
| 证据与诊断 | 针对 base ref 的 Git diff 证据；doctor。 | `harness-anything git-diff --base origin/main --json` |
| 扩展表面 | 模板、preset、module、vertical 校验和 GUI 启动器。 | `harness-anything preset list --json` |

完整的命令表面、回执和检查 profile 见
[M2 coding vertical](./docs-release/m2-coding-vertical.md)。

## 包结构

这个仓库是单一 Git monorepo。`packages/` 下的包是 npm workspace package，不是
嵌套 Git 仓库。所有 workspace 包均为 `private: true`、版本 `0.0.0`，没有任何
包发布到 npm。

| Package | 用途 |
| --- | --- |
| `@harness-anything/kernel` | 领域模型、六态 lifecycle、schema、任务投影和存储端口。 |
| `@harness-anything/cli` | 面向 project、task、preset、module、migration、evidence 和 check 工作流的本地命令表面。 |
| `@harness-anything/application` | CLI 和 GUI 共享的 controller/service 层。 |
| `@harness-anything/gui` | Electron GUI foundation、daemon/API 契约和 renderer 边界。 |
| `@harness-anything/adapter-local` | 本地 adapter 表面。 |
| `@harness-anything/adapter-multica` | Multica issue 快照/采纳表面。 |
| `@harness-anything/adapter-github-issues` | GitHub Issues 集成的 M4 占位包。 |
| `@harness-anything/adapter-linear` | Linear 集成的 M4 占位包。 |

## 文档

- [M1 minimal loop](./docs-release/m1-minimal-loop.md)
- [M2 coding vertical](./docs-release/m2-coding-vertical.md)
- [M2.5 product line map](./docs-release/m2-5-product-line.md)
- [M2.5 GUI distribution and update](./docs-release/m2-5-gui-distribution.md)
- [M2.5 runtime and release readiness](./docs-release/m2-5-runtime-release.md)
- [M2.5 supply-chain and license gate](./docs-release/m2-5-supply-chain-license.md)
- [Harness agent skill](./docs-release/harness-agent-skill.md)
- [Minimal example project](./examples/minimal-project/)

架构决策记录位于私有规划树中；上述公开文档覆盖已交付与 foundation 层面的契约。

## 当前发布边界

**本仓库已交付：**

- Kernel、CLI、application 层、治理检查、behavior corpus 和 Legacy Intake
  readiness 证据（M2）。
- GUI/daemon foundation：service/API mappability、daemon API 契约注册表、终
  端会话注册表、durable terminal backend 策略、远程 daemon tunnel 策略、
  workspace shell 模型和分发/更新策略（M2.5）。
- 供应链/license 发布门槛与运行时/发布可复现性（M2.5）。

**是 foundation，不是成品：**

- GUI daemon 契约已存在且被检查覆盖，但还没有完整的桌面 GUI 产品、签名安装
  器、公证构建或自动更新能力。

**尚未交付：**

- 没有 npm 包发布。所有包保持 `private: true`、`0.0.0`；未来任何发布都必须附
  带 OSV 证据、license 证据和发布制品 SBOM 证据。
- GitHub Issues 和 Linear adapter 仍是 M4 占位。

在公开 package surface 稳定前，请预期 breaking changes。完整本地 gate 是
`npm run check`。

## Roadmap

**M2 — coding vertical workflow** ✓

- [x] Kernel、CLI、package layout、治理检查、behavior corpus 和 Legacy Intake
  readiness 证据。
- [x] Legacy Intake 和 private CLI package artifact 的本地 smoke 覆盖。

**M2.5 — GUI/daemon foundation** ✓

- [x] Service/API mappability、daemon API 契约注册表、终端会话注册表、
  durable terminal backend 策略、远程 daemon tunnel 策略、workspace shell 模
  型和分发/更新策略。
- [x] 产品线文档硬化。
- [x] Electron browser/preview 安全硬化。
- [x] 运行时/发布可复现性。
- [x] 供应链/license 发布门槛。

**接下来**

- [ ] 清理占位/休眠表面，之后才声明 self-host 迁移就绪。
- [ ] M3 任务层级与关系语义。
- [ ] M4 在 kernel/CLI 契约稳定后实现外部 adapter。
- [ ] M5–M7 跨 harness 产品线、完整 GUI 产品表面、npm 发布与发布硬化。

## 设计原则

- **语义只住在 kernel 里。** 边缘层——CLI、GUI、adapter——消费领域模型，从
  不重新定义 lifecycle、身份或校验规则。
- **契约从单一权威源派生。** 命令回执、API 注册表和 schema 只对齐一个权威
  源；任何表面漂移都会被治理检查拦下。
- **Authored 状态是真相，generated 状态是缓存。** Git 里的 markdown 任务包是
  规范来源；SQLite 投影可重建，其完整性可验证。
- **休眠代码不发布。** 占位表面明确标注为占位；发布门槛要求证据——OSV、
  license、SBOM——任何东西发布之前都要过这一关。

## 贡献

当前最有价值的贡献是尖锐的 bug report、可复现的失败测试、架构问题和小型文档修
正。参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

提交 pull request 前：

```bash
npm run check
```

请不要把 private harness state 放入公开变更。不要把 `.harness-private/`、
root-local agent instructions 或 private planning docs 加入 public commit。

## License

[AGPL-3.0-or-later](./LICENSE)。Harness Anything 保持任务 harness 开源，包括
有人将它作为服务提供时。
