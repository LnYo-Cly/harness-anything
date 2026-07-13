// harness-test-tier: integration
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  queryExecutionEvidencePage,
  queryExecutionEvidencePageFromReadyGeneration
} from "../../src/projection/sqlite-execution-evidence-reader.ts";
import {
  ensureExecutionEvidenceGenerationReady,
  rebuildExecutionEvidenceProjection,
  updateExecutionEvidenceProjectionIncrementally
} from "../../src/projection/sqlite-execution-evidence-store.ts";
import { rebuildTaskProjection } from "../../src/projection/sqlite-task-projection.ts";
import {
  checkerExecutionEvidenceOutput as checkerOutput,
  fileExecutionEvidenceOutput as fileOutput,
  ids,
  inlineExecutionEvidenceOutput as inlineOutput,
  openExecutionEvidenceProjection as openEvidenceProjection,
  openFullProjection,
  withExecutionEvidenceHarness as withHarness,
  writeExecutionEvidence as writeExecution,
  writeExecutionEvidenceTask as writeTask
} from "./helpers/execution-evidence.ts";

test("execution evidence first page publishes an isolated facet without building the full repository projection", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Isolated Evidence facet");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-isolated", "Evidence without the full projection")
    ]);

    const page = queryExecutionEvidencePage({ rootDir, limit: 1 });

    assert.equal(page.groups[0]?.title, "Isolated Evidence facet");
    assert.equal(existsSync(path.join(rootDir, ".harness/cache/execution-evidence.sqlite")), true);
    assert.equal(existsSync(path.join(rootDir, ".harness/cache/projections.sqlite")), false);
  });
});

test("full repository projection does not duplicate the isolated Evidence tables", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "No duplicated Evidence tables");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-isolated", "Only the facet owns this row")
    ]);

    rebuildTaskProjection({ rootDir });

    const db = openFullProjection(rootDir);
    try {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('execution_evidence_projection', 'execution_output_projection')
      `).all();
      assert.deepEqual(tables, []);
    } finally {
      db.close();
    }
  });
});

test("full repository projection rebuild does not invalidate an Evidence cursor or generation", () => {
  withHarness((rootDir) => {
    for (let index = 1; index <= 2; index += 1) {
      const identity = ids(index);
      writeTask(rootDir, identity.taskId, `Independent facet ${index}`);
      writeExecution(rootDir, identity.taskId, identity.executionId, `2026-07-13T00:0${index}:00.000Z`, [
        inlineOutput(identity, `ev-${index}`, `Evidence ${index}`)
      ]);
    }
    const firstPage = queryExecutionEvidencePage({ rootDir, limit: 1 });
    const before = ensureExecutionEvidenceGenerationReady({ rootDir }).ready;

    rebuildTaskProjection({ rootDir });

    const secondPage = queryExecutionEvidencePage({ rootDir, limit: 1, cursor: firstPage.nextCursor! });
    const after = ensureExecutionEvidenceGenerationReady({ rootDir }).ready;
    assert.equal(secondPage.groups[0]?.executions[0]?.executionId, ids(1).executionId);
    assert.equal(after.sourceHash, before.sourceHash);
    assert.equal(after.databaseSignature, before.databaseSignature);
  });
});

test("isolated Evidence facet normalizes execution outputs into queryable SQL rows", () => {
  withHarness((rootDir) => {
    const first = ids(1);
    writeTask(rootDir, first.taskId, "First task");
    writeExecution(rootDir, first.taskId, first.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(first, "ev-inline", "Delivered file"),
      checkerOutput(first, "ev-receipt", "ev-inline", "pass")
    ]);

    rebuildExecutionEvidenceProjection({ rootDir });

    const db = openEvidenceProjection(rootDir);
    try {
      assert.deepEqual(db.prepare(`
        SELECT execution_id, task_ref, executor_id, executor_kind,
               responsible_human, latest_at, archival
        FROM execution_evidence_projection
      `).all().map((row) => ({ ...row })), [{
        execution_id: first.executionId,
        task_ref: `task/${first.taskId}`,
        executor_id: "codex",
        executor_kind: "agent",
        responsible_human: "person_test",
        latest_at: "2026-07-13T00:01:00.000Z",
        archival: 0
      }]);
      assert.deepEqual(db.prepare(`
        SELECT execution_id, ordinal, evidence_id, substrate, inline_text,
               receipt_result, checker_receipt_ref
        FROM execution_output_projection
        ORDER BY execution_id, ordinal
      `).all().map((row) => ({ ...row })), [
        {
          execution_id: first.executionId,
          ordinal: 0,
          evidence_id: "ev-inline",
          substrate: "inline",
          inline_text: "Delivered file",
          receipt_result: null,
          checker_receipt_ref: "ev-receipt"
        },
        {
          execution_id: first.executionId,
          ordinal: 1,
          evidence_id: "ev-receipt",
          substrate: "checker_receipt",
          inline_text: null,
          receipt_result: "pass",
          checker_receipt_ref: null
        }
      ]);
    } finally {
      db.close();
    }
  });
});

test("incremental execution changes replace only that execution output rows", () => {
  withHarness((rootDir) => {
    const first = ids(1);
    const second = ids(2);
    writeTask(rootDir, first.taskId, "First task");
    writeTask(rootDir, second.taskId, "Second task");
    const changedPath = writeExecution(rootDir, first.taskId, first.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(first, "ev-first", "Before")
    ]);
    writeExecution(rootDir, second.taskId, second.executionId, "2026-07-13T00:02:00.000Z", [
      inlineOutput(second, "ev-second", "Untouched")
    ]);
    const previousSourceFingerprint = rebuildExecutionEvidenceProjection({ rootDir }).ready.sourceHash;
    const db = openEvidenceProjection(rootDir, false);
    try {
      db.exec(`
        CREATE TRIGGER preserve_untouched_execution_outputs
        BEFORE DELETE ON execution_output_projection
        WHEN OLD.execution_id = '${second.executionId}'
        BEGIN SELECT RAISE(ABORT, 'untouched output deleted'); END
      `);
      db.exec(`
        CREATE TRIGGER preserve_untouched_execution_summary
        BEFORE DELETE ON execution_evidence_projection
        WHEN OLD.execution_id = '${second.executionId}'
        BEGIN SELECT RAISE(ABORT, 'untouched summary deleted'); END
      `);
      db.exec(`
        CREATE TRIGGER preserve_untouched_execution_integrity
        BEFORE UPDATE ON facet_integrity_leaf
        WHEN OLD.leaf_kind = 'execution' AND OLD.entity_id = '${second.executionId}'
        BEGIN SELECT RAISE(ABORT, 'untouched integrity leaf updated'); END
      `);
    } finally {
      db.close();
    }
    writeExecution(rootDir, first.taskId, first.executionId, "2026-07-13T00:03:00.000Z", [
      inlineOutput(first, "ev-first-updated", "After")
    ]);

    const result = updateExecutionEvidenceProjectionIncrementally({
      rootDir,
      touchedPaths: [changedPath],
      previousSourceFingerprint
    });

    assert.equal(result.mode, "incremental");
    const updated = openEvidenceProjection(rootDir);
    try {
      assert.deepEqual(updated.prepare(`
        SELECT execution_id, evidence_id, inline_text
        FROM execution_output_projection
        ORDER BY execution_id, ordinal
      `).all().map((row) => ({ ...row })), [
        { execution_id: first.executionId, evidence_id: "ev-first-updated", inline_text: "After" },
        { execution_id: second.executionId, evidence_id: "ev-second", inline_text: "Untouched" }
      ]);
      assert.equal(updated.prepare(`
        SELECT COUNT(*) AS count
        FROM execution_evidence_projection
      `).get()?.count, 2);
    } finally {
      updated.close();
    }
  });
});

test("incremental task-title changes update the Evidence facet without rebuilding execution rows", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Before title");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-title", "Preserved evidence")
    ]);
    const previousSourceFingerprint = rebuildExecutionEvidenceProjection({ rootDir }).ready.sourceHash;
    const db = openEvidenceProjection(rootDir, false);
    try {
      db.exec(`
        CREATE TRIGGER preserve_execution_on_title_change
        BEFORE DELETE ON execution_evidence_projection
        BEGIN SELECT RAISE(ABORT, 'execution row deleted'); END
      `);
    } finally {
      db.close();
    }
    writeTask(rootDir, identity.taskId, "After title");
    const indexPath = path.join(rootDir, "harness/tasks", identity.taskId, "INDEX.md");

    const result = updateExecutionEvidenceProjectionIncrementally({
      rootDir,
      touchedPaths: [indexPath],
      previousSourceFingerprint
    });

    assert.equal(result.mode, "incremental");
    const page = queryExecutionEvidencePageFromReadyGeneration(result.ready, { limit: 1 });
    assert.equal(page.groups[0]?.title, "After title");
    assert.equal(page.groups[0]?.executions[0]?.outputs[0]?.text, "Preserved evidence");
  });
});

test("incremental execution source changes add and delete manifest-backed rows", () => {
  withHarness((rootDir) => {
    const first = ids(1);
    const second = ids(2);
    const added = { taskId: first.taskId, executionId: second.executionId };
    writeTask(rootDir, first.taskId, "Execution manifest changes");
    const deletedPath = writeExecution(rootDir, first.taskId, first.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(first, "ev-deleted", "Deleted evidence")
    ]);
    const previousSourceFingerprint = rebuildExecutionEvidenceProjection({ rootDir }).ready.sourceHash;
    rmSync(deletedPath);
    const addedPath = writeExecution(rootDir, added.taskId, added.executionId, "2026-07-13T00:02:00.000Z", [
      inlineOutput(added, "ev-added", "Added evidence")
    ]);

    const result = updateExecutionEvidenceProjectionIncrementally({
      rootDir,
      touchedPaths: [deletedPath, addedPath],
      previousSourceFingerprint
    });

    assert.equal(result.mode, "incremental");
    const page = queryExecutionEvidencePageFromReadyGeneration(result.ready, { limit: 2 });
    assert.deepEqual(page.groups[0]?.executions.map((execution) => execution.executionId), [second.executionId]);
    assert.equal(page.groups[0]?.executions[0]?.outputs[0]?.text, "Added evidence");
  });
});

test("execution evidence uses stable execution keyset pages and SQL aggregate stats", () => {
  withHarness((rootDir) => {
    for (let index = 1; index <= 3; index += 1) {
      const identity = ids(index);
      writeTask(rootDir, identity.taskId, `Task ${index}`);
      writeExecution(rootDir, identity.taskId, identity.executionId, `2026-07-13T00:0${index}:00.000Z`, [
        inlineOutput(identity, `ev-${index}`, `Evidence ${index}`),
        ...(index === 3 ? [checkerOutput(identity, "ev-3-receipt", "ev-3", "pass")] : [])
      ], index === 2 ? "fact-execution-migration" : "codex");
    }
    const newest = { taskId: ids(3).taskId, executionId: ids(4).executionId };
    writeExecution(rootDir, newest.taskId, newest.executionId, "2026-07-13T00:04:00.000Z", [
      inlineOutput(newest, "ev-4", "Evidence 4")
    ]);
    rebuildExecutionEvidenceProjection({ rootDir });

    const firstPage = queryExecutionEvidencePage({ rootDir, limit: 2 });

    assert.deepEqual(firstPage.groups.map((group) => group.taskId), [ids(3).taskId]);
    assert.deepEqual(firstPage.groups[0]?.executions.map((execution) => execution.executionId), [
      newest.executionId,
      ids(3).executionId
    ]);
    assert.equal(firstPage.groups[0]?.executions[0]?.outputs[0]?.text, "Evidence 4");
    assert.deepEqual(firstPage.stats, {
      totalExecutions: 4,
      archivalExecutions: 1,
      realExecutions: 3,
      totalOutputs: 5,
      passingReceiptOutputs: 1,
      tasksWithExecutions: 3
    });
    assert.equal(firstPage.nextCursor?.latestAt, "2026-07-13T00:03:00.000Z");
    assert.equal(firstPage.nextCursor?.executionId, ids(3).executionId);
    assert.ok(firstPage.nextCursor?.generation);

    const secondPage = queryExecutionEvidencePage({ rootDir, limit: 2, cursor: firstPage.nextCursor! });
    assert.deepEqual(secondPage.groups.map((group) => group.taskId), [ids(2).taskId, ids(1).taskId]);
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(secondPage.stats, firstPage.stats);

    const previousSourceFingerprint = ensureExecutionEvidenceGenerationReady({ rootDir }).ready.sourceHash;
    const movedPath = writeExecution(rootDir, ids(1).taskId, ids(1).executionId, "2026-07-13T00:05:00.000Z", [
      inlineOutput(ids(1), "ev-1", "Evidence 1")
    ]);
    const updated = updateExecutionEvidenceProjectionIncrementally({
      rootDir,
      touchedPaths: [movedPath],
      previousSourceFingerprint
    });
    assert.equal(updated.mode, "incremental");
    assert.throws(
      () => queryExecutionEvidencePage({ rootDir, limit: 2, cursor: firstPage.nextCursor! }),
      /cursor generation changed/
    );
  });
});

test("execution evidence rebuilds normalized SQL rows after generated-cache tampering", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Tamper check");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-original", "Original evidence")
    ]);
    rebuildExecutionEvidenceProjection({ rootDir });

    const db = openEvidenceProjection(rootDir, false);
    try {
      db.prepare("UPDATE execution_output_projection SET inline_text = 'TAMPERED'").run();
    } finally {
      db.close();
    }

    const page = queryExecutionEvidencePage({ rootDir, limit: 1 });
    assert.equal(page.groups[0]?.executions[0]?.outputs[0]?.text, "Original evidence");
  });
});

test("execution evidence rebuilds after integrity-leaf tampering", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Integrity leaf check");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-integrity", "Integrity evidence")
    ]);
    rebuildExecutionEvidenceProjection({ rootDir });
    const db = openEvidenceProjection(rootDir, false);
    try {
      db.prepare("UPDATE facet_integrity_leaf SET row_hash = 'sha256:tampered'").run();
    } finally {
      db.close();
    }

    queryExecutionEvidencePage({ rootDir, limit: 1 });

    const repaired = openEvidenceProjection(rootDir);
    try {
      assert.notEqual(
        repaired.prepare("SELECT row_hash FROM facet_integrity_leaf LIMIT 1").get()?.row_hash,
        "sha256:tampered"
      );
    } finally {
      repaired.close();
    }
  });
});

test("execution evidence page caps output previews without losing total counts", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Many outputs");
    writeExecution(
      rootDir,
      identity.taskId,
      identity.executionId,
      "2026-07-13T00:01:00.000Z",
      [
        inlineOutput(identity, "ev-inline-large", "😀".repeat(300_000)),
        fileOutput(identity, "ev-file-large", "界".repeat(300_000)),
        ...Array.from({ length: 6 }, (_, index) => inlineOutput(identity, `ev-${index}`, `Evidence ${index}`))
      ]
    );
    rebuildExecutionEvidenceProjection({ rootDir });

    const page = queryExecutionEvidencePage({ rootDir, limit: 1 });
    const execution = page.groups[0]?.executions[0];

    assert.equal(execution?.outputs.length, 5);
    assert.ok(Buffer.byteLength(execution?.outputs[0]?.text ?? "", "utf8") <= 1_027);
    assert.ok(Buffer.byteLength(execution?.outputs[1]?.text ?? "", "utf8") <= 1_050);
    assert.match(execution?.outputs[0]?.text ?? "", /…$/u);
    assert.match(execution?.outputs[1]?.text ?? "", /…$/u);
    assert.equal(execution?.outputCount, 8);
    assert.equal(execution?.hasMoreOutputs, true);
    assert.equal(page.stats.totalOutputs, 8);
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") < 250 * 1024);
  });
});

test("execution evidence page pins generation rows outputs and stats to one SQLite snapshot", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Snapshot evidence");
    writeExecution(
      rootDir,
      identity.taskId,
      identity.executionId,
      "2026-07-13T00:01:00.000Z",
      [inlineOutput(identity, "ev-before", "Before")]
    );
    rebuildExecutionEvidenceProjection({ rootDir });
    const db = openEvidenceProjection(rootDir, false);
    try {
      db.exec("PRAGMA journal_mode = WAL");
    } finally {
      db.close();
    }
    const ready = ensureExecutionEvidenceGenerationReady({ rootDir }).ready;
    let writerCommitted = false;
    let pinnedPage: ReturnType<typeof queryExecutionEvidencePageFromReadyGeneration> | null = null;

    assert.throws(
      () => queryExecutionEvidencePageFromReadyGeneration(
        ready,
        { limit: 1 },
        {
          afterExecutionRowsRead: () => {
            const writer = openEvidenceProjection(rootDir, false);
            try {
              writer.exec("BEGIN IMMEDIATE");
              writer.prepare(`
                UPDATE execution_output_projection
                SET evidence_id = 'ev-after', inline_text = 'After'
                WHERE execution_id = ?
              `).run(identity.executionId);
              writer.prepare(`
                INSERT INTO execution_output_projection (
                  execution_id, ordinal, evidence_id, execution_ref, substrate, inline_text
                ) VALUES (?, 1, 'ev-added', ?, 'inline', 'Added')
              `).run(identity.executionId, `execution/${identity.taskId}/${identity.executionId}`);
              writer.prepare("UPDATE projection_meta SET value = 'generation-after' WHERE key = 'sourceHash'").run();
              writer.exec("COMMIT");
              writerCommitted = true;
            } finally {
              writer.close();
            }
          },
          afterSnapshotRead: (page) => {
            pinnedPage = page;
          }
        }
      ),
      /projection database changed while reading/
    );

    assert.equal(writerCommitted, true);
    assert.equal(pinnedPage?.groups[0]?.executions[0]?.outputs[0]?.text, "Before");
    assert.equal(pinnedPage?.groups[0]?.executions[0]?.outputCount, 1);
    assert.equal(pinnedPage?.stats.totalOutputs, 1);
    const refreshed = openEvidenceProjection(rootDir);
    try {
      assert.equal(refreshed.prepare("SELECT COUNT(*) AS count FROM execution_output_projection").get()?.count, 2);
      assert.equal(refreshed.prepare("SELECT inline_text FROM execution_output_projection ORDER BY ordinal").get()?.inline_text, "After");
      assert.equal(refreshed.prepare("SELECT value FROM projection_meta WHERE key = 'sourceHash'").get()?.value, "generation-after");
    } finally {
      refreshed.close();
    }
  });
});

test("ready generation handle rejects database changes that bypass generation validation", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Ready handle tamper");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-original", "Original")
    ]);
    rebuildExecutionEvidenceProjection({ rootDir });
    const journal = openEvidenceProjection(rootDir, false);
    try {
      journal.exec("PRAGMA journal_mode = WAL");
    } finally {
      journal.close();
    }
    const ready = ensureExecutionEvidenceGenerationReady({ rootDir }).ready;
    assert.equal(Object.isFrozen(ready), true);
    const forged = Object.assign(Object.create(Object.getPrototypeOf(ready)) as object, ready) as typeof ready;
    assert.throws(
      () => queryExecutionEvidencePageFromReadyGeneration(forged, { limit: 1 }),
      /handle was not established by the projection validator/
    );
    const pinnedReader = openEvidenceProjection(rootDir);
    pinnedReader.exec("BEGIN");
    pinnedReader.prepare("SELECT value FROM projection_meta WHERE key = 'sourceHash'").get();
    const db = openEvidenceProjection(rootDir, false);
    try {
      db.prepare("UPDATE execution_output_projection SET inline_text = 'TAMPERED'").run();
    } finally {
      db.close();
    }

    try {
      assert.throws(
        () => queryExecutionEvidencePageFromReadyGeneration(ready, { limit: 1 }),
        /ready projection generation changed/
      );
    } finally {
      pinnedReader.exec("ROLLBACK");
      pinnedReader.close();
    }
  });
});

test("ready generation acquisition retries when the database changes after validation", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Acquire race");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-original", "Original")
    ]);
    rebuildExecutionEvidenceProjection({ rootDir });
    let tampered = false;

    const acquired = ensureExecutionEvidenceGenerationReady(
      { rootDir },
      {
        afterProjectionValidated: () => {
          if (tampered) return;
          const db = openEvidenceProjection(rootDir, false);
          try {
            db.prepare("UPDATE execution_output_projection SET inline_text = 'TAMPERED'").run();
            tampered = true;
          } finally {
            db.close();
          }
        }
      }
    );

    assert.equal(tampered, true);
    assert.equal(
      queryExecutionEvidencePageFromReadyGeneration(acquired.ready, { limit: 1 })
        .groups[0]?.executions[0]?.outputs[0]?.text,
      "Original"
    );
  });
});

test("ready generation acquisition does not trust a cached validation across WAL changes", () => {
  withHarness((rootDir) => {
    const identity = ids(1);
    writeTask(rootDir, identity.taskId, "Cached WAL validation");
    writeExecution(rootDir, identity.taskId, identity.executionId, "2026-07-13T00:01:00.000Z", [
      inlineOutput(identity, "ev-original", "Original")
    ]);
    rebuildExecutionEvidenceProjection({ rootDir });
    const journal = openEvidenceProjection(rootDir, false);
    try {
      journal.exec("PRAGMA journal_mode = WAL");
    } finally {
      journal.close();
    }
    ensureExecutionEvidenceGenerationReady({ rootDir });
    const pinnedReader = openEvidenceProjection(rootDir);
    pinnedReader.exec("BEGIN");
    pinnedReader.prepare("SELECT value FROM projection_meta WHERE key = 'sourceHash'").get();
    const writer = openEvidenceProjection(rootDir, false);
    try {
      writer.prepare("UPDATE execution_output_projection SET inline_text = 'TAMPERED'").run();
    } finally {
      writer.close();
    }

    try {
      const reacquired = ensureExecutionEvidenceGenerationReady({ rootDir }).ready;
      assert.equal(
        queryExecutionEvidencePageFromReadyGeneration(reacquired, { limit: 1 })
          .groups[0]?.executions[0]?.outputs[0]?.text,
        "Original"
      );
    } finally {
      pinnedReader.exec("ROLLBACK");
      pinnedReader.close();
    }
  });
});
