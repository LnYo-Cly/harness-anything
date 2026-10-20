// harness-test-tier: fast
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isInsideBackup } from "../../src/store/ledger-backup.ts";

test("only the backup and paths under it count as inside; siblings and other drives are outside", () => {
  const backup = path.resolve("/backups/repo");
  assert.equal(isInsideBackup(backup, backup), true);
  assert.equal(isInsideBackup(backup, path.join(backup, "payload")), true);
  assert.equal(isInsideBackup(backup, path.resolve("/backups")), false);
  assert.equal(isInsideBackup(backup, path.resolve("/backups/repo-dest")), false);
  if (process.platform === "win32") assert.equal(isInsideBackup("C:\\backups\\repo", "G:\\work\\repo"), false);
});
