import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ExecutionEvidenceIdentity {
  readonly taskId: string;
  readonly executionId: string;
}

export function ids(index: number): ExecutionEvidenceIdentity {
  const suffix = String(index).padStart(26, "0");
  return { taskId: `task_${suffix}`, executionId: `exe_${suffix}` };
}

export function withExecutionEvidenceHarness(run: (rootDir: string) => void): void {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-execution-evidence-"));
  try {
    run(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

export function writeExecutionEvidenceTask(rootDir: string, taskId: string, title: string): void {
  const taskRoot = path.join(rootDir, "harness/tasks", taskId);
  mkdirSync(taskRoot, { recursive: true });
  writeFileSync(path.join(taskRoot, "INDEX.md"), [
    "---",
    "schema: task-package/v2",
    `task_id: ${taskId}`,
    `title: ${title}`,
    "lifecycle:",
    "  bindingSchema: lifecycle-binding/v1",
    "  engine: local",
    "  status: active",
    "  ref: ",
    `  titleSnapshot: ${title}`,
    "  url: ",
    "  bindingCreatedAt: 2026-07-13T00:00:00.000Z",
    "  bindingFingerprint: sha256:fixture",
    "packageDisposition: active",
    "vertical: default",
    "preset: default",
    "---",
    "",
    `# ${title}`,
    ""
  ].join("\n"), "utf8");
}

export function writeExecutionEvidence(
  rootDir: string,
  taskId: string,
  executionId: string,
  submittedAt: string,
  outputs: ReadonlyArray<unknown>,
  executorId = "codex"
): string {
  const executionRoot = path.join(rootDir, "harness/tasks", taskId, "executions");
  mkdirSync(executionRoot, { recursive: true });
  const executionPath = path.join(executionRoot, `${executionId}.md`);
  writeFileSync(executionPath, `${JSON.stringify({
    schema: "execution/v2",
    execution_id: executionId,
    task_ref: `task/${taskId}`,
    state: "submitted",
    primary_actor: {
      principal: { personId: "person_test" },
      executor: { kind: "agent", id: executorId },
      responsibleHuman: "person_test"
    },
    claimed_at: submittedAt,
    submitted_at: submittedAt,
    closed_at: null,
    session_bindings: [],
    outputs,
    submission: null
  }, null, 2)}\n`, "utf8");
  return executionPath;
}

export function inlineExecutionEvidenceOutput(
  identity: ExecutionEvidenceIdentity,
  evidenceId: string,
  text: string
): unknown {
  return {
    evidence_id: evidenceId,
    execution_ref: `execution/${identity.taskId}/${identity.executionId}`,
    locator: { substrate: "inline", text },
    checker_receipt_ref: `${evidenceId.includes("first") ? "" : evidenceId === "ev-inline" ? "ev-receipt" : ""}` || undefined
  };
}

export function fileExecutionEvidenceOutput(
  identity: ExecutionEvidenceIdentity,
  evidenceId: string,
  filePath: string
): unknown {
  return {
    evidence_id: evidenceId,
    execution_ref: `execution/${identity.taskId}/${identity.executionId}`,
    locator: { substrate: "file", path: filePath }
  };
}

export function checkerExecutionEvidenceOutput(
  identity: ExecutionEvidenceIdentity,
  evidenceId: string,
  targetEvidenceId: string,
  result: "pass" | "fail"
): unknown {
  return {
    evidence_id: evidenceId,
    execution_ref: `execution/${identity.taskId}/${identity.executionId}`,
    locator: {
      substrate: "checker_receipt",
      receipt: {
        checker_id: "test-checker",
        checker_version: "1",
        target_evidence_id: targetEvidenceId,
        target_sha256: null,
        checked_at: "2026-07-13T00:10:00.000Z",
        result
      }
    }
  };
}

export function openFullProjection(rootDir: string, readOnly = true): DatabaseSync {
  return new DatabaseSync(path.join(rootDir, ".harness/cache/projections.sqlite"), { readOnly });
}

export function openExecutionEvidenceProjection(rootDir: string, readOnly = true): DatabaseSync {
  return new DatabaseSync(path.join(rootDir, ".harness/cache/execution-evidence.sqlite"), { readOnly });
}
