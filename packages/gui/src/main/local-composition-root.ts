import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProjectPath } from "../api/local-api.ts";
import { createGuiServiceBridgeForDaemon } from "../api/service-bridge.ts";
import type { ApiRouteContract } from "../api/api-contract-registry.ts";
import type { GuiServiceBridge } from "../api/service-bridge.ts";

const defaultDaemonAutostartTimeoutMs = 6_000;
const defaultDaemonIdleExitMs = 750;

type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonObject | ReadonlyArray<JsonValue>;

interface LocalDaemonTarget {
  readonly repoId: string;
  readonly canonicalRoot: string;
  readonly userRoot: string;
  readonly daemonId: string;
  readonly socketPath: string;
  readonly legacySocketPath: string;
  readonly registered: boolean;
}

interface HarnessLayoutOverrides {
  readonly authoredRoot?: string;
}

interface LocalDaemonClientModule {
  readonly daemonUserRoot: (env?: NodeJS.ProcessEnv) => string;
  readonly daemonIdFromEnv: (env?: NodeJS.ProcessEnv) => string;
  readonly resolveLocalDaemonTarget: (input: {
    readonly rootDir: string;
    readonly repoIdOverride?: string;
    readonly userRoot?: string;
    readonly daemonId?: string;
    readonly autoRegisterSingleRepo?: boolean;
    readonly env?: NodeJS.ProcessEnv;
  }) => LocalDaemonTarget;
  readonly requestLocalDaemonJsonRpcForTarget: (
    target: LocalDaemonTarget,
    method: string,
    params: JsonObject,
    timeoutMs?: number,
    autostart?: {
      readonly entryPath: string;
      readonly idleExitMs?: number;
      readonly timeoutMs?: number;
      readonly layoutOverrides?: HarnessLayoutOverrides;
      readonly env?: NodeJS.ProcessEnv;
      readonly execPath?: string;
      readonly execArgv?: ReadonlyArray<string>;
    }
  ) => Promise<JsonObject>;
}

let daemonClientModulePromise: Promise<LocalDaemonClientModule> | undefined;

export function createLocalGuiServiceBridge(rootDir: string, layoutOverrides?: HarnessLayoutOverrides): GuiServiceBridge {
  const resolvedRootDir = path.resolve(rootDir);
  validateProjectPath(resolvedRootDir, ".");
  return createGuiServiceBridgeForDaemon(async (route, payload) => requestGuiRouteViaDaemon(resolvedRootDir, layoutOverrides, route, payload));
}

async function requestGuiRouteViaDaemon(
  rootDir: string,
  layoutOverrides: HarnessLayoutOverrides | undefined,
  route: ApiRouteContract,
  payload: unknown
): Promise<JsonObject> {
  try {
    const daemonClient = await loadDaemonClientModule();
    const userRoot = daemonClient.daemonUserRoot();
    const daemonId = daemonClient.daemonIdFromEnv();
    const target = daemonClient.resolveLocalDaemonTarget({
      rootDir,
      repoIdOverride: process.env.HARNESS_DAEMON_REPO_ID,
      userRoot,
      daemonId,
      autoRegisterSingleRepo: true
    });
    return await daemonClient.requestLocalDaemonJsonRpcForTarget(target, `repo.${route.id}`, {
      repo: { repoId: target.repoId },
      ...(isRecord(payload) ? { payload: payload as JsonObject } : {})
    }, 200, {
      entryPath: cliEntrypointPath(),
      idleExitMs: daemonIdleExitMs(),
      timeoutMs: daemonAutostartTimeoutMs(),
      ...(layoutOverrides ? { layoutOverrides } : {})
    });
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "daemon_unavailable",
        hint: `Harness daemon is unavailable: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
}

async function loadDaemonClientModule(): Promise<LocalDaemonClientModule> {
  daemonClientModulePromise ??= import(daemonClientModuleUrl()) as Promise<LocalDaemonClientModule>;
  return daemonClientModulePromise;
}

function daemonClientModuleUrl(): string {
  return new URL("../../../daemon/src/client/local-json-rpc-client.ts", import.meta.url).href;
}

function cliEntrypointPath(): string {
  const candidates = [
    fileURLToPath(new URL("../../../cli/src/index.ts", import.meta.url)),
    fileURLToPath(new URL("../../../cli/dist/cli/src/index.js", import.meta.url))
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Harness CLI entrypoint not found; checked ${candidates.join(", ")}`);
  return realpathSync(found);
}

function daemonIdleExitMs(): number {
  return positiveIntegerOr(process.env.HARNESS_DAEMON_IDLE_MS, defaultDaemonIdleExitMs);
}

function daemonAutostartTimeoutMs(): number {
  return positiveIntegerOr(process.env.HARNESS_DAEMON_AUTOSTART_TIMEOUT_MS, defaultDaemonAutostartTimeoutMs);
}

function positiveIntegerOr(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
