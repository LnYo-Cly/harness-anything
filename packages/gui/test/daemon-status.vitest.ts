import { afterEach, describe, expect, it } from "vitest";
import {
  daemonRepoRows,
  readDaemonStatus,
  sumQueueDepth,
  type DaemonQueueLanes,
} from "../src/renderer/model/daemon-status.ts";
import {
  DAEMON_STATUS_FIXTURE_RAW,
  DAEMON_STATUS_NO_REPOS_RAW,
  DAEMON_STATUS_UNREACHABLE_RAW,
  loadDaemonStatusFixture,
  setDaemonStatusFixtureKind,
} from "../src/renderer/model/daemon-status-fixture.ts";

afterEach(() => {
  setDaemonStatusFixtureKind("multi-repo");
});

describe("sumQueueDepth", () => {
  it("sums the four queue lanes and ignores running", () => {
    const queue: DaemonQueueLanes = {
      interactive: 1,
      normal: 2,
      background: 3,
      maintenance: 4,
      running: true,
    };
    expect(sumQueueDepth(queue)).toBe(10);
  });

  it("returns zero for empty lanes", () => {
    expect(
      sumQueueDepth({
        interactive: 0,
        normal: 0,
        background: 0,
        maintenance: 0,
        running: false,
      }),
    ).toBe(0);
  });
});

describe("readDaemonStatus", () => {
  it("parses the multi-repo happy-path fixture", () => {
    const status = readDaemonStatus(DAEMON_STATUS_FIXTURE_RAW);
    expect(status.schema).toBe("daemon-status/v1");
    expect(status.started).toBe(true);
    expect(status.daemonId).toBe("ha-48291");
    expect(status.pid).toBe(48291);
    expect(status.queueDepth).toBe(4);
    expect(status.connections).toEqual({ active: 2, total: 5 });
    expect(status.uptimeMs).toBe(3_661_000);
    expect(status.repos).toHaveLength(3);
    expect(status.repos?.[1]?.state).toBe("recovering");
    expect(status.repos?.[1]?.lastError).toBe("projection lag exceeded soft budget");
    expect(sumQueueDepth(status.repos![0]!.queue)).toBe(2);
  });

  it("parses the unreachable fixture without inventing uptime", () => {
    const status = readDaemonStatus(DAEMON_STATUS_UNREACHABLE_RAW);
    expect(status.started).toBe(false);
    expect(status.uptimeMs).toBeUndefined();
    expect(status.repos).toBeUndefined();
    expect(status.lock.path).toBeNull();
  });

  it("accepts string protocolVersion and missing repos", () => {
    const status = readDaemonStatus(DAEMON_STATUS_NO_REPOS_RAW);
    expect(status.protocolVersion).toBe("3");
    expect(status.repos).toBeUndefined();
    expect(status.lock.path).toBeNull();
  });

  it("throws on malformed input", () => {
    expect(() => readDaemonStatus(null)).toThrow(/not an object/i);
    expect(() => readDaemonStatus({ schema: "wrong" })).toThrow(/schema/i);
    expect(() =>
      readDaemonStatus({
        ...DAEMON_STATUS_NO_REPOS_RAW,
        started: "yes",
      }),
    ).toThrow(/started/i);
    expect(() =>
      readDaemonStatus({
        ...DAEMON_STATUS_NO_REPOS_RAW,
        queue: { interactive: 1 },
      }),
    ).toThrow(/queue/i);
    expect(() =>
      readDaemonStatus({
        ...DAEMON_STATUS_NO_REPOS_RAW,
        repos: [{ repoId: 1 }],
      }),
    ).toThrow(/repos\[0\]/i);
  });
});

describe("daemonRepoRows", () => {
  it("returns repos[] when present", () => {
    const status = readDaemonStatus(DAEMON_STATUS_FIXTURE_RAW);
    const rows = daemonRepoRows(status);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.repoId)).toEqual([
      "repo-harness-anything",
      "repo-sidecar-tools",
      "repo-legacy-monolith",
    ]);
  });

  it("synthesizes a single row when repos is absent", () => {
    const status = readDaemonStatus(DAEMON_STATUS_NO_REPOS_RAW);
    const rows = daemonRepoRows(status);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repoId).toBe("repo-single");
    expect(rows[0]?.canonicalRoot).toBe("/tmp/single-repo");
    expect(rows[0]?.state).toBe("ready");
    expect(rows[0]?.lockPath).toBeNull();
    expect(sumQueueDepth(rows[0]!.queue)).toBe(4);
  });

  it("marks synthesized row as stopped when daemon is not started", () => {
    const status = readDaemonStatus(DAEMON_STATUS_UNREACHABLE_RAW);
    const rows = daemonRepoRows(status);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("stopped");
  });
});

describe("loadDaemonStatusFixture", () => {
  it("loads the multi-repo fixture by default", async () => {
    const status = await loadDaemonStatusFixture();
    expect(status.started).toBe(true);
    expect(status.repos).toHaveLength(3);
  });

  it("can flip to the unreachable fixture for tests", async () => {
    setDaemonStatusFixtureKind("unreachable");
    const status = await loadDaemonStatusFixture();
    expect(status.started).toBe(false);
    expect(status.daemonId).toBe("");
  });

  it("can flip to the no-repos fixture for tests", async () => {
    setDaemonStatusFixtureKind("no-repos");
    const status = await loadDaemonStatusFixture();
    expect(status.repos).toBeUndefined();
    expect(daemonRepoRows(status)).toHaveLength(1);
  });
});
