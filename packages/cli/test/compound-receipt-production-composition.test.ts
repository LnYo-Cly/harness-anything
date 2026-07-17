// harness-test-tier: integration
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createInMemoryReplicaChangeLog } from "../../application/src/index.ts";
import { createProductionCompoundReceiptComposition } from "../src/daemon/compound-receipt-composition.ts";

const restartWorkerFlag = "--compound-receipt-restart-worker";

if (process.argv.includes(restartWorkerFlag)) {
  const [stateDirectory, root, waiterId, resultToken] = process.argv.slice(process.argv.indexOf(restartWorkerFlag) + 1);
  const composition = createProductionCompoundReceiptComposition({
    workspaceId: "workspace-production",
    viewId: "view-production",
    canonicalRoot: root!,
    stateDirectory: stateDirectory!,
    replicaChangeLog: createInMemoryReplicaChangeLog()
  });
  const recovered = await composition.recover({
    requestId: "recover-1",
    workspaceId: "workspace-production",
    viewId: "view-production",
    opId: "operation-1",
    waiterId: waiterId!,
    resultToken: resultToken!
  });
  process.stdout.write(JSON.stringify(recovered));
  process.exit(0);
}

test("production daemon composition recovers a waiter after a fresh process-style rebuild", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ha-compound-production-"));
  try {
    const stateDirectory = path.join(root, "state");
    const input = {
      workspaceId: "workspace-production",
      viewId: "view-production",
      canonicalRoot: root,
      stateDirectory,
      replicaChangeLog: createInMemoryReplicaChangeLog()
    };
    const first = createProductionCompoundReceiptComposition(input);
    const opened = await first.openWaiter({ requestId: "open-1", opId: "operation-1" });
    const child = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), restartWorkerFlag,
      stateDirectory, root, opened.waiterId, opened.resultToken], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    const recovered = JSON.parse(child.stdout) as { readonly state: string; readonly receipt?: { readonly waiterId: string } };
    assert.equal(recovered.state, "RECEIPT");
    assert.equal(recovered.receipt?.waiterId, opened.waiterId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
