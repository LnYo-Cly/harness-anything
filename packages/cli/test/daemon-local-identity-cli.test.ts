// harness-test-tier: integration
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runRawJson, withTempRoot } from "./helpers/daemon-cli.ts";

test("local daemon derives its owner from project identity when people roster is absent", () => {
  withTempRoot((rootDir) => {
    const identityEnv = {
      HARNESS_GIT_AUTHOR_NAME: "Harness Test",
      HARNESS_GIT_AUTHOR_EMAIL: "harness@example.test"
    };
    runRawJson(rootDir, ["init"], {
      ...identityEnv,
      HARNESS_ACTOR: "agent:test-bootstrap",
      HARNESS_DAEMON_MODE: "direct"
    });
    assert.equal(existsSync(path.join(rootDir, "harness/people.yaml")), false);

    const created = runRawJson(rootDir, ["new-task", "--title", "Rosterless Local Daemon Write"], {
      HARNESS_DAEMON_MODE: "local",
      HARNESS_DAEMON_IDLE_MS: "250",
      ...identityEnv
    });

    assert.equal(created.ok, true);
    assert.equal(((created.details as Record<string, unknown>).actor as { personId?: string }).personId, "person_test");
    assert.equal(
      execFileSync("git", ["-C", path.join(rootDir, "harness"), "log", "-1", "--pretty=format:%an <%ae>"], { encoding: "utf8" }),
      "Harness Test <harness@example.test>"
    );
  });
});
