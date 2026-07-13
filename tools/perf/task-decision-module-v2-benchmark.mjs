import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { Effect } from "effect";
import {
  canonicalAuthorityRequestDigest,
  canonicalPayloadDigestV2,
  createAuthoritySubmissionService,
  createInMemoryAuthorityOperationRegistry,
  createInMemoryReplicaChangeLog,
  encodeTaskDecisionModuleCommandPayloadV2,
  makeTaskDecisionModuleSemanticCompilerV2,
  semanticMutationEnvelopeV2Schema,
  semanticMutationSetDigestV2,
  semanticRequestDigestV2
} from "../../packages/application/src/index.ts";
import {
  compileRegistryMutationPlan,
  createWritableEntityRegistry,
  entityRegistry,
  makeJournaledWriteCoordinator
} from "../../packages/kernel/src/index.ts";

const writerCounts = integerListOption("--writers", [2, 4, 8]);
const rounds = integerOption("--rounds", 10);
const groups = enumListOption("--groups", ["task-same-package", "decision-module-disjoint"], ["task-same-package", "decision-module-disjoint"]);
const workspaceId = "workspace-w3-perf";
const baseDigest = Buffer.alloc(32, 0x11);
const token = "w3-perf-token";
const channelNonceDigest = "sha256:w3-perf-channel";
const protocol = { wire: 1, event: 1, receipt: 1, digest: 1, commandRegistry: 1 };
const scenarios = [];

for (const group of groups) {
  for (const writers of writerCounts) scenarios.push(await runScenario(group, writers));
}

process.stdout.write(`${JSON.stringify({
  schema: "task-decision-module-v2-concurrency-benchmark/v1",
  measuredAt: new Date().toISOString(),
  sourceCommit: gitAt(process.cwd(), "rev-parse", "HEAD"),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  workload: "task append same package; decision propose + module register logically disjoint",
  rounds,
  scenarios
}, null, 2)}\n`);

async function runScenario(group, writers) {
  return withGit(group, writers, async ({ rootDir, env }) => {
    const queueWaitByOp = new Map();
    const submitStartedByOp = new Map();
    const service = authority(rootDir, env, queueWaitByOp, submitStartedByOp);
    const compiler = makeTaskDecisionModuleSemanticCompilerV2({
      state: {
        readEntityBase: async (entityRef) => entityRef.entityKind === "task"
          ? { semanticVersion: "task-v1", stateDigest: baseDigest }
          : null,
        readHostedDocument: async () => null
      }
    });
    const registry = createWritableEntityRegistry([entityRegistry.task, entityRegistry.decision, entityRegistry.module]);
    const samples = { endToEndMs: [], compilerMs: [], queueWaitMs: [], commitIndexMs: [] };
    for (let round = 0; round < rounds; round += 1) {
      const rows = await Promise.all(Array.from({ length: writers }, async (_, writer) => {
        const fixture = operationFixture(group, writers, round, writer);
        const started = performance.now();
        const compileStarted = performance.now();
        const semantic = await compiler.compile(fixture.envelope);
        const compiled = compileRegistryMutationPlan(registry, semantic.mutationPlan);
        const compilerMs = performance.now() - compileStarted;
        if (compiled.mutationSet.mutations.length !== 1 || compiled.storagePlan.targets.length !== 1) {
          throw new Error("W3 benchmark expected one mutation and one hosted target");
        }
        submitStartedByOp.set(fixture.opId, performance.now());
        const receipt = await service.submit(v1Envelope(fixture.opId, { ...semantic.operation, opId: fixture.opId }));
        const endToEndMs = performance.now() - started;
        if (receipt.tag !== "COMMITTED") throw new Error(`${fixture.opId} returned ${receipt.tag}`);
        const queueWaitMs = queueWaitByOp.get(fixture.opId);
        if (queueWaitMs === undefined) throw new Error(`queue wait missing for ${fixture.opId}`);
        return { endToEndMs, compilerMs, queueWaitMs, commitIndexMs: Math.max(0, endToEndMs - compilerMs - queueWaitMs) };
      }));
      for (const row of rows) for (const key of Object.keys(samples)) samples[key].push(row[key]);
    }
    return {
      group,
      writers,
      attempts: samples.endToEndMs.length,
      endToEndMs: summary(samples.endToEndMs),
      segments: {
        registryCompileSemanticDiffMs: summary(samples.compilerMs),
        coordinatorQueueWaitMs: summary(samples.queueWaitMs),
        commitIndexMs: summary(samples.commitIndexMs)
      }
    };
  });
}

function operationFixture(group, writers, round, writer) {
  const ordinal = round * writers + writer;
  const suffix = `${group}-n${writers}-r${round}-w${writer}`;
  let payloadValue;
  let baseCas;
  if (group === "task-same-package") {
    const taskId = `task_W3_SAME_N${writers}`;
    payloadValue = { schema: "task.append/v1", taskId, text: `W3 performance ${suffix}` };
    baseCas = [present("task", `task/${taskId}`)];
  } else if (writer % 2 === 0) {
    const decisionId = `dec_W3_${writers}_${ordinal}`;
    payloadValue = { schema: "decision.propose/v1", decision: decision(decisionId) };
    baseCas = [absent("decision", `decision/${decisionId}`)];
  } else {
    const moduleKey = `module-${writers}-${ordinal}`;
    payloadValue = {
      schema: "module.register/v1",
      module: { key: moduleKey, title: moduleKey, status: "active", scopes: [`packages/${moduleKey}/**`], steps: [] }
    };
    baseCas = [absent("module", `module/${moduleKey}`)];
  }
  const payload = encodeTaskDecisionModuleCommandPayloadV2(payloadValue);
  const mutationSet = { registryVersion: 1, mutations: [] };
  const draft = {
    schema: semanticMutationEnvelopeV2Schema,
    workspaceId,
    operationId: {
      namespace: {
        schema: "operation-namespace/v1", workspaceId, deviceId: "device-w3-perf", authorityGeneration: 1n,
        namespaceId: "namespace-w3-perf", expiresAt: 9_000n, issuer: "authority.perf", keyId: "namespace-key", proof: Buffer.alloc(32, 3)
      },
      clientRandom128: Buffer.from(fixedHex(ordinal + (group === "task-same-package" ? 1 : 1_000_000), 32), "hex")
    },
    binding: {
      bindingId: "binding-w3-perf", actorAxesBindingDigest: Buffer.alloc(32, 4), deviceId: "device-w3-perf",
      viewId: "view-w3-perf", sessionId: "session-w3-perf",
      admissionTokenRef: { tokenId: "token-w3-perf", tokenDigest: Buffer.alloc(32, 5) }
    },
    schemaTuple: {
      wire: 2, event: 2, receipt: 2, digest: 2, policy: 1,
      commandRegistry: 1, entityRegistry: 1, mutationRegistry: 1, localState: 1, applyJournal: 1
    },
    intent: {
      kind: "typed", command: { registryVersion: 1, name: payloadValue.schema.replace("/v1", ""), version: 1 },
      canonicalPayload: { kind: "inline", size: BigInt(payload.length), bytes: payload },
      canonicalPayloadDigest: canonicalPayloadDigestV2(payload), baseCas, declaredPathCas: []
    },
    claimedMutationSet: mutationSet,
    claimedSemanticMutationSetDigest: semanticMutationSetDigestV2(mutationSet),
    claimedSemanticRequestDigest: Buffer.alloc(32)
  };
  return { opId: `w3-perf-${suffix}`, envelope: { ...draft, claimedSemanticRequestDigest: semanticRequestDigestV2(draft) } };
}

function authority(rootDir, env, queueWaitByOp, submitStartedByOp) {
  return createAuthoritySubmissionService({
    workspaceId,
    coordinatorFactory: {
      create: ({ attribution }) => {
        const coordinator = makeJournaledWriteCoordinator({
          rootDir, attribution, commitAuthor: { name: "W3 Benchmark", email: "benchmark@example.test" }, autoMaterialize: false
        });
        return {
          enqueue: (operation) => Effect.gen(function* () {
            const started = submitStartedByOp.get(operation.opId);
            if (started === undefined) throw new Error(`submit start missing for ${operation.opId}`);
            queueWaitByOp.set(operation.opId, performance.now() - started);
            return yield* coordinator.enqueue(operation);
          }),
          flush: coordinator.flush,
          recover: coordinator.recover
        };
      }
    },
    tokenVerifier: {
      verify: async ({ token: presented }) => {
        if (presented !== token) throw new Error("invalid benchmark token");
        return {
          attribution: {
            actor: { principal: { kind: "person", personId: "person_zeyu" }, executor: { kind: "agent", id: "agent-w3-perf" } },
            principalSource: { kind: "daemon-authenticated", providerId: "w3-perf", credentialFingerprint: "sha256:redacted" },
            executorSource: "client-asserted"
          },
          claims: {
            tokenId: "token-w3-perf", issuer: "w3-perf", keyId: "key-w3-perf", workspaceId,
            deviceId: "device-w3-perf", viewId: "view-w3-perf", actorId: "person_zeyu", executorId: "agent-w3-perf",
            sessionId: "session-w3-perf", authorityGeneration: 1, channelNonceDigest, protocol,
            commandScopes: ["repo.document.write"], pathScopes: ["harness/**"], maxBytes: 128 * 1024, maxOps: 1,
            issuedAt: "2026-07-14T00:00:00.000Z", notBefore: "2026-07-14T00:00:00.000Z",
            expiresAt: "2026-07-15T00:00:00.000Z", revocationEpoch: 1
          }
        };
      }
    },
    operationRegistry: createInMemoryAuthorityOperationRegistry(),
    replicaChangeLog: createInMemoryReplicaChangeLog(),
    publicationInspector: {
      currentHead: async () => gitOptional(rootDir, env, "rev-parse", "--verify", "HEAD"),
      inspectPublishedHead: async () => {
        const row = git(rootDir, env, "rev-list", "--parents", "-n", "1", "HEAD").split(" ");
        return { commitSha: row[0], parentCommits: row.slice(1) };
      }
    },
    fenceWitness: { assertHeld: async () => undefined },
    now: () => "2026-07-14T00:00:00.000Z"
  });
}

function v1Envelope(opId, operation) {
  const envelope = { workspaceId, opId, claimedDigest: "pending", command: "repo.document.write", operation, delegationToken: token, channelNonceDigest, protocol };
  return { ...envelope, claimedDigest: canonicalAuthorityRequestDigest(envelope) };
}

async function withGit(group, writers, body) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-w3-perf-"));
  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "W3 Benchmark", GIT_AUTHOR_EMAIL: "benchmark@example.test",
    GIT_COMMITTER_NAME: "Harness Authority", GIT_COMMITTER_EMAIL: "authority@example.test"
  };
  try {
    execFileSync("git", ["-C", rootDir, "init", "-q"], { env });
    writeFileSync(path.join(rootDir, ".gitignore"), "/harness/\n/.harness/\n", "utf8");
    const harnessRoot = path.join(rootDir, "harness");
    mkdirSync(harnessRoot, { recursive: true });
    execFileSync("git", ["-C", harnessRoot, "init", "-q"], { env });
    if (group === "task-same-package") {
      const taskRoot = path.join(harnessRoot, "tasks", `task_W3_SAME_N${writers}`);
      mkdirSync(taskRoot, { recursive: true });
      writeFileSync(path.join(taskRoot, "INDEX.md"), taskIndex(`task_W3_SAME_N${writers}`), "utf8");
    }
    execFileSync("git", ["-C", harnessRoot, "add", "."], { env });
    execFileSync("git", ["-C", harnessRoot, "commit", "--allow-empty", "-m", "test: initialize W3 benchmark"], { env });
    return await body({ rootDir, env });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function decision(id) {
  return {
    schema: "decision-package/v1", decision_id: id, title: id, state: "proposed", riskTier: "medium", urgency: "medium",
    vertical: "software/coding", preset: "architecture-decision", applies_to: { modules: [], productLines: [] },
    proposedAt: "2026-07-14T00:00:00.000Z",
    provenance: [{ runtime: "codex", sessionId: "session-w3-perf", boundAt: "2026-07-14T00:00:00.000Z" }],
    question: `Publish ${id}?`, chosen: [{ id: "CH1", text: "Yes." }],
    rejected: [{ id: "RJ1", text: "No.", why_not: "Benchmark positive path." }],
    claims: [{ id: "C1", text: "The benchmark request is typed." }], relations: []
  };
}

function taskIndex(taskId) {
  return [
    "---", "schema: task-package/v2", `task_id: ${taskId}`, `title: ${taskId}`,
    "lifecycle:", "  bindingSchema: lifecycle-binding/v1", "  engine: local", "  status: active", "  ref: ",
    `  titleSnapshot: ${taskId}`, "  url: ", "  bindingCreatedAt: 2026-07-14T00:00:00.000Z",
    `  bindingFingerprint: sha256:${"b".repeat(64)}`, "packageDisposition: active", "vertical: default", "preset: default",
    "provenance:", "  - {runtime: codex, sessionId: session-w3-perf, boundAt: 2026-07-14T00:00:00.000Z}", "---", "", `# ${taskId}`, ""
  ].join("\n");
}

function present(entityKind, canonicalRef) {
  return { entityRef: { registryVersion: 1, entityKind, canonicalRef }, expectedSemanticVersion: "task-v1", expectedStateDigest: baseDigest };
}

function absent(entityKind, canonicalRef) {
  return { entityRef: { registryVersion: 1, entityKind, canonicalRef }, expectedSemanticVersion: null, expectedStateDigest: null };
}

function summary(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return { p50Ms: round(percentile(sorted, 0.5)), p95Ms: round(percentile(sorted, 0.95)), maxMs: round(sorted.at(-1) ?? 0), samplesMs: values.map(round) };
}

function percentile(sorted, quantile) {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
}

function round(value) { return Math.round(value * 100) / 100; }
function fixedHex(value, length) { return value.toString(16).padStart(length, "0").slice(-length); }
function integerOption(name, fallback) { const i = process.argv.indexOf(name); if (i < 0) return fallback; const value = Number(process.argv[i + 1]); if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} invalid`); return value; }
function integerListOption(name, fallback) { const i = process.argv.indexOf(name); if (i < 0) return fallback; const values = String(process.argv[i + 1]).split(",").map(Number); if (values.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error(`${name} invalid`); return values; }
function enumListOption(name, allowed, fallback) { const i = process.argv.indexOf(name); if (i < 0) return fallback; const values = String(process.argv[i + 1]).split(","); if (values.some((value) => !allowed.includes(value))) throw new Error(`${name} invalid`); return [...new Set(values)]; }
function git(rootDir, env, ...args) { return execFileSync("git", ["-C", path.join(rootDir, "harness"), ...args], { encoding: "utf8", env }).trim(); }
function gitOptional(rootDir, env, ...args) { try { return git(rootDir, env, ...args); } catch { return null; } }
function gitAt(cwd, ...args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim(); }
