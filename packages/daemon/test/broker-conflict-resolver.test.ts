// harness-test-tier: integration
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BrokerSubmissionCoordinator,
  BrokerSubmitPreflightError,
  ReplicaBroker,
  ResolverAgent,
  fingerprintBytes,
  type AuthoritySubmissionClient,
  type LocalConflictEvent
} from "../src/index.ts";
import {
  authorityProtocolTuple,
  type AuthorityOperationEnvelope
} from "../../application/src/index.ts";
import { taskEntityId } from "../../kernel/src/index.ts";
import { appendSnapshot, createBrokerFixture } from "./broker-test-fixture.ts";

test("authority rejection returns the pinned local generation to conflict storage before resolver preview", async () => {
  const fixture = createBrokerFixture();
  try {
    await appendSnapshot(fixture, 1, { "tasks/a.md": "base\n" });
    const broker = new ReplicaBroker({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      viewRoot: fixture.viewRoot,
      stateRoot: fixture.stateRoot,
      replicaChangeLog: fixture.changeLog,
      snapshotSource: fixture.snapshotSource
    });
    await broker.synchronize();
    writeFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "rejected-local\n");
    await broker.recordLocalChange("tasks/a.md");
    const events: LocalConflictEvent[] = [];
    broker.conflicts.onConflict((event) => { events.push(event); });
    let submitCalls = 0;
    const authority: AuthoritySubmissionClient = {
      submit: async (envelope) => {
        submitCalls += 1;
        return {
          tag: "REJECTED",
          workspaceId: envelope.workspaceId,
          opId: envelope.opId,
          semanticDigest: envelope.claimedDigest,
          reason: "ADMISSION_REJECTED:BASE_CONFLICT"
        };
      },
      getOperation: async () => undefined
    };
    const coordinator = new BrokerSubmissionCoordinator({ broker, authority });
    const envelope = operationEnvelope("submit-1", "rejected-local\n");

    const result = await coordinator.submitAuthored("tasks/a.md", envelope);

    assert.equal(result.receipt.tag, "REJECTED");
    assert.ok(result.conflictId);
    assert.equal(submitCalls, 1);
    assert.equal(events.length, 1);
    assert.equal(readFileSync(path.join(events[0]!.directory, "ours"), "utf8"), "rejected-local\n");
    assert.equal(broker.pathState("tasks/a.md")?.status, "CONFLICT");
    await assert.rejects(
      coordinator.submitAuthored("tasks/a.md", operationEnvelope("submit-2", "rejected-local\n")),
      (error: unknown) => error instanceof BrokerSubmitPreflightError
    );
    assert.equal(submitCalls, 1, "conflict preflight must reject before authority submit");

    const resolver = new ResolverAgent({ stateRoot: fixture.stateRoot });
    const preview = await resolver.consume(events[0]!);
    assert.equal(preview.status, "CONFIRMATION_REQUIRED");
    assert.equal(preview.strategy, "OURS");
    await assert.rejects(resolver.confirm(preview.previewId, "wrong-token"), /token mismatch/u);
    assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "utf8"), "rejected-local\n");
  } finally {
    fixture.cleanup();
  }
});

test("resolver refuses unilateral BLOCKED_DECISION resolution", async () => {
  const fixture = createBrokerFixture();
  try {
    const broker = new ReplicaBroker({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      viewRoot: fixture.viewRoot,
      stateRoot: fixture.stateRoot,
      replicaChangeLog: fixture.changeLog,
      snapshotSource: fixture.snapshotSource
    });
    await broker.initialize();
    const event = await broker.conflicts.create({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      path: "decisions/blocked.md",
      reason: "BLOCKED_DECISION",
      baseVersion: null,
      theirsVersion: null,
      oursFingerprint: fingerprintBytes(Buffer.from("candidate\n")),
      ours: Buffer.from("candidate\n")
    });
    const resolver = new ResolverAgent({ stateRoot: fixture.stateRoot });

    const preview = await resolver.consume(event);

    assert.equal(preview.status, "MANUAL_ARBITRATION_REQUIRED");
    assert.equal(preview.strategy, "BLOCKED_DECISION");
    assert.equal(preview.confirmationToken, null);
    await assert.rejects(resolver.confirm(preview.previewId, "anything"), /manual arbitration/u);
  } finally {
    fixture.cleanup();
  }
});

test("unknown transport outcome is reconciled by GetOperation before creating a rejection conflict", async () => {
  const fixture = createBrokerFixture();
  try {
    await appendSnapshot(fixture, 1, { "tasks/a.md": "base\n" });
    const broker = new ReplicaBroker({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      viewRoot: fixture.viewRoot,
      stateRoot: fixture.stateRoot,
      replicaChangeLog: fixture.changeLog,
      snapshotSource: fixture.snapshotSource
    });
    await broker.synchronize();
    writeFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "unknown-local\n");
    await broker.recordLocalChange("tasks/a.md");
    const envelope = operationEnvelope("unknown-1", "unknown-local\n");
    const authority: AuthoritySubmissionClient = {
      submit: async () => { throw new Error("connection dropped after send"); },
      getOperation: async () => ({
        workspaceId: envelope.workspaceId,
        opId: envelope.opId,
        semanticDigest: envelope.claimedDigest,
        state: "REJECTED",
        receipt: {
          tag: "REJECTED",
          workspaceId: envelope.workspaceId,
          opId: envelope.opId,
          semanticDigest: envelope.claimedDigest,
          reason: "ADMISSION_REJECTED:BASE_CONFLICT"
        }
      })
    };
    const coordinator = new BrokerSubmissionCoordinator({ broker, authority });
    await assert.rejects(coordinator.submitAuthored("tasks/a.md", envelope), /connection dropped/u);
    assert.equal(broker.pathState("tasks/a.md")?.status, "PENDING_UNKNOWN");

    const reconciled = await coordinator.reconcileUnknown("tasks/a.md", envelope.opId);

    assert.equal(reconciled?.receipt.tag, "REJECTED");
    assert.ok(reconciled?.conflictId);
    assert.equal(broker.pathState("tasks/a.md")?.status, "CONFLICT");
  } finally {
    fixture.cleanup();
  }
});

function operationEnvelope(opId: string, body: string): AuthorityOperationEnvelope {
  return {
    workspaceId: "workspace-tw03",
    opId,
    claimedDigest: `digest:${opId}`,
    command: "repo.document.write",
    operation: {
      opId,
      entityId: taskEntityId("task-tw03"),
      kind: "doc_write",
      payload: { path: "tasks/a.md", body }
    },
    delegationToken: "opaque-test-token",
    channelNonceDigest: "channel-test",
    protocol: authorityProtocolTuple
  };
}
