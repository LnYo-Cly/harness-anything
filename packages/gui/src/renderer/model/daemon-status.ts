/**
 * Typed model + validating reader for daemon-status/v1.
 * Fixture-backed today; later swapped for a real bridge call (X4).
 *
 * Note: wire `lock.owner*` / `lockOwner*` identity fields are intentionally
 * not modeled here — the System panel only surfaces lock paths, and the
 * renderer contract forbids privileged identity material in this layer.
 */

export const DAEMON_STATUS_SCHEMA = "daemon-status/v1" as const;

export interface DaemonQueueLanes {
  readonly interactive: number;
  readonly normal: number;
  readonly background: number;
  readonly maintenance: number;
  readonly running: boolean;
}

export interface DaemonLockInfo {
  readonly path: string | null;
}

export interface DaemonConnections {
  readonly active: number;
  readonly total: number;
}

export interface DaemonRepoStatus {
  readonly repoId: string;
  readonly canonicalRoot: string;
  readonly state: string;
  readonly lockPath: string | null;
  readonly queue: DaemonQueueLanes;
  readonly lastRecovery: unknown | null;
  readonly projectionGeneration: unknown | null;
  readonly lastError: string | null;
  readonly lastMaterializerError: string | null;
}

export interface DaemonStatusModel {
  readonly schema: typeof DAEMON_STATUS_SCHEMA;
  readonly started: boolean;
  readonly daemonId: string;
  readonly pid: number;
  readonly rootDir: string;
  readonly repoId: string;
  readonly endpoint: string;
  readonly version: string;
  readonly protocolVersion: string | number;
  readonly lock: DaemonLockInfo;
  readonly queue: DaemonQueueLanes;
  readonly queueDepth: number;
  readonly connections: DaemonConnections;
  readonly lastRecovery: unknown | null;
  readonly projectionGeneration: unknown | null;
  /** Optional multi-repo table. Absent → synthesize a single row from top-level fields. */
  readonly repos?: ReadonlyArray<DaemonRepoStatus>;
  /**
   * Coming in a later daemon contract. Render as "—" / "unknown" when absent.
   * Do not fabricate a value outside fixtures that intentionally include it.
   */
  readonly uptimeMs?: number;
  readonly startedAt?: string;
}

/** Sum of the four queue lanes (does not include the `running` flag). */
export function sumQueueDepth(queue: DaemonQueueLanes): number {
  return queue.interactive + queue.normal + queue.background + queue.maintenance;
}

/**
 * Rows for the per-repo table: prefer `repos[]` when present; otherwise
 * synthesize one row from the top-level status fields.
 */
export function daemonRepoRows(status: DaemonStatusModel): ReadonlyArray<DaemonRepoStatus> {
  if (status.repos && status.repos.length > 0) {
    return status.repos;
  }
  return [
    {
      repoId: status.repoId,
      canonicalRoot: status.rootDir,
      state: status.started ? "ready" : "stopped",
      lockPath: status.lock.path,
      queue: status.queue,
      lastRecovery: status.lastRecovery,
      projectionGeneration: status.projectionGeneration,
      lastError: null,
      lastMaterializerError: null,
    },
  ];
}

export function readDaemonStatus(value: unknown): DaemonStatusModel {
  if (!isRecord(value)) {
    throw new Error("Daemon status is not an object.");
  }
  if (value.schema !== DAEMON_STATUS_SCHEMA) {
    throw new Error(
      `Daemon status schema must be ${DAEMON_STATUS_SCHEMA}, got ${String(value.schema)}.`,
    );
  }
  if (typeof value.started !== "boolean") {
    throw new Error("Daemon status.started must be a boolean.");
  }
  if (typeof value.daemonId !== "string") {
    throw new Error("Daemon status.daemonId must be a string.");
  }
  if (!isFiniteNumber(value.pid)) {
    throw new Error("Daemon status.pid must be a number.");
  }
  if (typeof value.rootDir !== "string") {
    throw new Error("Daemon status.rootDir must be a string.");
  }
  if (typeof value.repoId !== "string") {
    throw new Error("Daemon status.repoId must be a string.");
  }
  if (typeof value.endpoint !== "string") {
    throw new Error("Daemon status.endpoint must be a string.");
  }
  if (typeof value.version !== "string") {
    throw new Error("Daemon status.version must be a string.");
  }
  if (!isProtocolVersion(value.protocolVersion)) {
    throw new Error("Daemon status.protocolVersion must be a string or number.");
  }
  const lock = readLock(value.lock);
  const queue = readQueue(value.queue, "queue");
  if (!isFiniteNumber(value.queueDepth)) {
    throw new Error("Daemon status.queueDepth must be a number.");
  }
  const connections = readConnections(value.connections);

  let repos: ReadonlyArray<DaemonRepoStatus> | undefined;
  if (value.repos !== undefined) {
    if (!Array.isArray(value.repos)) {
      throw new Error("Daemon status.repos must be an array when present.");
    }
    repos = value.repos.map((entry, index) => readRepoStatus(entry, index));
  }

  const model: DaemonStatusModel = {
    schema: DAEMON_STATUS_SCHEMA,
    started: value.started,
    daemonId: value.daemonId,
    pid: value.pid,
    rootDir: value.rootDir,
    repoId: value.repoId,
    endpoint: value.endpoint,
    version: value.version,
    protocolVersion: value.protocolVersion,
    lock,
    queue,
    queueDepth: value.queueDepth,
    connections,
    lastRecovery: value.lastRecovery ?? null,
    projectionGeneration: value.projectionGeneration ?? null,
    ...(repos !== undefined ? { repos } : {}),
    ...(isFiniteNumber(value.uptimeMs) ? { uptimeMs: value.uptimeMs } : {}),
    ...(typeof value.startedAt === "string" ? { startedAt: value.startedAt } : {}),
  };
  return model;
}

function readLock(value: unknown): DaemonLockInfo {
  if (!isRecord(value)) {
    throw new Error("Daemon status.lock must be an object.");
  }
  if (!isNullableString(value.path)) {
    throw new Error("Daemon status.lock.path must be a string or null.");
  }
  // Wire may also carry lock-owner identity; the System panel does not surface it.
  return { path: value.path };
}

function readQueue(value: unknown, label: string): DaemonQueueLanes {
  if (!isRecord(value)) {
    throw new Error(`Daemon status.${label} must be an object.`);
  }
  for (const lane of ["interactive", "normal", "background", "maintenance"] as const) {
    if (!isFiniteNumber(value[lane])) {
      throw new Error(`Daemon status.${label}.${lane} must be a number.`);
    }
  }
  if (typeof value.running !== "boolean") {
    throw new Error(`Daemon status.${label}.running must be a boolean.`);
  }
  return {
    interactive: value.interactive as number,
    normal: value.normal as number,
    background: value.background as number,
    maintenance: value.maintenance as number,
    running: value.running,
  };
}

function readConnections(value: unknown): DaemonConnections {
  if (!isRecord(value)) {
    throw new Error("Daemon status.connections must be an object.");
  }
  if (!isFiniteNumber(value.active) || !isFiniteNumber(value.total)) {
    throw new Error("Daemon status.connections.active/total must be numbers.");
  }
  return { active: value.active as number, total: value.total as number };
}

function readRepoStatus(value: unknown, index: number): DaemonRepoStatus {
  if (!isRecord(value)) {
    throw new Error(`Daemon status.repos[${index}] must be an object.`);
  }
  if (typeof value.repoId !== "string") {
    throw new Error(`Daemon status.repos[${index}].repoId must be a string.`);
  }
  if (typeof value.canonicalRoot !== "string") {
    throw new Error(`Daemon status.repos[${index}].canonicalRoot must be a string.`);
  }
  if (typeof value.state !== "string") {
    throw new Error(`Daemon status.repos[${index}].state must be a string.`);
  }
  if (!isNullableString(value.lockPath)) {
    throw new Error(`Daemon status.repos[${index}].lockPath must be a string or null.`);
  }
  if (!isNullableString(value.lastError)) {
    throw new Error(`Daemon status.repos[${index}].lastError must be a string or null.`);
  }
  if (!isNullableString(value.lastMaterializerError)) {
    throw new Error(
      `Daemon status.repos[${index}].lastMaterializerError must be a string or null.`,
    );
  }
  return {
    repoId: value.repoId,
    canonicalRoot: value.canonicalRoot,
    state: value.state,
    lockPath: value.lockPath,
    queue: readQueue(value.queue, `repos[${index}].queue`),
    lastRecovery: value.lastRecovery ?? null,
    projectionGeneration: value.projectionGeneration ?? null,
    lastError: value.lastError,
    lastMaterializerError: value.lastMaterializerError,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isProtocolVersion(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}
