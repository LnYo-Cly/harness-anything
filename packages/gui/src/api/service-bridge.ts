import type { PreloadApiMethod } from "../preload/allowlist.ts";
import { apiRouteContracts, deferredGuiBridgeContracts, type ApiRouteContract } from "./api-contract-registry.ts";

// Contract anchor: document path normalization remains owned by the daemon-side
// LocalControllerService via kernel normalizeRelativeDocumentPath. GUI main must
// not import that kernel barrel because it would reintroduce the sqlite ABI path.
export interface GuiServiceBridge {
  readonly invoke: (method: string, payload: unknown) => Promise<unknown>;
}

type JsonObject = { readonly [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonObject | ReadonlyArray<JsonValue>;
type ShippedGuiBridgeRoute = Extract<(typeof apiRouteContracts)[number], { readonly guiBridgeMethod: PreloadApiMethod }>;
type ShippedGuiBridgeMethod = ShippedGuiBridgeRoute["guiBridgeMethod"];
type LocalControllerGuiMethod =
  | "getTasks"
  | "getTaskDetail"
  | "getTaskDocument"
  | "setTaskStatus"
  | "reviewTask"
  | "appendTaskProgress"
  | "rebuildGovernance";

interface GuiBridgeServiceProxy {
  readonly getTasks: () => Promise<unknown> | unknown;
  readonly getTaskDetail: (payload: unknown) => Promise<unknown> | unknown;
  readonly getTaskDocument: (payload: unknown) => Promise<unknown> | unknown;
  readonly setTaskStatus: (payload: unknown) => Promise<unknown> | unknown;
  readonly reviewTask: (payload: unknown) => Promise<unknown> | unknown;
  readonly appendTaskProgress: (payload: unknown) => Promise<unknown> | unknown;
  readonly rebuildGovernance: () => Promise<unknown> | unknown;
}

interface GuiBridgeHandlerContext {
  readonly service: GuiBridgeServiceProxy;
  readonly payload: unknown;
}

interface GuiBridgeHandlerImplementation {
  readonly serviceMethod: LocalControllerGuiMethod;
  readonly invoke: (context: GuiBridgeHandlerContext) => Promise<unknown> | unknown;
}

export const guiBridgeHandlerImplementations = {
  getTasks: {
    serviceMethod: "getTasks",
    invoke: ({ service }) => service.getTasks()
  },
  getTaskDetail: {
    serviceMethod: "getTaskDetail",
    invoke: ({ service, payload }) => service.getTaskDetail(payload)
  },
  getTaskDocument: {
    serviceMethod: "getTaskDocument",
    invoke: ({ service, payload }) => service.getTaskDocument(payload)
  },
  setTaskStatus: {
    serviceMethod: "setTaskStatus",
    invoke: ({ service, payload }) => service.setTaskStatus(payload)
  },
  reviewTask: {
    serviceMethod: "reviewTask",
    invoke: ({ service, payload }) => service.reviewTask(payload)
  },
  appendTaskProgress: {
    serviceMethod: "appendTaskProgress",
    invoke: ({ service, payload }) => service.appendTaskProgress(payload)
  },
  rebuildGovernance: {
    serviceMethod: "rebuildGovernance",
    invoke: ({ service }) => service.rebuildGovernance()
  }
} as const satisfies Record<ShippedGuiBridgeMethod, GuiBridgeHandlerImplementation>;

export type GuiDaemonRequester = (route: ApiRouteContract, payload: unknown) => Promise<JsonObject>;

export function getShippedGuiBridgeMethods(): ReadonlyArray<ShippedGuiBridgeMethod> {
  return apiRouteContracts.flatMap((route) => "guiBridgeMethod" in route && route.guiBridgeMethod ? [route.guiBridgeMethod] : []) as ReadonlyArray<ShippedGuiBridgeMethod>;
}

const shippedGuiBridgeMethods = new Set<PreloadApiMethod>(getShippedGuiBridgeMethods());
const routeByGuiMethod = new Map<PreloadApiMethod, ApiRouteContract>(
  apiRouteContracts.flatMap((route) => "guiBridgeMethod" in route && route.guiBridgeMethod ? [[route.guiBridgeMethod as PreloadApiMethod, route]] : [])
);
const deferredGuiBridgeReasons = new Map<PreloadApiMethod, string>(
  deferredGuiBridgeContracts.map((entry) => [entry.guiBridgeMethod, entry.reason])
);

export function createGuiServiceBridgeForDaemon(request: GuiDaemonRequester): GuiServiceBridge {
  const service = createDaemonServiceProxy(request);
  return {
    invoke: async (method, payload) => dispatchGuiServiceMethod(service, method, payload)
  };
}

export async function dispatchGuiServiceMethod(
  service: GuiBridgeServiceProxy,
  method: string,
  payload: unknown
): Promise<unknown> {
  if (shippedGuiBridgeMethods.has(method as PreloadApiMethod)) {
    const handler = guiBridgeHandlerImplementations[method as ShippedGuiBridgeMethod];
    return handler.invoke({ service, payload });
  }
  const deferredReason = deferredGuiBridgeReasons.get(method as PreloadApiMethod);
  if (deferredReason) {
    return {
      ok: false,
      error: {
        code: "method_deferred",
        hint: deferredReason
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "method_not_allowed",
      hint: `Unsupported GUI service method: ${method}`
    }
  };
}

function createDaemonServiceProxy(request: GuiDaemonRequester): GuiBridgeServiceProxy {
  return {
    getTasks: () => invokeDaemonGuiRoute(request, "getTasks", undefined),
    getTaskDetail: (payload) => invokeDaemonGuiRoute(request, "getTaskDetail", payload),
    getTaskDocument: (payload) => invokeDaemonGuiRoute(request, "getTaskDocument", payload),
    setTaskStatus: (payload) => invokeDaemonGuiRoute(request, "setTaskStatus", payload),
    reviewTask: (payload) => invokeDaemonGuiRoute(request, "reviewTask", payload),
    appendTaskProgress: (payload) => invokeDaemonGuiRoute(request, "appendTaskProgress", payload),
    rebuildGovernance: () => invokeDaemonGuiRoute(request, "rebuildGovernance", undefined)
  };
}

async function invokeDaemonGuiRoute(
  request: GuiDaemonRequester,
  method: PreloadApiMethod,
  payload: unknown
): Promise<unknown> {
  const route = routeByGuiMethod.get(method);
  if (!route) {
    return {
      ok: false,
      error: {
        code: "method_not_allowed",
        hint: `Unsupported GUI service method: ${method}`
      }
    };
  }
  const receipt = await request(route, payload);
  return unwrapDaemonReceipt(receipt);
}

function unwrapDaemonReceipt(receipt: JsonObject): unknown {
  const details = isRecord(receipt.details) ? receipt.details : undefined;
  const data = isRecord(details?.data) ? details.data : undefined;
  if (data) return data;
  if (receipt.ok === false) {
    const error = isRecord(receipt.error) ? receipt.error : {};
    return {
      ok: false,
      error: {
        code: typeof error.code === "string" ? error.code : "daemon_error",
        hint: typeof error.hint === "string" ? error.hint : "Daemon request failed."
      }
    };
  }
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
