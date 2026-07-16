// harness-test-tier: integration
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  createAuthorityKeyRegistryV1,
  isCompleteAuthorityCommittedReceiptV2
} from "../../application/src/index.ts";
import {
  channelDigest32,
  connectionGeneration,
  openLocalAuthorityKeyStore
} from "../../daemon/src/index.ts";
import { taskEntityId, type WriteOp } from "../../kernel/src/index.ts";
import { daemonActorAttribution } from "../src/composition/actor-attribution.ts";
import {
  authorityNamespaceProofBytes,
  loadAuthorityProductionManifest
} from "../src/daemon/authority-production-state.ts";
import { createProductionAuthorityLifecycle } from "../src/daemon/production-authority-lifecycle.ts";

test("production lifecycle uses external Ed25519 material, durable state, live context and the X V2 event log", async () => {
  const fixture = createFixture();
  try {
    const lifecycle = createProductionAuthorityLifecycle({ manifestPath: fixture.manifestPath });
    const started = await lifecycle.startRepo(
      { repoId: "canonical", canonicalRoot: fixture.repoRoot },
      writerRuntime(fixture.authoredRoot)
    );
    assert.equal(started.ok, true, started.ok ? "" : started.error);
    if (!started.ok) return;
    const actor = {
      personId: "person_alice",
      displayName: "Alice",
      primaryEmail: "alice@example.test",
      providerId: "transport-derived/v1",
      resolvedCredential: {
        kind: "unix-socket-owner-boundary" as const,
        issuer: `host:${hostname()}`,
        subject: String(process.getuid?.() ?? 0)
      }
    };
    const submission = started.component.bindConnection({
      schema: "authority-connection-context/v1",
      connectionId: "production-connection",
      connectionGeneration: connectionGeneration("production-generation"),
      actor,
      repoId: "canonical",
      channelBinding: { digest: channelDigest32(Buffer.alloc(32, 0x51)), source: "transport-observed" },
      peerCredential: {
        schema: "os-observed-peer-credential/v1",
        platform: "darwin",
        source: "getpeereid",
        uid: process.getuid?.() ?? 0,
        gid: process.getgid?.() ?? 0
      }
    });
    const receipt = await submission.submit({
      command: {
        rootDir: fixture.repoRoot,
        json: true,
        action: { kind: "progress-append", taskId: "task_A", text: "production authority path\n" }
      },
      attribution: daemonActorAttribution(actor, { kind: "agent", id: "codex" }),
      currentSession: {
        runtime: "codex",
        sessionId: "session-production",
        source: "manual",
        detectedAt: new Date().toISOString()
      },
      canonicalEntityId: taskEntityId("task_A")
    });

    assert.equal(receipt.tag, "COMMITTED", JSON.stringify(receipt));
    if (receipt.tag === "COMMITTED") assert.equal(isCompleteAuthorityCommittedReceiptV2(receipt), true);
    assert.match(readFileSync(path.join(fixture.authoredRoot, "tasks/task_A/progress.md"), "utf8"), /production authority path/u);
    const eventFiles = execFileSync("find", [path.join(fixture.authoredRoot, "authority-attribution-events/v2"), "-type", "f"], { encoding: "utf8" })
      .trim().split("\n").filter(Boolean);
    assert.equal(eventFiles.length, 1);
    const eventBody = readFileSync(eventFiles[0]!, "utf8");
    assert.match(eventBody, /attribution-event\/v2/u);
    assert.doesNotMatch(eventBody, /PRIVATE KEY/u);
    assert.equal(readFileSync(path.join(fixture.serviceRoot, "authority/Y2Fub25pY2Fs/bindings.jsonl"), "utf8").includes("token:"), true);
    await lifecycle.stopAll("daemon-shutdown");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("production manifest rejects service state that overlaps the canonical repository", () => {
  const fixture = createFixture();
  try {
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as Record<string, unknown>;
    manifest.serviceStateRoot = path.join(fixture.repoRoot, "service-state");
    writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => loadAuthorityProductionManifest(fixture.manifestPath),
      /AUTHORITY_PRODUCTION_SERVICE_STATE_MUST_BE_EXTERNAL/u
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createFixture(): {
  readonly root: string;
  readonly repoRoot: string;
  readonly authoredRoot: string;
  readonly serviceRoot: string;
  readonly manifestPath: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "ha-production-authority-"));
  const repoRoot = path.join(root, "repo");
  const authoredRoot = path.join(repoRoot, "harness");
  const serviceRoot = path.join(root, "service-state");
  const keyStateDirectory = path.join(serviceRoot, "keys/canonical");
  mkdirSync(path.join(authoredRoot, "tasks/task_A"), { recursive: true });
  mkdirSync(serviceRoot, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(authoredRoot, "tasks/task_A/INDEX.md"), "---\ntask_id: task_A\nstatus: active\n---\n");
  writeFileSync(path.join(authoredRoot, "people.yaml"), [
    "schema: harness-people/v1",
    "people:",
    "  - personId: person_alice",
    "    displayName: Alice",
    "    primaryEmail: alice@example.test",
    "    roles: [owner]",
    "    credentials:",
    "      - kind: unix-socket-owner-boundary",
    `        issuer: host:${hostname()}`,
    `        subject: ${process.getuid?.() ?? 0}`,
    "roles:",
    "  - roleId: owner",
    "    commandClasses: [admin, repo-write, repo-read, arbiter]",
    ""
  ].join("\n"));
  const keyStore = openLocalAuthorityKeyStore({
    serviceStateRoot: serviceRoot,
    stateDirectory: keyStateDirectory,
    workspaceRoot: repoRoot,
    authorityId: "authority.production",
    issuer: "authority.production"
  });
  const now = Date.now();
  const prepublished = keyStore.createPrepublishedKey({ generation: 1, nowMs: now - 1_000 });
  const registry = createAuthorityKeyRegistryV1({
    authorityId: "authority.production",
    generation: 1,
    globalRevocationEpoch: 1,
    revision: 1,
    entries: [{ ...prepublished, state: "ACTIVE_SIGNING" }]
  });
  const registryPath = path.join(authoredRoot, "authority-key-registry.json");
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  const unsignedNamespace = {
    schema: "operation-namespace/v1" as const,
    workspaceId: "workspace-production",
    deviceId: "device-production",
    authorityGeneration: 1n,
    namespaceId: "namespace-production",
    expiresAt: BigInt(now + 60 * 60_000),
    issuer: "authority.production",
    keyId: prepublished.keyId
  };
  const proof = sign(
    null,
    authorityNamespaceProofBytes(unsignedNamespace),
    keyStore.signingProfile(registry, now).privateKey
  );
  const manifestPath = path.join(serviceRoot, "authority-production.json");
  writeFileSync(manifestPath, `${JSON.stringify({
    schema: "authority-production-composition/v1",
    serviceStateRoot: serviceRoot,
    repos: [{
      repoId: "canonical",
      canonicalRoot: repoRoot,
      workspaceId: "workspace-production",
      deviceId: "device-production",
      viewId: "view-production",
      sessionId: "session-production",
      authorityId: "authority.production",
      issuer: "authority.production",
      keyRegistryPath: registryPath,
      keyStateDirectory,
      schemaTuple: {
        wire: 2, event: 2, receipt: 2, digest: 2, policy: 2,
        commandRegistry: 1, entityRegistry: 1, mutationRegistry: 1,
        localState: 1, applyJournal: 1
      },
      authorityGeneration: 1,
      revocationEpochs: {
        global: "1", workspace: "1", device: "1", view: "1", principal: "1", executor: "1"
      },
      admissionTokenRef: "admission-production",
      allowedExecutorAgentIds: ["codex"],
      operationNamespace: {
        ...unsignedNamespace,
        authorityGeneration: unsignedNamespace.authorityGeneration.toString(),
        expiresAt: unsignedNamespace.expiresAt.toString(),
        proof: proof.toString("base64url")
      }
    }]
  }, null, 2)}\n`);
  git(authoredRoot, "init", "-q");
  git(authoredRoot, "add", ".");
  git(authoredRoot, "commit", "-q", "-m", "seed authority fixture");
  return { root, repoRoot, authoredRoot, serviceRoot, manifestPath };
}

function writerRuntime(authoredRoot: string) {
  return {
    createAttributedCoordinator: () => {
      let pending: WriteOp | undefined;
      return {
        enqueue: (operation: WriteOp) => Effect.sync(() => {
          pending = operation;
          return { opId: operation.opId, entityId: operation.entityId, accepted: true as const };
        }),
        flush: (reason: "debounce" | "count" | "explicit" | "shutdown" | "recovery") => Effect.sync(() => {
          if (!pending) return { reason, opCount: 0, committed: false };
          const payload = pending.payload as { readonly append: string };
          const progressPath = path.join(authoredRoot, "tasks/task_A/progress.md");
          writeFileSync(progressPath, payload.append, { flag: "a" });
          git(authoredRoot, "add", "tasks/task_A/progress.md");
          git(authoredRoot, "commit", "-q", "-m", "append progress through authority");
          return { reason, opCount: 1, committed: true, watermark: git(authoredRoot, "rev-parse", "HEAD") };
        }),
        recover: Effect.succeed({ replayedOps: 0 })
      };
    },
    assertWriteFenceHeld: async () => undefined
  };
}

function git(rootDir: string, ...args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-C", rootDir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "ZeyuLi",
      GIT_AUTHOR_EMAIL: "33339424+FairladyZ625@users.noreply.github.com",
      GIT_COMMITTER_NAME: "ZeyuLi",
      GIT_COMMITTER_EMAIL: "33339424+FairladyZ625@users.noreply.github.com"
    },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
