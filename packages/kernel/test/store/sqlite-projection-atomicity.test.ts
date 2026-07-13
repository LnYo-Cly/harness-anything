// harness-test-tier: integration
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { rebuildTaskProjection } from "../../src/index.ts";
import { withTempStoreAsync } from "./helpers.ts";

test("SQLite full rebuild atomically publishes complete declared entity generations", async () => {
  await withTempStoreAsync(async (rootDir) => {
    const executionPath = seedAtomicProjectionTask(rootDir, 250);
    const template = JSON.parse(readFileSync(executionPath, "utf8")) as Record<string, unknown>;
    rebuildTaskProjection({ rootDir });

    const projectionPath = path.join(rootDir, ".harness/cache/projections.sqlite");
    const sourceHashes = new Map<string, string>();
    sourceHashes.set("submitted", readAtomicMetaValue(projectionPath, "sourceHash"));
    writeAtomicExecutionState(executionPath, template, "accepted");
    rebuildTaskProjection({ rootDir });
    sourceHashes.set("accepted", readAtomicMetaValue(projectionPath, "sourceHash"));
    writeAtomicExecutionState(executionPath, template, "submitted");
    rebuildTaskProjection({ rootDir });

    const reader = spawn(process.execPath, ["--input-type=module", "-e", atomicProjectionReaderScript], {
      env: {
        ...process.env,
        HARNESS_PROJECTION_PATH: projectionPath,
        HARNESS_EXPECTED_EXECUTIONS: "250",
        HARNESS_EXPECTED_GENERATIONS: JSON.stringify([...sourceHashes])
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    reader.stdout.setEncoding("utf8");
    reader.stderr.setEncoding("utf8");
    reader.stdout.on("data", (chunk: string) => { stdout += chunk; });
    reader.stderr.on("data", (chunk: string) => { stderr += chunk; });
    await waitForAtomicReader(() => stdout.includes("READY\n"));

    for (let iteration = 0; iteration < 8; iteration += 1) {
      writeAtomicExecutionState(executionPath, template, iteration % 2 === 0 ? "accepted" : "submitted");
      rebuildTaskProjection({ rootDir });
    }

    const [exitCode] = await once(reader, "close") as [number];
    assert.equal(exitCode, 0, stderr);
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as {
      readonly reads: number;
      readonly failures: number;
      readonly partial: number;
    };
    assert.equal(result.reads > 0, true);
    assert.deepEqual(result, { reads: result.reads, failures: 0, partial: 0 });
  });
});

function seedAtomicProjectionTask(rootDir: string, executionCount: number): string {
  const taskId = "task_01J00000000000000000000000";
  const taskRoot = path.join(rootDir, "harness/tasks", taskId);
  const executionRoot = path.join(taskRoot, "executions");
  mkdirSync(executionRoot, { recursive: true });
  writeFileSync(path.join(taskRoot, "INDEX.md"), [
    "---",
    "schema: task-package/v2",
    `task_id: ${taskId}`,
    "title: Atomic projection",
    "lifecycle:",
    "  bindingSchema: lifecycle-binding/v1",
    "  engine: local",
    "  status: in_review",
    "  ref: ",
    "  titleSnapshot: Atomic projection",
    "  url: ",
    "  bindingCreatedAt: 2026-07-11T00:00:00.000Z",
    "  bindingFingerprint: sha256:fixture",
    "packageDisposition: active",
    "vertical: default",
    "preset: default",
    "---",
    "",
    "# Atomic projection",
    ""
  ].join("\n"));
  const template = {
    schema: "execution/v2",
    execution_id: "exe_01J00000000000000000000000",
    task_ref: `task/${taskId}`,
    state: "submitted",
    primary_actor: {
      principal: { personId: "person:test" },
      executor: { kind: "agent", id: "agent:test" },
      responsibleHuman: "person:test"
    },
    claimed_at: "2026-07-11T01:00:00.000Z",
    submitted_at: "2026-07-11T01:10:00.000Z",
    closed_at: null,
    session_bindings: [],
    outputs: [],
    submission: {
      completion_claim: "ready",
      deliverables: [],
      evidence_refs: [],
      verification_notes: [],
      known_gaps: [],
      residual_risks: []
    }
  };
  for (let index = 0; index < executionCount; index += 1) {
    const executionId = index === 0 ? template.execution_id : `exe_${String(index).padStart(26, "0")}`;
    writeFileSync(path.join(executionRoot, `${executionId}.md`), `${JSON.stringify({
      ...template,
      execution_id: executionId
    }, null, 2)}\n`);
  }
  return path.join(executionRoot, `${template.execution_id}.md`);
}

function writeAtomicExecutionState(
  executionPath: string,
  template: Readonly<Record<string, unknown>>,
  state: "submitted" | "accepted"
): void {
  writeFileSync(executionPath, `${JSON.stringify({ ...template, state }, null, 2)}\n`);
}

function readAtomicMetaValue(projectionPath: string, key: string): string {
  const db = new DatabaseSync(projectionPath, { readOnly: true });
  try {
    return String(db.prepare("SELECT value FROM projection_meta WHERE key = ?").get(key)?.value);
  } finally {
    db.close();
  }
}

async function waitForAtomicReader(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for projection reader");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const atomicProjectionReaderScript = `
import { DatabaseSync } from "node:sqlite";
const projectionPath = process.env.HARNESS_PROJECTION_PATH;
const expected = Number(process.env.HARNESS_EXPECTED_EXECUTIONS);
const expectedGenerations = new Map(JSON.parse(process.env.HARNESS_EXPECTED_GENERATIONS));
let reads = 0;
let failures = 0;
let partial = 0;
process.stdout.write("READY\\n");
const deadline = Date.now() + 4_000;
while (Date.now() < deadline) {
  let db;
  try {
    db = new DatabaseSync(projectionPath, { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) AS count FROM execution_projection").get();
    const meta = db.prepare("SELECT value FROM projection_meta WHERE key = 'declaredRowsHash'").get();
    const source = db.prepare("SELECT value FROM projection_meta WHERE key = 'sourceHash'").get();
    const execution = db.prepare("SELECT state FROM execution_projection WHERE execution_id = 'exe_01J00000000000000000000000'").get();
    reads += 1;
    if (Number(row.count) !== expected || typeof meta?.value !== "string" || meta.value.length === 0 || expectedGenerations.get(execution?.state) !== source?.value) partial += 1;
  } catch {
    failures += 1;
  } finally {
    db?.close();
  }
}
process.stdout.write(JSON.stringify({ reads, failures, partial }) + "\\n");
`;
