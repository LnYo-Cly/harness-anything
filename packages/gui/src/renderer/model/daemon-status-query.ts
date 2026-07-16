import { useQuery } from "@tanstack/react-query";
import { loadDaemonStatusFixture } from "./daemon-status-fixture.ts";
import type { DaemonStatusModel } from "./daemon-status.ts";

export const daemonStatusQueryKeys = {
  all: ["harness", "daemon-status"] as const,
  current: () => [...daemonStatusQueryKeys.all, "current"] as const,
};

/**
 * Loads daemon status for the Settings → System panel.
 *
 * // TODO(daemon-wire): replace fixture with harnessClient.getDaemonStatus() once X4 route lands
 */
async function fetchDaemonStatus(): Promise<DaemonStatusModel> {
  // TODO(daemon-wire): replace fixture with harnessClient.getDaemonStatus() once X4 route lands
  return loadDaemonStatusFixture();
}

export function useDaemonStatusQuery() {
  return useQuery({
    queryKey: daemonStatusQueryKeys.current(),
    queryFn: fetchDaemonStatus,
    staleTime: 5_000,
  });
}
