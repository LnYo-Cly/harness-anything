// harness-test-tier: integration
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ReplicaBroker,
  ResolverAgent,
  type BrokerCrashPoint,
  type LocalConflictEvent
} from "../src/index.ts";
import { appendSnapshot, createBrokerFixture } from "./broker-test-fixture.ts";

test("ReplicaChangeLog snapshots materialize an ordinary folder with separate contiguous cursors", async () => {
  const fixture = createBrokerFixture();
  try {
    await appendSnapshot(fixture, 1, {
      "tasks/a.md": "a1\n",
      "tasks/b.md": "b1\n"
    });
    const releases: string[] = [];
    const broker = new ReplicaBroker({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      viewRoot: fixture.viewRoot,
      stateRoot: fixture.stateRoot,
      replicaChangeLog: fixture.changeLog,
      snapshotSource: fixture.snapshotSource,
      writerExclusion: {
        acquire: async (paths) => ({ release: async () => { releases.push(paths.join(",")); } })
      },
      watcherFence: {
        fence: async () => ({ harness: "fence-1", guards: "fence-2" })
      }
    });

    const state = await broker.synchronize();

    assert.equal(state.receivedCursor, 1);
    assert.equal(state.resolvedCursor, 1);
    assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "utf8"), "a1\n");
    assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/b.md"), "utf8"), "b1\n");
    assert.equal(existsSync(path.join(fixture.viewRoot, ".git")), false);
    const barrier = await broker.barrier({ fresh: true });
    assert.equal(barrier.tag, "SATISFIED_EXACT_AT_CUT");
    if (barrier.tag === "SATISFIED_EXACT_AT_CUT") {
      assert.equal(barrier.witness.revision, 1);
      assert.deepEqual(barrier.witness.watcherFenceVector, { harness: "fence-1", guards: "fence-2" });
    }
    assert.deepEqual(releases, ["tasks/a.md,tasks/b.md"]);
  } finally {
    fixture.cleanup();
  }
});

test("dirty same-path conflict does not stall disjoint revision materialization or create false clean", async () => {
  const fixture = createBrokerFixture();
  try {
    await appendSnapshot(fixture, 1, { "tasks/a.md": "a1\n", "tasks/b.md": "b1\n" });
    const broker = new ReplicaBroker({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      viewRoot: fixture.viewRoot,
      stateRoot: fixture.stateRoot,
      replicaChangeLog: fixture.changeLog,
      snapshotSource: fixture.snapshotSource
    });
    await broker.synchronize();
    writeFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "local-a\n");
    await broker.recordLocalChange("tasks/a.md");
    const events: LocalConflictEvent[] = [];
    broker.conflicts.onConflict((event) => { events.push(event); });
    await appendSnapshot(fixture, 2, { "tasks/a.md": "remote-a\n", "tasks/b.md": "remote-b\n" });

    const state = await broker.synchronize();

    assert.equal(state.receivedCursor, 2);
    assert.equal(state.resolvedCursor, 2);
    assert.equal(state.paths["tasks/a.md"]?.status, "CONFLICT");
    assert.equal(state.paths["tasks/b.md"]?.status, "CLEAN");
    assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "utf8"), "local-a\n");
    assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/b.md"), "utf8"), "remote-b\n");
    assert.equal(events.length, 1);
    assert.equal(readFileSync(path.join(events[0]!.directory, "ours"), "utf8"), "local-a\n");
    assert.equal(readFileSync(path.join(events[0]!.directory, "theirs"), "utf8"), "remote-a\n");
    assert.deepEqual(await broker.barrier(), { tag: "LOCAL_CONFLICT", paths: ["tasks/a.md"] });

    const resolver = new ResolverAgent({ stateRoot: fixture.stateRoot });
    const preview = await resolver.consume(events[0]!);
    assert.equal(preview.status, "CONFIRMATION_REQUIRED");
    assert.equal(preview.strategy, "THREE_WAY_MARKED");
    assert.match(readFileSync(preview.previewPath!, "utf8"), /<<<<<<< LOCAL OURS/u);
    const confirmed = await resolver.confirm(preview.previewId, preview.confirmationToken!);
    assert.equal(confirmed.canonicalSubmitRequired, true);
    assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "utf8"), "local-a\n");
  } finally {
    fixture.cleanup();
  }
});

for (const crashPoint of [
  "after_intent",
  "after_stage",
  "after_old_retained",
  "after_namespace_mutation",
  "after_post_verify",
  "after_apply_resolved",
  "after_hidden_resolved"
] satisfies ReadonlyArray<BrokerCrashPoint>) {
  test(`restart recovers ${crashPoint} without half-written bytes or cursor drift`, async () => {
    const fixture = createBrokerFixture();
    try {
      await appendSnapshot(fixture, 1, { "tasks/a.md": "old-complete-generation\n" });
      let armed = false;
      let injected = false;
      const broker = new ReplicaBroker({
        workspaceId: "workspace-tw03",
        viewId: "view-main",
        viewRoot: fixture.viewRoot,
        stateRoot: fixture.stateRoot,
        replicaChangeLog: fixture.changeLog,
        snapshotSource: fixture.snapshotSource,
        crashInjector: {
          hit: (point) => {
            if (armed && !injected && point === crashPoint) {
              injected = true;
              throw new Error(`CRASH:${crashPoint}`);
            }
          }
        }
      });
      await broker.synchronize();
      armed = true;
      await appendSnapshot(fixture, 2, { "tasks/a.md": "new-complete-generation\n" });
      await assert.rejects(broker.synchronize(), new RegExp(`CRASH:${crashPoint}`));
      assert.equal(injected, true);

      const restarted = new ReplicaBroker({
        workspaceId: "workspace-tw03",
        viewId: "view-main",
        viewRoot: fixture.viewRoot,
        stateRoot: fixture.stateRoot,
        replicaChangeLog: fixture.changeLog,
        snapshotSource: fixture.snapshotSource
      });
      const recovered = await restarted.initialize();

      assert.equal(recovered.receivedCursor, 2);
      assert.equal(recovered.resolvedCursor, 2);
      assert.equal(recovered.pendingMaterializations.length, 0);
      assert.equal(recovered.paths["tasks/a.md"]?.status, "CLEAN");
      assert.equal(recovered.paths["tasks/a.md"]?.visibleBase?.revision, 2);
      assert.equal(readFileSync(path.join(fixture.viewRoot, "tasks/a.md"), "utf8"), "new-complete-generation\n");
    } finally {
      fixture.cleanup();
    }
  });
}

test("a revision gap fails closed before either cursor crosses it", async () => {
  const fixture = createBrokerFixture();
  try {
    mkdirSync(fixture.viewRoot, { recursive: true });
    const broker = new ReplicaBroker({
      workspaceId: "workspace-tw03",
      viewId: "view-main",
      viewRoot: fixture.viewRoot,
      stateRoot: fixture.stateRoot,
      replicaChangeLog: {
        ...fixture.changeLog,
        changesAfter: async () => [{
          schema: "replica-change/v1",
          workspaceId: "workspace-tw03",
          revision: 2,
          opId: "gap",
          semanticDigest: "gap",
          commitSha: "commit-2",
          previousCommit: "commit-1",
          changedAt: "2026-07-13T00:00:02.000Z"
        }]
      },
      snapshotSource: fixture.snapshotSource
    });
    await assert.rejects(broker.synchronize(), /gap or parent mismatch/u);
    const state = broker.snapshotState();
    assert.equal(state.receivedCursor, 0);
    assert.equal(state.resolvedCursor, 0);
    assert.equal(state.mode, "RESYNC_REQUIRED");
  } finally {
    fixture.cleanup();
  }
});
