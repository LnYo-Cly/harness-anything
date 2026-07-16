// harness-test-tier: integration
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDaemonReconcileState,
  reconcileDaemonRepoRegistry,
  type DaemonRepoReconcileAdapter
} from "../src/daemon/registry-reconciler.ts";
import { ensureTestHarnessIdentity } from "./helpers/git-fixtures.ts";

const cliEntry = path.resolve("packages/cli/src/index.ts");

test("registry reconciler isolates attach, bind, detach, and retry failures by repo", async () => {
  const desiredRepos = ["attach-bad", "retry-bad", "bind-bad", "healthy"].map((repoId) => ({
    repoId,
    canonicalRoot: `/repos/${repoId}`,
    displayName: repoId,
    state: "enabled" as const,
    registeredAt: "2026-07-16T08:00:00.000Z"
  }));
  const known = new Set(["retry-bad", "bind-bad", "healthy", "detach-bad", "detach-good"]);
  const statuses = new Map<string, { state: string; lastError?: string }>([
    ["retry-bad", { state: "unavailable", lastError: "retry unavailable" }],
    ["bind-bad", { state: "attached" }],
    ["healthy", { state: "attached" }],
    ["detach-bad", { state: "attached" }],
    ["detach-good", { state: "attached" }]
  ]);
  const bound: string[] = [];
  const removed: string[] = [];
  let injectFailures = true;
  const adapter: DaemonRepoReconcileAdapter = {
    loadDesiredRepos: () => desiredRepos,
    knownRepoIds: () => [...known],
    repoStatus: (repoId: string) => statuses.get(repoId),
    attachRepo: async (repo) => {
      known.add(repo.repoId);
      if (injectFailures && (repo.repoId === "attach-bad" || repo.repoId === "retry-bad")) {
        throw new Error(`${repo.repoId} attach failure`);
      }
      const status = { state: "attached" };
      statuses.set(repo.repoId, status);
      return status;
    },
    bindRepo: (repo) => {
      if (injectFailures && repo.repoId === "bind-bad") throw new Error("bind failure");
      bound.push(repo.repoId);
    },
    detachRepo: async (repoId: string) => {
      if (injectFailures && repoId === "detach-bad") throw new Error("detach failure");
      statuses.set(repoId, { state: "detached" });
    },
    removeRepo: (repoId: string) => {
      known.delete(repoId);
      removed.push(repoId);
    },
    now: () => new Date("2026-07-16T08:30:00.000Z")
  };
  const state = createDaemonReconcileState();

  await reconcileDaemonRepoRegistry(adapter, state);

  assert.deepEqual([...state.repoErrors.keys()].sort(), ["attach-bad", "bind-bad", "detach-bad", "retry-bad"]);
  assert.deepEqual(bound, ["healthy"]);
  assert.deepEqual(removed, ["detach-good"]);
  assert.equal(known.has("detach-bad"), true);
  assert.equal(state.lastReconcileError?.repoId, "detach-bad");
  assert.match(state.repoErrors.get("retry-bad")?.message ?? "", /^retry failed:/u);

  injectFailures = false;
  await reconcileDaemonRepoRegistry(adapter, state);

  assert.equal(state.repoErrors.size, 0);
  assert.equal(state.lastReconcileError, null);
  assert.deepEqual(removed, ["detach-good", "detach-bad"]);
  assert.equal(bound.includes("healthy"), true);
  assert.equal(bound.includes("attach-bad"), true);
  assert.equal(bound.includes("retry-bad"), true);
  assert.equal(bound.includes("bind-bad"), true);
});

test("daemon client routes writes for two registered repos through one user-level daemon", () => {
  withTempRoot((workspaceRoot) => {
    const { userRoot, alphaRoot, betaRoot } = setupRegisteredRepos(workspaceRoot);

    try {
      const alphaCreated = runRawJson(alphaRoot, ["new-task", "--title", "Alpha Routed Write"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "60000"
      });
      const betaCreated = runRawJson(betaRoot, ["new-task", "--title", "Beta Routed Write"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "60000"
      });

      assert.equal(alphaCreated.ok, true);
      assert.equal(betaCreated.ok, true);
      assert.equal(receiptActorPersonId(alphaCreated), "person_alpha");
      assert.equal(receiptActorPersonId(betaCreated), "person_beta");
      const alphaTaskId = receiptTaskId(alphaCreated);
      const betaTaskId = receiptTaskId(betaCreated);
      assertTaskIndexContains(alphaRoot, alphaTaskId, "alpha-routed-write", "Alpha Routed Write");
      assertTaskIndexContains(betaRoot, betaTaskId, "beta-routed-write", "Beta Routed Write");
      assert.equal(existsSync(path.join(betaRoot, `harness/tasks/${alphaTaskId}-alpha-routed-write/INDEX.md`)), false);
      assert.equal(existsSync(path.join(alphaRoot, `harness/tasks/${betaTaskId}-beta-routed-write/INDEX.md`)), false);

      const alphaStatus = runDaemonCommand(alphaRoot, ["daemon", "status", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      const betaStatus = runDaemonCommand(betaRoot, ["daemon", "status", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      assert.equal(alphaStatus.started, true);
      assert.equal(betaStatus.started, true);
      assert.equal(alphaStatus.pid, betaStatus.pid);
      assert.deepEqual((alphaStatus.repos as Array<{ repoId: string }>).map((repo) => repo.repoId), ["alpha", "beta"]);
    } finally {
      stopDaemonQuietly(betaRoot, userRoot);
    }
  });
});

test("isolated profile bootstraps machine identity and writes the first task in a new repo", () => {
  withTempRoot((rootDir) => {
    mkdirSync(rootDir, { recursive: true });
    const isolatedEnv = {
      HARNESS_BOOTSTRAP_MACHINE_IDENTITY: "1",
      HARNESS_DAEMON_MODE: "direct",
      HARNESS_DAEMON_PROFILE: "isolated",
      HARNESS_DAEMON_USER_ROOT: ""
    };
    runRawJson(rootDir, ["--daemon-profile", "isolated", "init"], isolatedEnv);
    const userRoot = path.join(rootDir, ".harness/daemon-profile");
    assert.equal(existsSync(path.join(userRoot, "people.yaml")), true);
    runDaemonCommand(rootDir, [
      "--daemon-profile", "isolated", "daemon", "repo", "register",
      "--repo-id", "coldstart", "--root", rootDir, "--no-link", "--json"
    ], { HARNESS_DAEMON_PROFILE: "isolated", HARNESS_DAEMON_USER_ROOT: "" });
    assert.equal(existsSync(path.join(userRoot, "registry.json")), true);

    try {
      const created = runRawJson(rootDir, ["--daemon-profile", "isolated", "new-task", "--title", "Cold Start First Task"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_PROFILE: "isolated",
        HARNESS_DAEMON_USER_ROOT: "",
        HARNESS_DAEMON_IDLE_MS: "60000"
      });
      assert.equal(created.ok, true);
      assert.equal(typeof receiptActorPersonId(created), "string");
      assertTaskIndexContains(rootDir, receiptTaskId(created), "cold-start-first-task", "Cold Start First Task");
    } finally {
      stopDaemonQuietly(rootDir, userRoot);
    }
  });
});

test("registering a new tmp repo cannot replace the canonical daemon or break canonical writes", { skip: process.platform === "win32" }, async () => {
  await withTempRootAsync(async (workspaceRoot) => {
    const userRoot = path.join(workspaceRoot, "user-daemon");
    const canonicalRoot = path.join(workspaceRoot, "canonical");
    const experimentRoot = path.join(workspaceRoot, "coldstart-experiment");
    mkdirSync(canonicalRoot, { recursive: true });
    ensureTestHarnessIdentity(canonicalRoot);
    runRawJson(canonicalRoot, ["init"], { HARNESS_DAEMON_MODE: "direct", HARNESS_DAEMON_USER_ROOT: userRoot });
    writePeopleRoster(canonicalRoot, "person_canonical");
    runDaemonCommand(canonicalRoot, ["daemon", "repo", "register", "--repo-id", "canonical", "--root", canonicalRoot, "--user-root", userRoot, "--no-link", "--json"], {
      HARNESS_DAEMON_USER_ROOT: userRoot
    });

    try {
      const before = runRawJson(canonicalRoot, ["new-task", "--title", "Canonical Before Experiment"], {
        HARNESS_DAEMON_MODE: "local", HARNESS_DAEMON_USER_ROOT: userRoot, HARNESS_DAEMON_IDLE_MS: "60000"
      });
      const beforeStatus = runDaemonCommand(canonicalRoot, ["daemon", "status", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });

      mkdirSync(experimentRoot, { recursive: true });
      ensureTestHarnessIdentity(experimentRoot);
      runRawJson(experimentRoot, ["init"], { HARNESS_DAEMON_MODE: "direct", HARNESS_DAEMON_USER_ROOT: userRoot });
      writePeopleRoster(experimentRoot, "person_experiment");
      runDaemonCommand(experimentRoot, ["daemon", "repo", "register", "--repo-id", "experiment", "--root", experimentRoot, "--user-root", userRoot, "--no-link", "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      const reconciled = await waitForRepoState(canonicalRoot, userRoot, "canonical", "experiment", "attached");
      const after = runRawJson(canonicalRoot, ["new-task", "--title", "Canonical After Experiment"], {
        HARNESS_DAEMON_MODE: "local", HARNESS_DAEMON_USER_ROOT: userRoot, HARNESS_DAEMON_IDLE_MS: "60000"
      });

      assert.equal(before.ok, true);
      assert.equal(after.ok, true);
      assert.equal(receiptActorPersonId(after), "person_canonical");
      assert.equal(reconciled.pid, beforeStatus.pid);
      assertTaskIndexContains(canonicalRoot, receiptTaskId(after), "canonical-after-experiment", "Canonical After Experiment");
    } finally {
      stopDaemonQuietly(canonicalRoot, userRoot);
    }
  }, "/tmp");
});

test("daemon service releases the final repo lock and reattaches after empty and all-disabled registry states", async () => {
  await withTempRootAsync(async (workspaceRoot) => {
    const userRoot = path.join(workspaceRoot, "user-daemon");
    const alphaRoot = path.join(workspaceRoot, "alpha");
    mkdirSync(alphaRoot, { recursive: true });
    ensureTestHarnessIdentity(alphaRoot);
    runRawJson(alphaRoot, ["init"], { HARNESS_DAEMON_MODE: "direct", HARNESS_DAEMON_USER_ROOT: userRoot });
    writePeopleRoster(alphaRoot, "person_alpha");
    registerRepo(alphaRoot, userRoot, "alpha");

    try {
      const started = runDaemonCommand(alphaRoot, ["daemon", "start", "--service", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      const servicePid = Number(started.pid);
      const lockPath = path.join(alphaRoot, ".harness/locks/global.lock");
      assert.equal(Number.isInteger(servicePid) && servicePid > 0, true);
      assert.equal(existsSync(lockPath), true);

      writeFileSync(path.join(userRoot, "registry.json"), `${JSON.stringify({
        schema: "harness-daemon-registry/v1",
        repos: []
      }, null, 2)}\n`, "utf8");
      await waitForCondition(() => !existsSync(lockPath));
      assert.equal(processIsAlive(servicePid), true);
      const emptyStatus = runDaemonCommand(alphaRoot, ["--repo", "alpha", "daemon", "status", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      assert.equal(emptyStatus.pid, servicePid);
      assert.equal(emptyStatus.reachable, true);
      assert.equal(requireStatusRepo(emptyStatus, "alpha").state, "detached");

      registerRepo(alphaRoot, userRoot, "alpha");
      const afterEmpty = await waitForRepoState(alphaRoot, userRoot, "alpha", "alpha", "attached");
      assert.equal(afterEmpty.pid, servicePid);
      const afterEmptyWrite = runRawJson(alphaRoot, ["new-task", "--title", "Alpha After Empty Registry"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "60000"
      });
      assert.equal(afterEmptyWrite.ok, true);

      runDaemonCommand(alphaRoot, ["daemon", "repo", "unregister", "--repo-id", "alpha", "--user-root", userRoot, "--no-link", "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      await waitForCondition(() => !existsSync(lockPath));
      assert.equal(processIsAlive(servicePid), true);
      const disabledStatus = runDaemonCommand(alphaRoot, ["--repo", "alpha", "daemon", "status", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      assert.equal(disabledStatus.pid, servicePid);
      assert.equal(disabledStatus.reachable, true);
      assert.equal(requireStatusRepo(disabledStatus, "alpha").state, "detached");

      registerRepo(alphaRoot, userRoot, "alpha");
      const afterDisabled = await waitForRepoState(alphaRoot, userRoot, "alpha", "alpha", "attached");
      assert.equal(afterDisabled.pid, servicePid);
      const afterDisabledWrite = runRawJson(alphaRoot, ["new-task", "--title", "Alpha After Disabled Registry"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "60000"
      });
      assert.equal(afterDisabledWrite.ok, true);
    } finally {
      stopDaemonQuietly(alphaRoot, userRoot);
    }
  });
});

test("daemon service isolates held repo locks, retries after release, and preserves per-repo fail-closed writes", async () => {
  await withTempRootAsync(async (workspaceRoot) => {
    const { userRoot, alphaRoot, betaRoot } = setupRegisteredRepos(workspaceRoot);
    const externalLock = writeDaemonGlobalLock(alphaRoot);

    try {
      const start = runDaemonCommand(betaRoot, ["daemon", "start", "--service", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      const startAlpha = requireStatusRepo(start, "alpha");
      const startBeta = requireStatusRepo(start, "beta");
      assertRepoStatusFields(startAlpha);
      assertRepoStatusFields(startBeta);
      assert.equal(startAlpha.state, "unavailable");
      assert.equal(startAlpha.lockPath, null);
      assert.match(String(startAlpha.lastError), /lock already held|global\.lock/u);
      assert.equal(startBeta.state, "attached");
      assert.equal(typeof startBeta.lockPath, "string");
      const healthyPid = start.pid;
      const healthyLockOwnerToken = startBeta.lockOwnerToken;

      const failedReconcile = await waitForRepoReconcileError(betaRoot, userRoot, "beta", "alpha");
      const failedAlpha = requireStatusRepo(failedReconcile, "alpha");
      const stillHealthyBeta = requireStatusRepo(failedReconcile, "beta");
      assert.equal((failedReconcile.lastReconcileError as { repoId?: unknown }).repoId, "alpha");
      assert.equal((failedAlpha.lastReconcileError as { repoId?: unknown }).repoId, "alpha");
      assert.equal(stillHealthyBeta.lastReconcileError, null);
      assert.equal(failedReconcile.pid, healthyPid);
      assert.equal(stillHealthyBeta.lockOwnerToken, healthyLockOwnerToken);

      const blockedAlphaWrite = runRawJsonMaybeFail(alphaRoot, ["new-task", "--title", "Blocked Alpha Write"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "5000"
      });
      assert.notEqual(blockedAlphaWrite.status, 0);
      assert.equal(blockedAlphaWrite.receipt.ok, false);
      assert.match(String((blockedAlphaWrite.receipt.error as { code?: string }).code), /^repo_(lock_held|unavailable)$/u);
      assert.equal(taskIndexWithTitleExists(alphaRoot, "Blocked Alpha Write"), false);

      const betaCreated = runRawJson(betaRoot, ["new-task", "--title", "Beta While Alpha Locked"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "5000"
      });
      assert.equal(betaCreated.ok, true);
      assertTaskIndexContains(betaRoot, receiptTaskId(betaCreated), "beta-while-alpha-locked", "Beta While Alpha Locked");
      assertDirectCliWriteRejected(betaRoot, "Direct Beta Rejected");
      const afterHealthyWrite = runDaemonCommand(betaRoot, ["--repo", "beta", "daemon", "status", "--user-root", userRoot, "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      assert.equal(afterHealthyWrite.pid, healthyPid);
      assert.equal(requireStatusRepo(afterHealthyWrite, "beta").lockOwnerToken, healthyLockOwnerToken);

      externalLock.release();
      const recovered = await waitForRepoState(betaRoot, userRoot, "beta", "alpha", "attached");
      const recoveredAlpha = requireStatusRepo(recovered, "alpha");
      assertRepoStatusFields(recoveredAlpha);
      assert.equal(recoveredAlpha.lastError, null);
      assert.equal(recoveredAlpha.lastReconcileError, null);
      assert.equal(recovered.lastReconcileError, null);
      assert.equal(typeof recoveredAlpha.lockPath, "string");
      assertDirectCliWriteRejected(alphaRoot, "Direct Alpha Rejected");

      const alphaCreated = runRawJson(alphaRoot, ["new-task", "--title", "Alpha After Retry"], {
        HARNESS_DAEMON_MODE: "local",
        HARNESS_DAEMON_USER_ROOT: userRoot,
        HARNESS_DAEMON_IDLE_MS: "5000"
      });
      assert.equal(alphaCreated.ok, true);
      const alphaTaskId = receiptTaskId(alphaCreated);
      assertTaskIndexContains(alphaRoot, alphaTaskId, "alpha-after-retry", "Alpha After Retry");
      assert.equal(existsSync(path.join(betaRoot, `harness/tasks/${alphaTaskId}-alpha-after-retry/INDEX.md`)), false);

      runDaemonCommand(alphaRoot, ["daemon", "repo", "unregister", "--repo-id", "alpha", "--user-root", userRoot, "--no-link", "--json"], {
        HARNESS_DAEMON_USER_ROOT: userRoot
      });
      const detached = await waitForRepoState(betaRoot, userRoot, "beta", "alpha", "detached");
      const detachedAlpha = requireStatusRepo(detached, "alpha");
      assertRepoStatusFields(detachedAlpha);
      assert.equal(detachedAlpha.lockPath, null);
      assert.equal(detachedAlpha.lastError, null);
    } finally {
      try {
        externalLock.release();
      } catch {
        // The test releases this lock before retry; cleanup is best-effort.
      }
      stopDaemonQuietly(betaRoot, userRoot);
    }
  });
});

function withTempRoot<T>(fn: (rootDir: string) => T): T {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-cli-daemon-"));
  try {
    return fn(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

async function withTempRootAsync<T>(fn: (rootDir: string) => Promise<T>, parent = tmpdir()): Promise<T> {
  const rootDir = mkdtempSync(path.join(parent, "ha-cli-daemon-"));
  try {
    return await fn(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function setupRegisteredRepos(workspaceRoot: string): {
  readonly userRoot: string;
  readonly alphaRoot: string;
  readonly betaRoot: string;
} {
  const userRoot = path.join(workspaceRoot, "user-daemon");
  const alphaRoot = path.join(workspaceRoot, "alpha");
  const betaRoot = path.join(workspaceRoot, "beta");
  for (const rootDir of [alphaRoot, betaRoot]) {
    mkdirSync(rootDir, { recursive: true });
    ensureTestHarnessIdentity(rootDir);
    runRawJson(rootDir, ["init"], { HARNESS_DAEMON_MODE: "direct", HARNESS_DAEMON_USER_ROOT: userRoot });
    writePeopleRoster(rootDir, rootDir === alphaRoot ? "person_alpha" : "person_beta");
  }
  runDaemonCommand(alphaRoot, ["daemon", "repo", "register", "--repo-id", "alpha", "--root", alphaRoot, "--user-root", userRoot, "--no-link", "--json"], {
    HARNESS_DAEMON_USER_ROOT: userRoot
  });
  runDaemonCommand(betaRoot, ["daemon", "repo", "register", "--repo-id", "beta", "--root", betaRoot, "--user-root", userRoot, "--no-link", "--json"], {
    HARNESS_DAEMON_USER_ROOT: userRoot
  });
  return { userRoot, alphaRoot, betaRoot };
}

function registerRepo(rootDir: string, userRoot: string, repoId: string): void {
  runDaemonCommand(rootDir, ["daemon", "repo", "register", "--repo-id", repoId, "--root", rootDir, "--user-root", userRoot, "--no-link", "--json"], {
    HARNESS_DAEMON_USER_ROOT: userRoot
  });
}

function writePeopleRoster(rootDir: string, personId: string): void {
  const harnessRoot = path.join(rootDir, "harness");
  mkdirSync(harnessRoot, { recursive: true });
  const configPath = path.join(harnessRoot, "harness.yaml");
  writeFileSync(configPath, readFileSync(configPath, "utf8")
    .replace("personId: person_test", `personId: ${personId}`)
    .replace("displayName: Harness Test", `displayName: ${personId}`), "utf8");
  writeFileSync(path.join(harnessRoot, "people.yaml"), [
    "schema: harness-people/v1",
    "people:",
    `  - personId: ${personId}`,
    `    displayName: ${personId}`,
    "    primaryEmail: daemon-tester@example.test",
    "    roles: [owner]",
    "    credentials:",
    "      - kind: unix-socket-owner-boundary",
    `        issuer: host:${hostname()}`,
    `        subject: ${process.getuid?.() ?? 0}`,
    "roles:",
    "  - roleId: owner",
    "    commandClasses: [admin, repo-write, repo-read, arbiter]",
    ""
  ].join("\n"), "utf8");
  if (existsSync(path.join(harnessRoot, ".git"))) {
    execFileSync("git", ["-C", harnessRoot, "add", "--", "harness.yaml", "people.yaml"], { stdio: "ignore" });
    execFileSync("git", ["-C", harnessRoot, "commit", "-m", "chore: configure daemon people roster"], {
      stdio: "ignore",
      env: gitAuthorEnv(rootDir)
    });
  }
}

function receiptActorPersonId(receipt: Record<string, unknown>): unknown {
  const details = isRecord(receipt.details) ? receipt.details : {};
  const actor = isRecord(details.actor) ? details.actor : {};
  return actor.personId;
}

function gitAuthorEnv(rootDir: string): NodeJS.ProcessEnv {
  const name = process.env.HARNESS_GIT_AUTHOR_NAME ?? "Harness Test";
  const email = process.env.HARNESS_GIT_AUTHOR_EMAIL ?? "harness@example.test";
  return {
    ...process.env,
    HOME: path.join(rootDir, ".home"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? name,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? email
  };
}

function runRawJson(rootDir: string, args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}): Record<string, unknown> {
  const stdout = execFileSync(process.execPath, [cliEntry, "--root", rootDir, "--json", ...args], {
    encoding: "utf8",
    env: daemonTestEnv(rootDir, env)
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function runRawJsonMaybeFail(
  rootDir: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {}
): { readonly status: number | null; readonly receipt: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [cliEntry, "--root", rootDir, "--json", ...args], {
    encoding: "utf8",
    env: daemonTestEnv(rootDir, env)
  });
  assert.equal(result.stderr, "");
  return {
    status: result.status,
    receipt: JSON.parse(result.stdout) as Record<string, unknown>
  };
}

function runDaemonCommand(rootDir: string, args: ReadonlyArray<string>, env: Readonly<Record<string, string>> = {}): Record<string, unknown> {
  const stdout = execFileSync(process.execPath, [cliEntry, "--root", rootDir, ...args], {
    encoding: "utf8",
    env: daemonTestEnv(rootDir, { HARNESS_DAEMON_MODE: "direct", ...env })
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function daemonTestEnv(rootDir: string, env: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: path.join(rootDir, ".home"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    HARNESS_ACTOR: "agent:daemon-multi-repo-test",
    HARNESS_GIT_AUTHOR_NAME: "Harness Test",
    HARNESS_GIT_AUTHOR_EMAIL: "harness@example.test",
    GIT_AUTHOR_NAME: "Harness Test",
    GIT_AUTHOR_EMAIL: "harness@example.test",
    GIT_COMMITTER_NAME: "Harness Test",
    GIT_COMMITTER_EMAIL: "harness@example.test",
    HARNESS_DAEMON_USER_ROOT: path.join(rootDir, ".daemon-user"),
    CLAUDE_SESSION_ID: "",
    CLAUDE_CODE_SESSION_ID: "",
    CODEX_THREAD_ID: "",
    CODEX_SESSION_ID: "",
    ZCODE_SESSION_ID: "",
    ANTIGRAVITY_SESSION_ID: "",
    ...env
  };
}

function assertTaskIndexContains(rootDir: string, taskId: string, slug: string, title: string): void {
  const indexPath = path.join(rootDir, `harness/tasks/${taskId}-${slug}/INDEX.md`);
  assert.equal(existsSync(indexPath), true, indexPath);
  assert.match(readFileSync(indexPath, "utf8"), new RegExp(title, "u"));
}

function receiptTaskId(receipt: Record<string, unknown>): string {
  const details = isRecord(receipt.details) ? receipt.details : {};
  const data = isRecord(details.data) ? details.data : {};
  assert.equal(typeof data.taskId, "string");
  return data.taskId;
}

function taskIndexWithTitleExists(rootDir: string, title: string): boolean {
  const tasksRoot = path.join(rootDir, "harness/tasks");
  if (!existsSync(tasksRoot)) return false;
  return readdirSync(tasksRoot, { withFileTypes: true }).some((entry) => {
    if (!entry.isDirectory()) return false;
    const indexPath = path.join(tasksRoot, entry.name, "INDEX.md");
    return existsSync(indexPath) && readFileSync(indexPath, "utf8").includes(title);
  });
}

function assertDirectCliWriteRejected(rootDir: string, title: string): void {
  const direct = spawnSync(process.execPath, [cliEntry, "--root", rootDir, "--json", "new-task", "--title", title], {
    encoding: "utf8",
    env: daemonTestEnv(rootDir, { HARNESS_DAEMON_MODE: "direct" })
  });
  assert.equal(typeof direct.stdout, "string");
  assert.notEqual(direct.status, 0);
  const receipt = JSON.parse(direct.stdout) as Record<string, unknown>;
  assert.equal(receipt.ok, false);
  assert.match(JSON.stringify(receipt), /write through daemon/u);
  assert.equal(taskIndexWithTitleExists(rootDir, title), false);
}

function writeDaemonGlobalLock(rootDir: string): { readonly release: () => void } {
  const lockPath = path.join(rootDir, ".harness/locks/global.lock");
  const ownerToken = randomUUID();
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    ownerToken,
    ownerKind: "daemon"
  }), "utf8");
  return {
    release: () => {
      const current = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) as { readonly ownerToken?: string } : undefined;
      if (current?.ownerToken === ownerToken) rmSync(lockPath, { force: true });
    }
  };
}

function requireStatusRepo(status: Record<string, unknown>, repoId: string): Record<string, unknown> {
  assert.equal(Array.isArray(status.repos), true);
  const repo = (status.repos as Array<Record<string, unknown>>).find((entry) => entry.repoId === repoId);
  assert.ok(repo, `missing status repo ${repoId}`);
  return repo;
}

function assertRepoStatusFields(repo: Record<string, unknown>): void {
  for (const key of ["state", "lockPath", "queue", "lastRecovery", "lastError", "lastReconcileError"]) {
    assert.equal(Object.hasOwn(repo, key), true, `missing ${key} in ${String(repo.repoId)}`);
  }
  assert.equal(isRecord(repo.queue), true);
}

async function waitForRepoState(
  rootDir: string,
  userRoot: string,
  statusRepoId: string,
  targetRepoId: string,
  state: string,
  timeoutMs = 5_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: Record<string, unknown> | undefined;
  while (Date.now() <= deadline) {
    lastStatus = runDaemonCommand(rootDir, ["--repo", statusRepoId, "daemon", "status", "--user-root", userRoot, "--json"], {
      HARNESS_DAEMON_USER_ROOT: userRoot
    });
    const repos = Array.isArray(lastStatus.repos) ? lastStatus.repos as Array<Record<string, unknown>> : [];
    const repo = repos.find((candidate) => candidate.repoId === targetRepoId);
    if (repo?.state === state) return lastStatus;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(requireStatusRepo(lastStatus ?? {}, targetRepoId).state, state);
  return lastStatus ?? {};
}

async function waitForRepoReconcileError(
  rootDir: string,
  userRoot: string,
  statusRepoId: string,
  targetRepoId: string,
  timeoutMs = 5_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: Record<string, unknown> | undefined;
  while (Date.now() <= deadline) {
    lastStatus = runDaemonCommand(rootDir, ["--repo", statusRepoId, "daemon", "status", "--user-root", userRoot, "--json"], {
      HARNESS_DAEMON_USER_ROOT: userRoot
    });
    const repo = Array.isArray(lastStatus.repos)
      ? (lastStatus.repos as Array<Record<string, unknown>>).find((candidate) => candidate.repoId === targetRepoId)
      : undefined;
    if (isRecord(lastStatus.lastReconcileError) && isRecord(repo?.lastReconcileError)) return lastStatus;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`missing reconcile error for repo ${targetRepoId}: ${JSON.stringify(lastStatus)}`);
}

async function waitForCondition(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(condition(), true);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopDaemonQuietly(rootDir: string, userRoot: string): void {
  try {
    runDaemonCommand(rootDir, ["daemon", "stop", "--timeout-ms", "5000", "--user-root", userRoot, "--json"], {
      HARNESS_DAEMON_USER_ROOT: userRoot
    });
  } catch {
    // Test cleanup should not mask the assertion that failed first.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
