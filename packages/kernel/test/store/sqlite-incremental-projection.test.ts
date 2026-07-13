// harness-test-tier: integration
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deriveRelationId, formatRelationFlowRecord } from "../../src/domain/index.ts";
import type { EntityRelationRecord } from "../../src/domain/index.ts";
import {
  queryDecisionProjection,
  readRelationGraphProjection,
  readTaskProjection,
  rebuildTaskProjection
} from "../../src/projection/sqlite-task-projection.ts";
import { readAttributionProjection } from "../../src/projection/sqlite-attribution-projection.ts";
import { updateTaskProjectionIncrementally } from "../../src/projection/sqlite-task-incremental-projection.ts";
import { captureProjectionSourceSnapshot } from "../../src/projection/projection-source-snapshot.ts";
import {
  discoverDeclaredEntityProjection,
  readDeclaredEntitySource
} from "../../src/projection/entity-declaration-projection.ts";
import { executionDeclaration } from "../../src/entity/execution-declaration.ts";

test("first task edit after a full rebuild stays incremental", () => {
  withProjectionPair((rootDir) => {
    seedHarness(rootDir);
    rebuildTaskProjection({ rootDir });

    const previousSourceFingerprint = captureProjectionSourceSnapshot(rootDir).fingerprint;
    const touchedPath = writeIndex(rootDir, "task-a", "Task task-a updated", "done", []);
    const result = updateTaskProjectionIncrementally({
      rootDir,
      touchedPaths: [touchedPath],
      previousSourceFingerprint
    });

    assert.equal(result.mode, "incremental");
    const fresh = readTaskProjection({ rootDir });
    assert.equal(fresh.warnings.some((warning) => warning.code === "projection_stale"), false);
    assert.equal(fresh.rows.find((row) => row.taskId === "task-a")?.canonicalStatus, "done");
  });
});

test("task edit with a new attribution event stays incremental and immediately fresh", () => {
  withProjectionPair((rootDir) => {
    seedHarness(rootDir);
    rebuildTaskProjection({ rootDir });

    const previousSourceFingerprint = captureProjectionSourceSnapshot(rootDir).fingerprint;
    const touchedPath = writeIndex(rootDir, "task-a", "Task task-a attributed", "done", []);
    writeAttributionEvent(rootDir, "event-incremental", "task/task-a");
    const result = updateTaskProjectionIncrementally({
      rootDir,
      touchedPaths: [touchedPath],
      previousSourceFingerprint
    });

    assert.equal(result.mode, "incremental");
    assert.equal(readAttributionProjection(rootDir).length, 1);
    const fresh = readTaskProjection({ rootDir });
    assert.equal(fresh.warnings.some((warning) => warning.code === "projection_stale"), false);
    assert.equal(fresh.warnings.some((warning) => warning.severity === "hard-fail"), false);
    assert.equal(fresh.rows.find((row) => row.taskId === "task-a")?.attribution.latestActor?.principal.personId, "person_test");
  });
});

test("declared entity discovery follows path templates without crawling unrelated task artifacts", () => {
  withProjectionPair((rootDir) => {
    seedHarness(rootDir);
    let unrelated = path.join(rootDir, "harness/tasks/task-a/artifacts");
    for (let depth = 0; depth < 50; depth += 1) {
      unrelated = path.join(unrelated, `level-${depth}`);
      mkdirSync(unrelated, { recursive: true });
      writeFileSync(path.join(unrelated, "trace.log"), "unrelated\n", "utf8");
    }

    const discovered = discoverDeclaredEntityProjection(rootDir, executionDeclaration);

    assert.deepEqual(discovered.rows, []);
    assert.equal(discovered.stats.directoriesVisited < 10, true, JSON.stringify(discovered.stats));
  });
});

test("declared entity source fingerprinting does not decode entity documents", () => {
  withProjectionPair((rootDir) => {
    seedHarness(rootDir);
    const executionPath = path.join(rootDir, "harness/tasks/task-a/executions/exe-malformed.md");
    mkdirSync(path.dirname(executionPath), { recursive: true });
    writeFileSync(executionPath, "not valid execution json\n", "utf8");

    const source = readDeclaredEntitySource(rootDir, executionDeclaration);

    assert.equal(source.inputs.length, 1);
    assert.equal(source.inputs[0]?.relativePath, "tasks/task-a/executions/exe-malformed.md");
    assert.equal(source.inputs[0]?.body, "not valid execution json\n");
    assert.throws(() => discoverDeclaredEntityProjection(rootDir, executionDeclaration));
  });
});

test("declared entity source cache reuses verified paths and invalidates same-size rewrites", () => {
  withProjectionPair((rootDir) => {
    seedHarness(rootDir);
    const executionPath = path.join(rootDir, "harness/tasks/task-a/executions/exe-cache.md");
    mkdirSync(path.dirname(executionPath), { recursive: true });
    writeFileSync(executionPath, "source-a\n", "utf8");
    const fixedAt = new Date("2026-07-01T00:00:00.000Z");
    utimesSync(executionPath, fixedAt, fixedAt);

    const first = readDeclaredEntitySource(rootDir, executionDeclaration);
    const second = readDeclaredEntitySource(rootDir, executionDeclaration);
    assert.equal(first.stats.cacheHit, false);
    assert.equal(second.stats.cacheHit, true);

    writeFileSync(executionPath, "source-b\n", "utf8");
    utimesSync(executionPath, fixedAt, fixedAt);
    const changed = readDeclaredEntitySource(rootDir, executionDeclaration);
    assert.equal(changed.stats.cacheHit, false);
    assert.equal(changed.inputs[0]?.body, "source-b\n");
    assert.notEqual(changed.hash, first.hash);
  });
});

test("incremental projection matches full rebuild across deterministic random write sequences", () => {
  for (const seed of [7, 19, 43, 71]) {
    withProjectionPair((incrementalRoot, rebuildRoot) => {
      seedHarness(incrementalRoot);
      seedHarness(rebuildRoot);
      rebuildTaskProjection({ rootDir: incrementalRoot });
      rebuildTaskProjection({ rootDir: rebuildRoot });

      const random = mulberry32(seed);
      for (let step = 0; step < 36; step += 1) {
        const operation = Math.floor(random() * 5);
        const taskId = ["task-a", "task-b", "task-c"][Math.floor(random() * 3)] ?? "task-a";
        const previousSourceFingerprint = captureProjectionSourceSnapshot(incrementalRoot).fingerprint;
        const touchedPaths = applyRandomProjectionWrite(incrementalRoot, operation, taskId, step, seed);
        applyRandomProjectionWrite(rebuildRoot, operation, taskId, step, seed);

        updateTaskProjectionIncrementally({
          rootDir: incrementalRoot,
          touchedPaths,
          previousSourceFingerprint
        });
        rebuildTaskProjection({ rootDir: rebuildRoot });

        assert.deepEqual(snapshotProjection(incrementalRoot, `incremental seed ${seed} step ${step}`), snapshotProjection(rebuildRoot, `rebuild seed ${seed} step ${step}`), `seed ${seed} step ${step}`);
      }
    });
  }
});

test("incremental projection upserts task rows when package slug differs from task_id", () => {
  withProjectionPair((incrementalRoot, rebuildRoot) => {
    const slug = "task_01ABC-readable-slug";
    const taskId = "task_01ABC";
    writeIndex(incrementalRoot, taskId, "Slugged Task", "active", [], slug);
    writeIndex(rebuildRoot, taskId, "Slugged Task", "active", [], slug);
    rebuildTaskProjection({ rootDir: incrementalRoot });
    rebuildTaskProjection({ rootDir: rebuildRoot });

    const previousSourceFingerprint = captureProjectionSourceSnapshot(incrementalRoot).fingerprint;
    const touchedPath = writeIndex(incrementalRoot, taskId, "Slugged Task Updated", "done", [], slug);
    writeIndex(rebuildRoot, taskId, "Slugged Task Updated", "done", [], slug);

    updateTaskProjectionIncrementally({
      rootDir: incrementalRoot,
      touchedPaths: [touchedPath],
      previousSourceFingerprint
    });
    rebuildTaskProjection({ rootDir: rebuildRoot });

    assert.deepEqual(snapshotProjection(incrementalRoot, "incremental slug mismatch"), snapshotProjection(rebuildRoot, "rebuild slug mismatch"));
  });
});

test("decision queries rebuild stale projection when active decision exists only on disk", () => {
  withProjectionPair((rootDir) => {
    seedHarness(rootDir);
    rebuildTaskProjection({ rootDir });

    writeDecision(rootDir, false, "dec_W6_DISK_ONLY");
    const result = queryDecisionProjection({ rootDir, filters: { state: "active" } });

    assert.equal(result.rows.some((row) => row.decisionId === "dec_W6_DISK_ONLY"), true);
    assert.equal(result.warnings.some((warning) => warning.code === "projection_stale"), true);
  });
});

function withProjectionPair(fn: (incrementalRoot: string, rebuildRoot: string) => void): void {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-incremental-projection-"));
  try {
    fn(path.join(rootDir, "incremental"), path.join(rootDir, "rebuild"));
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function seedHarness(rootDir: string): void {
  for (const taskId of ["task-a", "task-b", "task-c"]) {
    writeIndex(rootDir, taskId, `Task ${taskId}`, "active", []);
  }
  writeFacts(rootDir, "task-a", true);
  writeDecision(rootDir, false);
}

function writeAttributionEvent(rootDir: string, eventId: string, entityId: string): string {
  const eventRoot = path.join(rootDir, "harness/attribution-events");
  mkdirSync(eventRoot, { recursive: true });
  const eventPath = path.join(eventRoot, `${eventId}.jsonl`);
  writeFileSync(eventPath, `${JSON.stringify({
    schema: "attribution-event/v1",
    eventId,
    opId: `op-${eventId}`,
    journalRecordSchema: "write-journal/v2",
    entityId,
    kind: "progress_append",
    actor: {
      principal: { kind: "person", personId: "person_test" },
      executor: { kind: "agent", id: "agent_test" }
    },
    principalSource: {
      kind: "local-configured",
      authority: "harness.yaml",
      authoritySha256: `sha256:${"0".repeat(64)}`
    },
    executorSource: "client-asserted",
    at: "2026-07-07T00:00:00.000Z",
    recordedAt: "2026-07-07T00:00:01.000Z",
    payloadHash: `sha256:${"1".repeat(64)}`,
    payloadRef: {
      path: `.harness/payloads/${eventId}.json`,
      sha256: `sha256:${"1".repeat(64)}`
    }
  })}\n`, "utf8");
  stamp(eventPath);
  return eventPath;
}

function applyRandomProjectionWrite(rootDir: string, operation: number, taskId: string, step: number, seed: number): ReadonlyArray<string> {
  switch (operation) {
    case 0: {
      const target = taskId === "task-c" ? "task-a" : "task-c";
      const relations = step % 2 === 0 ? [relation(`task/${taskId}`, `task/${target}`, "depends-on", `step ${step}`)] : [];
      return [writeIndex(rootDir, taskId, `Task ${taskId} ${seed}-${step}`, statusFor(step), relations)];
    }
    case 1:
      return [writeModule(rootDir, taskId, `module-${seed % 5}`, `Module ${step}`)];
    case 2:
      return [writeCloseout(rootDir, taskId, step % 2 === 0)];
    case 3:
      return [writeFacts(rootDir, taskId, step % 3 !== 0)];
    default:
      return [writeDecision(rootDir, step % 2 === 0)];
  }
}

function snapshotProjection(rootDir: string, label: string): unknown {
  const tasks = readTaskProjection({ rootDir });
  const decisions = queryDecisionProjection({ rootDir, filters: {} });
  const graph = readRelationGraphProjection({ rootDir });
  assert.equal(tasks.warnings.every((warning) => warning.severity !== "hard-fail"), true, `${label} ${rootDir}: ${JSON.stringify(tasks.warnings)}`);
  assert.equal(decisions.warnings.every((warning) => warning.severity !== "hard-fail"), true, `${label} ${rootDir}: ${JSON.stringify(decisions.warnings)}`);
  assert.equal(graph.warnings.every((warning) => warning.severity !== "hard-fail"), true, `${label} ${rootDir}: ${JSON.stringify(graph.warnings)}`);
  return {
    tasks: tasks.rows,
    decisions: decisions.rows,
    edges: graph.edges,
    coverageRows: graph.coverageRows,
    factAnchors: graph.factAnchors
  };
}

function writeIndex(
  rootDir: string,
  taskId: string,
  title: string,
  status: string,
  relations: ReadonlyArray<EntityRelationRecord>,
  packageSlug = taskId
): string {
  const taskDir = path.join(rootDir, "harness/tasks", packageSlug);
  mkdirSync(taskDir, { recursive: true });
  const indexPath = path.join(taskDir, "INDEX.md");
  writeFileSync(indexPath, [
    "---",
    "schema: task-package/v2",
    `task_id: ${taskId}`,
    `title: ${title}`,
    "lifecycle:",
    "  bindingSchema: lifecycle-binding/v1",
    "  engine: local",
    `  status: ${status}`,
    "  ref: ",
    `  titleSnapshot: ${title}`,
    "  url: ",
    "  bindingCreatedAt: 2026-07-07T00:00:00.000Z",
    "  bindingFingerprint: sha256:fixture",
    "packageDisposition: active",
    "vertical: default",
    "preset: default",
    ...(relations.length > 0 ? ["relations:", ...relations.map(formatRelationFlowRecord)] : []),
    "---",
    "",
    `# ${title}`,
    ""
  ].join("\n"));
  stamp(indexPath);
  return indexPath;
}

function writeModule(rootDir: string, taskId: string, moduleKey: string, moduleTitle: string): string {
  const modulePath = path.join(rootDir, "harness/tasks", taskId, "module.md");
  mkdirSync(path.dirname(modulePath), { recursive: true });
  writeFileSync(modulePath, [`Module key: ${moduleKey}`, `Module title: ${moduleTitle}`, ""].join("\n"));
  stamp(modulePath);
  return modulePath;
}

function writeCloseout(rootDir: string, taskId: string, present: boolean): string {
  const closeoutPath = path.join(rootDir, "harness/tasks", taskId, "closeout.md");
  if (present) {
    mkdirSync(path.dirname(closeoutPath), { recursive: true });
    writeFileSync(closeoutPath, `# Closeout ${taskId}\n`);
    stamp(closeoutPath);
  } else {
    rmSync(closeoutPath, { force: true });
  }
  return closeoutPath;
}

function writeFacts(rootDir: string, taskId: string, includeRelation: boolean): string {
  const factsPath = path.join(rootDir, "harness/tasks", taskId, "facts.md");
  mkdirSync(path.dirname(factsPath), { recursive: true });
  const factRef = `fact/${taskId}/F-DEADBEEF`;
  writeFileSync(factsPath, [
    "# Facts",
    "",
    "- {fact_id: F-DEADBEEF, statement: \"Incremental projection fact.\", source: \"test\", observedAt: \"2026-07-07T00:00:00.000Z\", confidence: high, memoryClass: episodic, memoryTags: [], provenance: [{runtime: \"node-test\", sessionId: \"sqlite-incremental\", boundAt: \"2026-07-07T00:00:00.000Z\"}]}",
    ...(includeRelation ? [
      "",
      "relations:",
      formatRelationFlowRecord(relation(factRef, "decision/dec_W6_INCREMENTAL/CH1", "supports", `fact ${taskId} supports decision`))
    ] : []),
    ""
  ].join("\n"));
  stamp(factsPath);
  return factsPath;
}

function writeDecision(rootDir: string, includeRelation: boolean, decisionId = "dec_W6_INCREMENTAL"): string {
  const decisionDir = path.join(rootDir, "harness/decisions", `decision-${decisionId}`);
  mkdirSync(decisionDir, { recursive: true });
  const decisionPath = path.join(decisionDir, "decision.md");
  writeFileSync(decisionPath, [
    "---",
    "schema: decision-package/v1",
    `decision_id: ${decisionId}`,
    `_coordinatorWatermark: wm-${decisionId}`,
    `title: W6 incremental projection decision ${decisionId}`,
    "state: active",
    "riskTier: medium",
    "urgency: medium",
    "vertical: \"software/coding\"",
    "preset: \"architecture-decision\"",
    "applies_to:",
    "  modules: [\"projection\"]",
    "  productLines: []",
    "proposedBy: { kind: \"agent\", id: \"test\" }",
    "proposedAt: \"2026-07-07T00:00:00.000Z\"",
    "arbiter: { kind: \"human\", id: \"test\" }",
    "decidedAt: \"2026-07-07T00:00:00.000Z\"",
    "provenance:",
    "  - { runtime: \"node-test\", sessionId: \"sqlite-incremental\", boundAt: \"2026-07-07T00:00:00.000Z\" }",
    "question: \"Should incremental projection match full rebuild?\"",
    "chosen:",
    "  - { id: \"CH1\", text: \"Use incremental projection\" }",
    "rejected:",
    "  - { id: \"RJ1\", text: \"Trust stale cache\", why_not: \"SQLite is derived\" }",
    "claims:",
    "  - { id: \"C1\", text: \"Incremental equals rebuild\" }",
    "relations:",
    ...(includeRelation ? [
      formatRelationFlowRecord(relation(`decision/${decisionId}/CH1`, "fact/task-a/F-DEADBEEF", "evidenced-by", "decision evidence edge"))
    ] : []),
    "---",
    "",
    `# W6 incremental projection decision ${decisionId}`,
    ""
  ].join("\n"));
  stamp(decisionPath);
  return decisionPath;
}

function relation(source: string, target: string, type: EntityRelationRecord["type"], rationale: string): EntityRelationRecord {
  const base = {
    source,
    target,
    type,
    direction: "directed" as const
  };
  return {
    relation_id: deriveRelationId(base),
    ...base,
    strength: "strong",
    origin: "declared",
    rationale,
    state: "active"
  };
}

function statusFor(step: number): string {
  return ["planned", "active", "blocked", "in_review", "done"][step % 5] ?? "active";
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function stamp(filePath: string): void {
  const fixed = new Date("2026-07-07T00:00:00.000Z");
  utimesSync(filePath, fixed, fixed);
}
