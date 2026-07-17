import {
  decodeDaemonStatusRequestV2,
  decodeDaemonStatusResultV2,
  type DaemonStatusService
} from "../../../application/src/index.ts";
import { failureReceipt, successReceipt } from "./receipt-envelope.ts";
import type { JsonObject } from "./json-rpc-types.ts";

interface DaemonStatusRepoContext {
  readonly repoId: string;
  readonly canonicalRoot: string;
}

/** Validates the daemon-status/v2 wire boundary before a success receipt is emitted. */
export async function callDaemonStatusService(
  method: string,
  params: JsonObject,
  service: DaemonStatusService | undefined,
  repo: DaemonStatusRepoContext | undefined
): Promise<ReturnType<typeof successReceipt> | ReturnType<typeof failureReceipt>> {
  if (!service) {
    return failureReceipt(method, "daemon_status_service_unavailable", "Daemon status service is not configured.");
  }
  try {
    decodeDaemonStatusRequestV2(params);
    const status = decodeDaemonStatusResultV2(await service.getStatus(repo ? { repo } : undefined));
    return successReceipt(method, "read daemon status", status as unknown as JsonObject);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "invalid_daemon_status_request") {
      return failureReceipt(method, "daemon_status_request_invalid", "Daemon status request is outside daemon-status-request/v2.");
    }
    return failureReceipt(method, "daemon_status_result_invalid", "Daemon status service returned data outside daemon-status/v2.");
  }
}
