import {
  requestLocalDaemonJsonRpcForTarget,
  type JsonObject,
  type LocalDaemonTarget
} from "../../../../daemon/src/index.ts";
import { readOption } from "../../cli/parse-options.ts";
import { requestLocalDaemonJsonRpc, resolveLocalDaemonTarget } from "../../daemon/client.ts";

export type DaemonControlKind = "restart" | "refresh";
type DaemonRefreshTrigger = "explicit" | "post-merge" | "dist-watcher";

export interface DaemonControlRequest {
  readonly method: "admin.daemon.restart" | "admin.daemon.refresh";
  readonly params: JsonObject;
}

export interface DaemonControlLifecycle {
  readonly target: LocalDaemonTarget;
  readonly probeStatus: (target: LocalDaemonTarget) => Promise<Record<string, unknown> | undefined>;
  readonly ownerIsAlive: (pid: number) => boolean;
  readonly startReplacement: (target: LocalDaemonTarget, timeoutMs: number) => Promise<Record<string, unknown>>;
  readonly wait: (ms: number) => Promise<void>;
}

export interface DaemonControlCommandInput {
  readonly rootDir: string;
  readonly layoutOverrides?: { readonly authoredRoot?: string };
  readonly args: ReadonlyArray<string>;
  readonly requestDaemonControl?: (request: DaemonControlRequest) => Promise<Record<string, unknown>>;
  readonly daemonControlLifecycle?: DaemonControlLifecycle;
  readonly daemonEntryPath: () => string;
}

export async function runDaemonControl(
  input: DaemonControlCommandInput,
  kind: DaemonControlKind
): Promise<Record<string, unknown>> {
  const drainTimeoutMs = daemonControlTimeoutMs(input.args);
  const trigger = kind === "refresh" ? daemonRefreshTrigger(input.args) : undefined;
  const params = {
    payload: {
      reason: readOption(input.args, "--reason") ?? `${trigger ?? "explicit"} daemon ${kind} request`,
      drainTimeoutMs,
      ...(trigger ? { trigger } : {})
    }
  };
  const method: DaemonControlRequest["method"] = kind === "restart"
    ? "admin.daemon.restart"
    : "admin.daemon.refresh";
  const lifecycle = input.daemonControlLifecycle ?? defaultDaemonControlLifecycle(input);
  const request = input.requestDaemonControl ?? ((control: DaemonControlRequest) => requestLocalDaemonJsonRpc(
    input.rootDir,
    control.method,
    control.params,
    5_000,
    {
      userRoot: daemonUserRootOption(input.args),
      socketPath: readOption(input.args, "--socket"),
      allowLegacySocket: false
    }
  ));
  const receipt = await request({ method, params });
  validateAcceptedControlReceipt(receipt, method, kind);
  const before = isDaemonControlRecord(receipt.before) ? receipt.before : {};
  const replacement = await completeDaemonReplacement(lifecycle, before.pid, drainTimeoutMs, kind, method);
  const { schema: controlSchema, ...controlResult } = receipt;
  return {
    ...controlResult,
    controlSchema,
    replacement: {
      ...replacement,
      userRoot: lifecycle.target.userRoot,
      endpoint: lifecycle.target.socketPath
    }
  };
}

function validateAcceptedControlReceipt(
  receipt: Record<string, unknown>,
  method: DaemonControlRequest["method"],
  kind: DaemonControlKind
): void {
  if (receipt.schema !== "daemon-control-accepted/v1"
    || receipt.accepted !== true
    || receipt.kind !== kind
    || typeof receipt.operationId !== "string"
    || receipt.operationId.length === 0) {
    throw new Error(`${method} did not return daemon-control-accepted/v1`);
  }
}

async function completeDaemonReplacement(
  lifecycle: DaemonControlLifecycle,
  beforePid: unknown,
  timeoutMs: number,
  kind: DaemonControlKind,
  method: DaemonControlRequest["method"]
): Promise<Record<string, unknown>> {
  if (!isPositivePid(beforePid)) {
    throw new Error(`${method} accepted receipt did not identify the running daemon PID`);
  }
  await waitForDaemonControlRelease(lifecycle, beforePid, timeoutMs);
  let replacement: Record<string, unknown>;
  try {
    replacement = await lifecycle.startReplacement(lifecycle.target, timeoutMs);
  } catch (error) {
    throw new Error(`daemon ${kind} replacement did not become reachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (replacement.started !== true || !isPositivePid(replacement.pid)) {
    throw new Error(`daemon ${kind} replacement did not return a reachable started daemon status`);
  }
  if (replacement.pid === beforePid) {
    throw new Error(`daemon ${kind} replacement PID did not change: ${String(replacement.pid)}`);
  }
  return replacement;
}

function defaultDaemonControlLifecycle(input: DaemonControlCommandInput): DaemonControlLifecycle {
  const entryPath = input.daemonEntryPath();
  const resolvedTarget = resolveLocalDaemonTarget({
    rootDir: input.rootDir,
    repoIdOverride: readOption(input.args, "--repo") ?? process.env.HARNESS_DAEMON_REPO_ID,
    userRoot: daemonUserRootOption(input.args),
    autoRegisterSingleRepo: false
  });
  const socketPath = readOption(input.args, "--socket");
  const target = socketPath ? { ...resolvedTarget, socketPath } : resolvedTarget;
  return {
    target,
    probeStatus: probeExactDaemonStatus,
    ownerIsAlive: daemonProcessIsAlive,
    startReplacement: (candidate, timeoutMs) => startDaemonReplacement(
      candidate,
      input.layoutOverrides,
      entryPath,
      timeoutMs
    ),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}

async function waitForDaemonControlRelease(
  lifecycle: DaemonControlLifecycle,
  beforePid: number,
  timeoutMs: number
): Promise<void> {
  const pollIntervalMs = 100;
  const attempts = Math.ceil(timeoutMs / pollIntervalMs) + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const endpointReleased = !await lifecycle.probeStatus(lifecycle.target);
    const ownerReleased = !lifecycle.ownerIsAlive(beforePid);
    if (endpointReleased && ownerReleased) return;
    if (attempt + 1 === attempts) {
      if (!endpointReleased) {
        throw new Error(`old daemon endpoint was not released before timeout (pid ${beforePid})`);
      }
      throw new Error(`old daemon owner did not exit after releasing its endpoint (pid ${beforePid})`);
    }
    await lifecycle.wait(pollIntervalMs);
  }
}

async function probeExactDaemonStatus(target: LocalDaemonTarget): Promise<Record<string, unknown> | undefined> {
  try {
    const receipt = await requestLocalDaemonJsonRpc(target.canonicalRoot, "repo.daemon.status", {
      repo: { repoId: target.repoId }
    }, 100, {
      userRoot: target.userRoot,
      daemonId: target.daemonId,
      socketPath: target.socketPath,
      allowLegacySocket: false
    });
    return statusFromReceipt(receipt) ?? { rpcError: receipt };
  } catch {
    return undefined;
  }
}

async function startDaemonReplacement(
  target: LocalDaemonTarget,
  layoutOverrides: { readonly authoredRoot?: string } | undefined,
  entryPath: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const receipt = await requestLocalDaemonJsonRpcForTarget(target, "repo.daemon.status", {
    repo: { repoId: target.repoId }
  }, 1_000, {
    entryPath,
    idleExitMs: 0,
    timeoutMs,
    layoutOverrides
  });
  const status = statusFromReceipt(receipt);
  if (!status) throw new Error("replacement status RPC did not return daemon status data");
  return status;
}

function statusFromReceipt(receipt: Record<string, unknown>): Record<string, unknown> | undefined {
  const details = isDaemonControlRecord(receipt.details) ? receipt.details : {};
  const data = isDaemonControlRecord(details.data) ? details.data : undefined;
  return receipt.ok === true && data ? data : undefined;
}

function daemonControlTimeoutMs(args: ReadonlyArray<string>): number {
  const raw = readOption(args, "--timeout-ms") ?? "5000";
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("Use --timeout-ms with an integer from 100 through 120000.");
  }
  return timeoutMs;
}

function daemonRefreshTrigger(args: ReadonlyArray<string>): DaemonRefreshTrigger {
  const trigger = readOption(args, "--trigger") ?? "explicit";
  if (trigger === "explicit" || trigger === "post-merge" || trigger === "dist-watcher") return trigger;
  throw new Error("Use --trigger explicit|post-merge|dist-watcher.");
}

function daemonUserRootOption(args: ReadonlyArray<string>): string | undefined {
  return readOption(args, "--user-root") ?? process.env.HARNESS_DAEMON_USER_ROOT;
}

function daemonProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(isDaemonControlRecord(error) && error.code === "ESRCH");
  }
}

function isPositivePid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDaemonControlRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
