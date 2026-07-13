// harness-test-tier: integration
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { makeJournaledWriteCoordinator, sha256Text, type WriteCoordinator, type WriteOp } from "../../kernel/src/index.ts";
import { createCanonicalScriptStage, remapScope, ScriptStageScopeError, scriptIngestOp } from "../src/commands/extensions/script-staging.ts";
import { listGeneratedFiles } from "../src/commands/extensions/script-scope.ts";
import { initializeNestedHarnessRepo } from "./helpers/git-fixtures.ts";

const commitAuthor = { name: "Harness Test", email: "harness@example.test" };

test("script ingest rejects a canonical file created after staging instead of overwriting it", () => {
  withFixture(({ rootDir, outputRoot, targetPath }) => {
    const stage = createCanonicalScriptStage(rootDir, path.join(rootDir, ".harness/runs/create-race"), outputRoot);
    const stagedTarget = path.join(stage.outputRoot, "snapshot.json");
    write(stagedTarget, "script result\n");

    write(targetPath, "concurrent creator\n");
    commitHarness(rootDir, "concurrent create");

    const op = requiredIngestOp(stage, "create-race");
    assert.equal(firstWrite(op).baseBlobSha256, null);

    assertCoordinatorRejects(rootDir, op, "snapshot.json");
    assert.equal(readFileSync(targetPath, "utf8"), "concurrent creator\n");
  });
});

test("script ingest rejects a canonical file modified after staging instead of overwriting it", () => {
  withFixture(({ rootDir, outputRoot, targetPath }) => {
    write(targetPath, "staged base\n");
    commitHarness(rootDir, "seed canonical base");

    const stage = createCanonicalScriptStage(rootDir, path.join(rootDir, ".harness/runs/modify-race"), outputRoot);
    write(path.join(stage.outputRoot, "snapshot.json"), "script result\n");

    write(targetPath, "concurrent modifier\n");
    commitHarness(rootDir, "concurrent modify");

    const op = requiredIngestOp(stage, "modify-race");
    assert.equal(firstWrite(op).baseBlobSha256, sha256Text("staged base\n"));

    assertCoordinatorRejects(rootDir, op, "snapshot.json");
    assert.equal(readFileSync(targetPath, "utf8"), "concurrent modifier\n");
  });
});

test("canonical stage construction rejects a protected recursive scope containing a symlink", {
  skip: process.platform === "win32"
}, () => {
  withFixture(({ rootDir, outputRoot }) => {
    const externalRoot = path.join(rootDir, "external-stage-target");
    mkdirSync(outputRoot, { recursive: true });
    mkdirSync(externalRoot, { recursive: true });
    symlinkSync(externalRoot, path.join(outputRoot, "escape"));

    assert.throws(() => createCanonicalScriptStage(
      rootDir,
      path.join(rootDir, ".harness/runs/symlink-stage"),
      outputRoot,
      {
        protectedScopes: [{
          mode: "write",
          scope: {
            roots: [outputRoot],
            permissions: [outputRoot, `${outputRoot}/**`]
          }
        }]
      }
    ), (error: unknown) => (
      error instanceof ScriptStageScopeError &&
      error.code === "script_stage_scope_symlink"
    ));
  });
});

test("canonical stage construction rejects a protected non-recursive file swapped to a symlink", {
  skip: process.platform === "win32"
}, () => {
  withFixture(({ rootDir, outputRoot }) => {
    const externalFile = path.join(rootDir, "external-stage-file.txt");
    const declaredFile = path.join(outputRoot, "receipt.json");
    write(externalFile, "outside\n");
    mkdirSync(outputRoot, { recursive: true });
    symlinkSync(externalFile, declaredFile);

    assert.throws(() => createCanonicalScriptStage(
      rootDir,
      path.join(rootDir, ".harness/runs/exact-symlink-stage"),
      outputRoot,
      {
        protectedScopes: [{
          mode: "write",
          scope: { roots: [declaredFile], permissions: [declaredFile] }
        }]
      }
    ), (error: unknown) => error instanceof ScriptStageScopeError);
  });
});

test("generated-file discovery never follows a symlinked root", {
  skip: process.platform === "win32"
}, () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-script-list-symlink-"));
  try {
    const externalRoot = path.join(rootDir, "external");
    const linkedRoot = path.join(rootDir, "linked");
    mkdirSync(externalRoot, { recursive: true });
    write(path.join(externalRoot, "artifact.txt"), "must not be discovered\n");
    symlinkSync(externalRoot, linkedRoot);

    assert.deepEqual(listGeneratedFiles(linkedRoot), []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("stage scope remapping preserves a non-recursive permission boundary", () => {
  withFixture(({ rootDir, outputRoot }) => {
    mkdirSync(outputRoot, { recursive: true });
    const declaredFile = path.join(outputRoot, "receipt.json");
    write(declaredFile, "base\n");
    const stage = createCanonicalScriptStage(
      rootDir,
      path.join(rootDir, ".harness/runs/non-recursive-scope"),
      outputRoot
    );

    const remapped = remapScope(stage, {
      roots: [declaredFile],
      permissions: [declaredFile]
    }, { retainOriginalPermissions: false });

    assert.equal(remapped.permissions.includes(path.join(stage.outputRoot, "receipt.json")), true);
    assert.equal(remapped.permissions.some((permission) => permission.endsWith("/**")), false);
  });
});

function withFixture(run: (fixture: {
  readonly rootDir: string;
  readonly outputRoot: string;
  readonly targetPath: string;
}) => void): void {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-script-staging-cas-"));
  try {
    initializeNestedHarnessRepo(rootDir);
    const outputRoot = path.join(rootDir, "harness/tasks/task-cas/artifacts/architecture");
    run({ rootDir, outputRoot, targetPath: path.join(outputRoot, "snapshot.json") });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function requiredIngestOp(
  stage: ReturnType<typeof createCanonicalScriptStage>,
  operationId: string
): WriteOp {
  const op = scriptIngestOp(stage, [stage.outputRoot], operationId);
  assert.ok(op, "staged script write must produce an ingest op");
  return op;
}

function firstWrite(op: WriteOp): { readonly baseBlobSha256: string | null } {
  const payload = op.payload as { readonly writes?: ReadonlyArray<{ readonly baseBlobSha256: string | null }> };
  assert.equal(payload.writes?.length, 1);
  const write = payload.writes?.[0];
  assert.ok(write);
  return write;
}

function assertCoordinatorRejects(rootDir: string, op: WriteOp, expectedPath: string): void {
  const result = Effect.runSync(Effect.either(attributedCoordinator(rootDir).enqueue(op)));
  assert.equal(result._tag, "Left");
  if (result._tag === "Left") {
    assert.equal(result.left._tag, "WriteRejected");
    assert.match(String(result.left.reason), new RegExp(`canonical authored base changed before script_ingest: .*${expectedPath}`));
  }
}

function attributedCoordinator(rootDir: string): WriteCoordinator {
  return makeJournaledWriteCoordinator({
    rootDir,
    attribution: {
      actor: {
        principal: { kind: "person", personId: "person_test" },
        executor: { kind: "agent", id: "codex-test" }
      },
      principalSource: {
        kind: "local-configured",
        authority: "harness.yaml",
        authoritySha256: `sha256:${"0".repeat(64)}`
      },
      executorSource: "client-asserted"
    },
    commitAuthor
  });
}

function write(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
}

function commitHarness(rootDir: string, message: string): void {
  const harnessRoot = path.join(rootDir, "harness");
  execFileSync("git", ["-C", harnessRoot, "add", "."]);
  execFileSync("git", ["-C", harnessRoot, "commit", "-m", message], { stdio: "ignore" });
}
