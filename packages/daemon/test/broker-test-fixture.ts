import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createInMemoryReplicaChangeLog,
  type ReplicaChangeLog,
  type ReplicaChangeRecord
} from "../../application/src/index.ts";
import type { CanonicalSnapshot, CanonicalSnapshotSource } from "../src/index.ts";

export interface BrokerFixture {
  readonly root: string;
  readonly viewRoot: string;
  readonly stateRoot: string;
  readonly changeLog: ReplicaChangeLog;
  readonly snapshots: Map<string, CanonicalSnapshot>;
  readonly snapshotSource: CanonicalSnapshotSource;
  readonly cleanup: () => void;
}

export function createBrokerFixture(): BrokerFixture {
  const root = mkdtempSync(path.join(tmpdir(), "ha-broker-test-"));
  const snapshots = new Map<string, CanonicalSnapshot>();
  return {
    root,
    viewRoot: path.join(root, "harness"),
    stateRoot: path.join(root, ".ha-state"),
    changeLog: createInMemoryReplicaChangeLog(),
    snapshots,
    snapshotSource: {
      snapshotAt: async (change) => {
        const snapshot = snapshots.get(change.commitSha);
        if (!snapshot) throw new Error(`missing test snapshot ${change.commitSha}`);
        return structuredClone(snapshot);
      }
    },
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

export async function appendSnapshot(
  fixture: BrokerFixture,
  revision: number,
  files: Readonly<Record<string, string>>,
  opId = `op-${revision}`
): Promise<ReplicaChangeRecord> {
  const commitSha = `commit-${revision}`;
  const previousCommit = revision === 1 ? null : `commit-${revision - 1}`;
  const change: ReplicaChangeRecord = {
    schema: "replica-change/v1",
    workspaceId: "workspace-tw03",
    revision,
    opId,
    semanticDigest: `digest-${revision}`,
    commitSha,
    previousCommit,
    changedAt: `2026-07-13T00:00:${String(revision).padStart(2, "0")}.000Z`
  };
  fixture.snapshots.set(commitSha, {
    workspaceId: change.workspaceId,
    revision,
    commitSha,
    entries: Object.entries(files).map(([pathName, content]) => ({
      path: pathName,
      content: Buffer.from(content, "utf8"),
      logicalMode: 0o644
    }))
  });
  await fixture.changeLog.append(change);
  return change;
}
