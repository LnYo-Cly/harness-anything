import type { LocalControllerService } from "../../../application/src/index.ts";
import type { PreloadApiMethod } from "../preload/allowlist.ts";

export type ApiRouteMethod = "GET" | "POST" | "PUT" | "DELETE" | "WS";
export type ApiRouteAuth = "local-session-token" | "ssh-tunnel-local-token" | "none";

export interface ApiRouteContract {
  readonly id: string;
  readonly method: ApiRouteMethod;
  readonly path: string;
  readonly inputSchemaId: string;
  readonly outputSchemaId?: string;
  readonly errorSchemaId: string;
  readonly service: "LocalControllerService";
  readonly serviceMethod: keyof LocalControllerService;
  readonly auth: ApiRouteAuth;
  readonly guiBridgeMethod: PreloadApiMethod;
}

export interface ApiSchemaContract {
  readonly id: string;
  readonly owner: "application" | "gui";
  readonly typeName: string;
}

export interface DeferredGuiBridgeContract {
  readonly guiBridgeMethod: PreloadApiMethod;
  readonly service: "LocalControllerService";
  readonly serviceMethod: keyof LocalControllerService;
  readonly reason: string;
}

export interface EmptyGuiPayload {
  readonly kind?: "empty";
}

export const apiSchemaContracts = [
  { id: "gui.empty/v1", owner: "gui", typeName: "EmptyGuiPayload" },
  { id: "application.append-task-progress-payload/v1", owner: "application", typeName: "AppendTaskProgressPayload" },
  { id: "application.local-controller-error/v1", owner: "application", typeName: "LocalControllerError" },
  { id: "application.local-controller-result/v1", owner: "application", typeName: "LocalControllerResult" },
  { id: "application.set-task-status-payload/v1", owner: "application", typeName: "SetTaskStatusPayload" },
  { id: "application.task-detail-result/v1", owner: "application", typeName: "TaskDetailResult" },
  { id: "application.task-document-payload/v1", owner: "application", typeName: "TaskDocumentPayload" },
  { id: "application.task-document-result/v1", owner: "application", typeName: "TaskDocumentResult" },
  { id: "application.task-id-payload/v1", owner: "application", typeName: "TaskIdPayload" },
  { id: "application.task-list-result/v1", owner: "application", typeName: "TaskListResult" }
] as const satisfies ReadonlyArray<ApiSchemaContract>;

export const apiRouteContracts = [
  {
    id: "tasks.list",
    method: "GET",
    path: "/api/tasks",
    inputSchemaId: "gui.empty/v1",
    outputSchemaId: "application.task-list-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "getTasks",
    auth: "local-session-token",
    guiBridgeMethod: "getTasks"
  },
  {
    id: "tasks.detail",
    method: "GET",
    path: "/api/tasks/:taskId",
    inputSchemaId: "application.task-id-payload/v1",
    outputSchemaId: "application.task-detail-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "getTaskDetail",
    auth: "local-session-token",
    guiBridgeMethod: "getTaskDetail"
  },
  {
    id: "tasks.document.read",
    method: "GET",
    path: "/api/tasks/:taskId/documents/:path",
    inputSchemaId: "application.task-document-payload/v1",
    outputSchemaId: "application.task-document-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "getTaskDocument",
    auth: "local-session-token",
    guiBridgeMethod: "getTaskDocument"
  },
  {
    id: "tasks.status.set",
    method: "POST",
    path: "/api/tasks/:taskId/status",
    inputSchemaId: "application.set-task-status-payload/v1",
    outputSchemaId: "application.local-controller-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "setTaskStatus",
    auth: "local-session-token",
    guiBridgeMethod: "setTaskStatus"
  },
  {
    id: "tasks.review",
    method: "POST",
    path: "/api/tasks/:taskId/review",
    inputSchemaId: "application.task-id-payload/v1",
    outputSchemaId: "application.local-controller-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "reviewTask",
    auth: "local-session-token",
    guiBridgeMethod: "reviewTask"
  },
  {
    id: "tasks.progress.append",
    method: "POST",
    path: "/api/tasks/:taskId/progress",
    inputSchemaId: "application.append-task-progress-payload/v1",
    outputSchemaId: "application.local-controller-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "appendTaskProgress",
    auth: "local-session-token",
    guiBridgeMethod: "appendTaskProgress"
  },
  {
    id: "governance.rebuild",
    method: "POST",
    path: "/api/governance/rebuild",
    inputSchemaId: "gui.empty/v1",
    outputSchemaId: "application.task-list-result/v1",
    errorSchemaId: "application.local-controller-error/v1",
    service: "LocalControllerService",
    serviceMethod: "rebuildGovernance",
    auth: "local-session-token",
    guiBridgeMethod: "rebuildGovernance"
  }
] as const satisfies ReadonlyArray<ApiRouteContract>;

export const deferredGuiBridgeContracts = [
  {
    guiBridgeMethod: "archiveTask",
    service: "LocalControllerService",
    serviceMethod: "archiveTask",
    reason: "Archive is exposed in the preload allowlist as a disabled placeholder until the closeout/archive route contract is implemented."
  },
  {
    guiBridgeMethod: "openShell",
    service: "LocalControllerService",
    serviceMethod: "openShell",
    reason: "Shell opening is display-only GUI policy until M25GUI-P03 defines terminal session routes and metadata."
  }
] as const satisfies ReadonlyArray<DeferredGuiBridgeContract>;
