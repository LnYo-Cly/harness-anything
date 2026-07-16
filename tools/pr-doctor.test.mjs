// harness-test-tier: fast
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { recentDequeueEvents, run, watchPullRequest } from "./pr-doctor.mjs";

test("pr doctor reports GitHub transport faults separately from dequeue events", () => {
  const result = recentDequeueEvents("owner/repo", [{
    number: 42,
    headRefName: "feature",
    headRefOid: "abc123"
  }], () => {
    throw new Error("gh api failed: EOF");
  });

  assert.deepEqual(result.events, []);
  assert.deepEqual(result.transportFailures, ["#42 feature: unable to read check-runs (gh api failed: EOF)"]);
});

test("pr doctor keeps confirmed dequeue check-runs in the dequeue event stream", () => {
  const result = recentDequeueEvents("owner/repo", [{
    number: 43,
    headRefName: "feature-two",
    headRefOid: "def456"
  }], () => [{
    name: "Mergify Queue Summary",
    output: { title: "Pull request dequeued", summary: "required check failed" }
  }]);

  assert.deepEqual(result.events, ["#43 Mergify Queue Summary: Pull request dequeued"]);
  assert.deepEqual(result.transportFailures, []);
});

test("pr doctor retries transient gh failures but not deterministic authorization errors", () => {
  const responses = [
    { status: 1, stdout: "", stderr: "Post https://api.github.com/graphql: EOF" },
    { status: 1, stdout: "", stderr: "HTTP 503 Service Unavailable" },
    { status: 0, stdout: "{\"ok\":true}\n", stderr: "" }
  ];
  let calls = 0;
  const delays = [];
  const output = run("gh", ["api", "test"], {
    spawn: () => responses[calls++],
    sleep: (ms) => delays.push(ms),
    retryAttempts: 3,
    retryDelayMs: 10
  });

  assert.equal(output, "{\"ok\":true}");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);

  let forbiddenCalls = 0;
  assert.throws(() => run("gh", ["api", "forbidden"], {
    spawn: () => {
      forbiddenCalls += 1;
      return { status: 1, stdout: "", stderr: "HTTP 403 Resource not accessible" };
    },
    sleep: () => assert.fail("403 must not be retried"),
    retryAttempts: 3
  }), /403/u);
  assert.equal(forbiddenCalls, 1);
});

test("pr doctor watch waits for merge and treats confirmed dequeue as a distinct terminal outcome", () => {
  const states = [
    { number: 51, state: "OPEN", headRefName: "feature", headRefOid: "sha-1", statusCheckRollup: [] },
    { number: 51, state: "MERGED", headRefName: "feature", headRefOid: "sha-1", statusCheckRollup: [] }
  ];
  let sleeps = 0;
  const merged = watchPullRequest("owner/repo", 51, {
    readPr: () => states.shift(),
    readCheckRuns: () => [],
    sleep: () => { sleeps += 1; },
    pollIntervalMs: 1,
    maxPolls: 2
  });
  assert.equal(merged.outcome, "merged");
  assert.equal(merged.polls, 2);
  assert.equal(sleeps, 1);

  const dequeued = watchPullRequest("owner/repo", 52, {
    readPr: () => ({ number: 52, state: "OPEN", headRefName: "feature-two", headRefOid: "sha-2", statusCheckRollup: [] }),
    readCheckRuns: () => [{ name: "Mergify Queue Summary", output: { title: "Pull request dequeued" } }],
    sleep: () => assert.fail("confirmed dequeue is terminal"),
    maxPolls: 1
  });
  assert.equal(dequeued.outcome, "dequeued");
});

test("pr doctor watch continues after a check-run transport fault", () => {
  const states = [
    { number: 53, state: "OPEN", headRefName: "feature-three", headRefOid: "sha-3", statusCheckRollup: [] },
    { number: 53, state: "CLOSED", headRefName: "feature-three", headRefOid: "sha-3", statusCheckRollup: [] }
  ];
  const result = watchPullRequest("owner/repo", 53, {
    readPr: () => states.shift(),
    readCheckRuns: () => { throw new Error("gh api failed: EOF"); },
    sleep: () => {},
    maxPolls: 2
  });

  assert.equal(result.outcome, "closed");
  assert.equal(result.polls, 2);
  assert.equal(result.transportFailures.length, 1);
});

test("pr doctor --watch command reaches a hermetic merged terminal state", { skip: process.platform === "win32" }, (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "ha-pr-doctor-watch-"));
  const binDir = path.join(rootDir, "bin");
  const counterPath = path.join(rootDir, "counter");
  const ghPath = path.join(binDir, "gh");
  mkdirSync(binDir);
  writeFileSync(ghPath, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (args[0] === 'pr' && args[1] === 'view') {",
    "  let count = 0;",
    "  try { count = Number(fs.readFileSync(process.env.PR_DOCTOR_TEST_COUNTER, 'utf8')); } catch {}",
    "  count += 1;",
    "  fs.writeFileSync(process.env.PR_DOCTOR_TEST_COUNTER, String(count));",
    "  const state = count === 1 ? 'OPEN' : 'MERGED';",
    "  process.stdout.write(JSON.stringify({ number: 60, state, headRefName: 'feature', headRefOid: 'abc', statusCheckRollup: [] }));",
    "} else if (args[0] === 'api') {",
    "  process.stdout.write(JSON.stringify({ check_runs: [] }));",
    "} else {",
    "  process.stderr.write(`unexpected gh args: ${args.join(' ')}`);",
    "  process.exitCode = 1;",
    "}",
    ""
  ].join("\n"), "utf8");
  chmodSync(ghPath, 0o755);
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, ["tools/pr-doctor.mjs", "--watch", "60"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "owner/repo",
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      PR_DOCTOR_TEST_COUNTER: counterPath,
      PR_DOCTOR_WATCH_INTERVAL_MS: "1",
      PR_DOCTOR_GH_RETRY_DELAY_MS: "1"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /poll=1 state=OPEN/u);
  assert.match(result.stdout, /poll=2 state=MERGED/u);
  assert.match(result.stdout, /terminal=merged pr=#60/u);
});
