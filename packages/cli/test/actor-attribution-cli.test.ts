import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureTestHarnessIdentity } from "./helpers/git-fixtures.ts";
import { unwrapCommandReceipt } from "./helpers/receipt.ts";

const cliEntry = path.resolve("packages/cli/src/index.ts");
const taskIdPattern = /^task_[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/u;

test("CLI write commands require explicit local actor attribution", () => {
  withTempRoot((rootDir) => {
    const result = runJson(rootDir, ["new-task", "--title", "No Actor"], false, withoutActorAttributionEnv());

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "write_rejected");
    assert.match(result.error?.hint ?? "", /Local CLI writes require explicit actor attribution/u);
    assert.equal(existsSync(path.join(rootDir, "harness/tasks")), false);
  });
});

test("CLI rejects inherited human actor attribution with an executable flag migration hint", () => {
  withTempRoot((rootDir) => {
    const result = runJson(rootDir, ["init"], false, actorEnv("human:person_alice", "Alice Owner", "alice@example.test"));

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "AuthMissing");
    assert.match(result.error?.hint ?? "", /--actor human:person_alice/u);
    assert.match(result.error?.hint ?? "", /ha\(\) \{ command ha --actor human:person_alice "\$@"; \}/u);
    assert.equal(existsSync(path.join(rootDir, "harness/tasks")), false);
  });
});

test("CLI accepts explicit human flag despite an inherited human environment value", () => {
  withTempRoot((rootDir) => {
    const env = actorEnv("human:inherited_parent", "Alice Owner", "alice@example.test");
    const result = runJson(rootDir, ["--actor", "human:person_alice", "init"], true, env);

    assert.equal(result.ok, true);
    assert.equal(existsSync(path.join(rootDir, "harness")), true);
  });
});

test("CLI also accepts an agent actor through the explicit flag", () => {
  withTempRoot((rootDir) => {
    const env = actorEnv("", "Codex Writer", "codex@example.test");
    const result = runJson(rootDir, ["--actor", "agent:codex", "init"], true, env);

    assert.equal(result.ok, true);
    assert.equal(existsSync(path.join(rootDir, "harness")), true);
  });
});

test("CLI keeps agent and system HARNESS_ACTOR channels working", () => {
  for (const actor of ["agent:codex", "system:release-bot"]) {
    withTempRoot((rootDir) => {
      const result = runJson(rootDir, ["init"], true, actorEnv(actor, "Harness Writer", "writer@example.test"));

      assert.equal(result.ok, true, actor);
      assert.equal(existsSync(path.join(rootDir, "harness")), true, actor);
    });
  }
});

test("CLI persists env and flag actor sources in the write journal", () => {
  for (const fixture of [
    { actor: "agent:codex", source: "env", args: ["new-task", "--title", "Env Source"] },
    { actor: "human:person_alice", source: "flag", args: ["--actor", "human:person_alice", "new-task", "--title", "Flag Source"] }
  ] as const) {
    withTempRoot((rootDir) => {
      const env = actorEnv(
        fixture.source === "env" ? fixture.actor : "human:inherited_parent",
        "Harness Writer",
        "writer@example.test"
      );
      runJson(rootDir, ["--actor", "human:setup", "init"], true, env);
      installStaleGlobalLock(rootDir);

      const result = runJson(rootDir, fixture.args, true, env);
      const journal = readFileSync(path.join(rootDir, ".harness/write-journal/writes.jsonl"), "utf8");

      assertGeneratedTaskId(result.taskId);
      assert.match(journal, new RegExp(`"actor":\\{"kind":"${fixture.actor.split(":")[0]}","id":"${fixture.actor.split(":")[1]}","source":"${fixture.source}"\\}`, "u"));
    });
  }
});

test("CLI checker reports the two retained inherited-human decision records and accepts compliant records", () => {
  withTempRoot((rootDir) => {
    const env = actorEnv("agent:checker-setup", "Harness Checker", "checker@example.test");
    runJson(rootDir, ["init"], true, env);
    const journalPath = path.join(rootDir, ".harness/write-journal/writes.jsonl");
    mkdirSync(path.dirname(journalPath), { recursive: true });
    writeFileSync(journalPath, [
      journalRecord("1783569188028-50553f50-f2d0970d66929820", "decision/dec_mrcz1kqh", "human", "zeyuli", "env"),
      journalRecord("1783569241103-9d404e49-5f0e69aed277e433", "decision/dec_mrcz2q6k", "human", "zeyuli", "env")
    ].join("\n") + "\n", "utf8");

    const failed = runJson(rootDir, ["check", "--profile", "source-package"], false, env);
    const findings = (failed.warnings as ReadonlyArray<Record<string, unknown>>)
      .filter((warning) => warning.source === "actor-attribution-checker");

    assert.equal(failed.ok, false);
    assert.equal(findings.length, 2);
    assert.equal(findings.every((finding) => finding.code === "human_actor_from_inherited_env"), true);
    assert.equal(findings.some((finding) => String(finding.message).includes("dec_mrcz1kqh")), true);
    assert.equal(findings.some((finding) => String(finding.message).includes("dec_mrcz2q6k")), true);

    writeFileSync(journalPath, [
      journalRecord("op-agent-env", "task/task_agent", "agent", "codex", "env"),
      journalRecord("op-human-flag", "task/task_human", "human", "person_alice", "flag")
    ].join("\n") + "\n", "utf8");

    const passed = runJson(rootDir, ["check", "--profile", "source-package"], true, env);
    assert.equal(passed.ok, true);
    assert.equal((passed.warnings as ReadonlyArray<Record<string, unknown>>)
      .some((warning) => warning.source === "actor-attribution-checker"), false);
  });
});

test("CLI local writes preserve distinct git authors for distinct actors", () => {
  withTempRoot((rootDir) => {
    const aliceEnv = actorEnv("", "Alice Owner", "alice@example.test");
    const bobEnv = actorEnv("", "Bob Builder", "bob@example.test");
    runJson(rootDir, ["--actor", "human:person_alice", "init"], true, aliceEnv);
    const alice = runJson(rootDir, ["--actor", "human:person_alice", "new-task", "--title", "Alice Authored"], true, aliceEnv);
    const bob = runJson(rootDir, ["--actor", "human:person_bob", "new-task", "--title", "Bob Authored"], true, bobEnv);

    assertGeneratedTaskId(alice.taskId);
    assertGeneratedTaskId(bob.taskId);
    const authors = git(path.join(rootDir, "harness"), ["log", "--format=%an <%ae>"]).split(/\r?\n/u);
    assert.equal(authors.includes("Alice Owner <alice@example.test>"), true);
    assert.equal(authors.includes("Bob Builder <bob@example.test>"), true);
  });
});

function assertGeneratedTaskId(value: unknown): string {
  assert.equal(typeof value, "string");
  assert.match(value, taskIdPattern);
  return value;
}

function withTempRoot<T>(fn: (rootDir: string) => T): T {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-cli-"));
  try {
    ensureTestHarnessIdentity(rootDir);
    return fn(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function runJson(rootDir: string, args: ReadonlyArray<string>, expectSuccess = true, env: Readonly<Record<string, string>> = {}): Record<string, any> {
  try {
    const stdout = execFileSync(process.execPath, [cliEntry, "--root", rootDir, "--json", ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env }
    });
    return unwrapCommandReceipt(JSON.parse(stdout) as Record<string, any>);
  } catch (error) {
    if (expectSuccess) throw error;
    const failure = error as { readonly stdout?: string };
    return unwrapCommandReceipt(JSON.parse(failure.stdout ?? "{}") as Record<string, any>);
  }
}

function actorEnv(actor: string, name: string, email: string): Readonly<Record<string, string>> {
  return {
    HARNESS_ACTOR: actor,
    HARNESS_GIT_AUTHOR_NAME: name,
    HARNESS_GIT_AUTHOR_EMAIL: email
  };
}

function installStaleGlobalLock(rootDir: string): void {
  const lockDir = path.join(rootDir, ".harness/locks");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(path.join(lockDir, "global.lock"), JSON.stringify({
    pid: 999_999,
    hostname: hostname(),
    acquiredAt: "2000-01-01T00:00:00.000Z",
    heartbeatAt: "2000-01-01T00:00:00.000Z",
    ownerToken: "stale-actor-source-fixture"
  }), "utf8");
}

function journalRecord(opId: string, entityId: string, kind: string, id: string, source: string): string {
  return JSON.stringify({
    schema: "write-journal/v1",
    opId,
    entityId,
    kind: "decision_propose",
    actor: { kind, id, source },
    at: "2026-07-09T03:54:01.100Z"
  });
}

function withoutActorAttributionEnv(): Readonly<Record<string, string>> {
  return {
    HARNESS_ACTOR: "",
    HARNESS_GIT_AUTHOR_NAME: "",
    HARNESS_GIT_AUTHOR_EMAIL: "",
    GIT_AUTHOR_NAME: "",
    GIT_AUTHOR_EMAIL: ""
  };
}

function git(rootDir: string, args: ReadonlyArray<string>): string {
  return execFileSync("git", ["-C", rootDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}
