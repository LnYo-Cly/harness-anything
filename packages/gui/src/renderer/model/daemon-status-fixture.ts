import type { DaemonStatusModel } from "./daemon-status.ts";
import { readDaemonStatus } from "./daemon-status.ts";

/**
 * Realistic multi-repo happy-path fixture for the System settings panel.
 * Intentionally includes `uptimeMs` so the UI can demonstrate that field;
 * the non-fixture path must not invent one.
 *
 * Lock-owner identity from the wire shape is omitted: the panel only shows
 * lock paths, and privileged identity material must not live in the renderer.
 */
export const DAEMON_STATUS_FIXTURE_RAW = {
  schema: "daemon-status/v1",
  started: true,
  daemonId: "ha-48291",
  pid: 48291,
  rootDir: "/Users/dev/work/harness-anything",
  repoId: "repo-harness-anything",
  endpoint: "repo-router",
  version: "0.4.2",
  protocolVersion: 3,
  lock: {
    path: "/Users/dev/work/harness-anything/.harness/daemon.lock",
  },
  queue: {
    interactive: 1,
    normal: 2,
    background: 0,
    maintenance: 1,
    running: true,
  },
  queueDepth: 4,
  connections: { active: 2, total: 5 },
  lastRecovery: null,
  projectionGeneration: 17,
  uptimeMs: 3_661_000,
  repos: [
    {
      repoId: "repo-harness-anything",
      canonicalRoot: "/Users/dev/work/harness-anything",
      state: "ready",
      lockPath: "/Users/dev/work/harness-anything/.harness/daemon.lock",
      queue: {
        interactive: 1,
        normal: 1,
        background: 0,
        maintenance: 0,
        running: true,
      },
      lastRecovery: null,
      projectionGeneration: 17,
      lastError: null,
      lastMaterializerError: null,
    },
    {
      repoId: "repo-sidecar-tools",
      canonicalRoot: "/Users/dev/work/sidecar-tools",
      state: "recovering",
      lockPath: null,
      queue: {
        interactive: 0,
        normal: 1,
        background: 0,
        maintenance: 1,
        running: true,
      },
      lastRecovery: { at: "2026-07-16T08:12:00.000Z", reason: "projection-gap" },
      projectionGeneration: 4,
      lastError: "projection lag exceeded soft budget",
      lastMaterializerError: null,
    },
    {
      repoId: "repo-legacy-monolith",
      canonicalRoot: "/Users/dev/archive/legacy-monolith",
      state: "locked",
      lockPath: "/Users/dev/archive/legacy-monolith/.harness/daemon.lock",
      queue: {
        interactive: 0,
        normal: 0,
        background: 0,
        maintenance: 0,
        running: false,
      },
      lastRecovery: null,
      projectionGeneration: null,
      lastError: null,
      lastMaterializerError: "materializer refused foreign lock owner",
    },
  ],
} as const;

/** Unreachable / stopped fixture for unit tests and manual flip. */
export const DAEMON_STATUS_UNREACHABLE_RAW = {
  schema: "daemon-status/v1",
  started: false,
  daemonId: "",
  pid: 0,
  rootDir: "",
  repoId: "",
  endpoint: "repo-router",
  version: "",
  protocolVersion: 0,
  lock: { path: null },
  queue: {
    interactive: 0,
    normal: 0,
    background: 0,
    maintenance: 0,
    running: false,
  },
  queueDepth: 0,
  connections: { active: 0, total: 0 },
  lastRecovery: null,
  projectionGeneration: null,
} as const;

/** Top-level only (no repos[]) — exercises the single-row fallback. */
export const DAEMON_STATUS_NO_REPOS_RAW = {
  schema: "daemon-status/v1",
  started: true,
  daemonId: "ha-10001",
  pid: 10001,
  rootDir: "/tmp/single-repo",
  repoId: "repo-single",
  endpoint: "repo-router",
  version: "0.4.2",
  protocolVersion: "3",
  lock: { path: null },
  queue: {
    interactive: 0,
    normal: 3,
    background: 1,
    maintenance: 0,
    running: true,
  },
  queueDepth: 4,
  connections: { active: 1, total: 1 },
  lastRecovery: null,
  projectionGeneration: 2,
} as const;

export type DaemonStatusFixtureKind = "multi-repo" | "unreachable" | "no-repos";

let activeFixtureKind: DaemonStatusFixtureKind = "multi-repo";

/** Test-only seam to flip which fixture the loader returns. */
export function setDaemonStatusFixtureKind(kind: DaemonStatusFixtureKind): void {
  activeFixtureKind = kind;
}

export function getDaemonStatusFixtureKind(): DaemonStatusFixtureKind {
  return activeFixtureKind;
}

function rawForKind(kind: DaemonStatusFixtureKind): unknown {
  switch (kind) {
    case "unreachable":
      return DAEMON_STATUS_UNREACHABLE_RAW;
    case "no-repos":
      return DAEMON_STATUS_NO_REPOS_RAW;
    case "multi-repo":
    default:
      return DAEMON_STATUS_FIXTURE_RAW;
  }
}

/**
 * Async fixture loader — shape matches a future bridge call so the hook can
 * swap implementations with a one-line change.
 */
export async function loadDaemonStatusFixture(): Promise<DaemonStatusModel> {
  // Tiny yield so react-query can observe a loading tick under test if needed.
  await Promise.resolve();
  return readDaemonStatus(rawForKind(activeFixtureKind));
}
