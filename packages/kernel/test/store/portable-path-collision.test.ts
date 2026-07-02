import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNoPortablePathCollisions } from "../../src/layout/index.ts";
import { readTaskPackage } from "../../src/store/markdown-artifact-store.ts";

test("markdown artifact store rejects case-insensitive authored document path collisions when the host filesystem can materialize them", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-portable-path-"));
  try {
    const taskRoot = path.join(rootDir, "harness/planning/tasks/task-1");
    mkdirSync(path.join(taskRoot, "notes"), { recursive: true });
    writeFileSync(path.join(taskRoot, "INDEX.md"), indexBody("task-1"), "utf8");
    writeFileSync(path.join(taskRoot, "notes/Progress.md"), "A\n", "utf8");
    writeFileSync(path.join(taskRoot, "notes/progress.md"), "B\n", "utf8");

    const entries = readdirSync(path.join(taskRoot, "notes"));
    if (entries.includes("Progress.md") && entries.includes("progress.md")) {
      assert.throws(
        () => readTaskPackage(rootDir, "task-1"),
        /portable path collision: notes\/Progress\.md, notes\/progress\.md/u
      );
      return;
    }

    assert.throws(
      () => assertNoPortablePathCollisions(["notes/Progress.md", "notes/progress.md"]),
      /portable path collision: notes\/Progress\.md, notes\/progress\.md/u
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function indexBody(taskId: string): string {
  return [
    "---",
    "schema: task-package/v2",
    `task_id: ${taskId}`,
    "title: Task One",
    "lifecycle:",
    "  bindingSchema: lifecycle-binding/v1",
    "  engine: local",
    "  status: planned",
    "  ref: ",
    "  titleSnapshot: Task One",
    "  url: ",
    "  bindingCreatedAt: 2026-06-12T00:00:00.000Z",
    "  bindingFingerprint: sha256:test",
    "packageDisposition: active",
    "vertical: default",
    "preset: default",
    "---",
    ""
  ].join("\n");
}
