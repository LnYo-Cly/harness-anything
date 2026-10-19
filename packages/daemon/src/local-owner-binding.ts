/** @daemon-transport-authority Single-user local mode: the daemon socket owner acts without Keycloak. */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { DaemonAuthenticationContext } from "./transport/auth-context.ts";

// ponytail: the socket boundary (0700 dir / per-user named pipe) is the only authority here, as in
// the pre-Keycloak daemon. Anyone who can open the socket is the owner; use Keycloak for shared hosts.

/** True when the caller reached the daemon through its own local socket as the daemon's user. */
export function isDaemonSocketOwner(auth: DaemonAuthenticationContext): boolean {
  const daemonUid = process.getuid?.(),
    ownerUid = auth.unixSocketOwnerBoundary?.ownerUid;
  return (
    auth.transportKind === "unix-socket" &&
    typeof ownerUid === "number" &&
    (typeof daemonUid === "number" ? ownerUid === daemonUid : process.platform === "win32" && ownerUid === 0)
  );
}

/**
 * The person `harness/people.yaml` binds to this host's socket owner, so a migrated ledger keeps
 * acting as the same owner it recorded; `local-user-<uid>` when the roster has no such binding.
 */
export function localOwnerPersonId(rootDir: string | undefined, ownerUid: number): string {
  const fallback = `local-user-${ownerUid}`,
    file = rootDir ? path.join(rootDir, "harness", "people.yaml") : undefined;
  if (!file || !existsSync(file)) return fallback;
  const roster = parseYaml(readFileSync(file, "utf8")) as {
    readonly people?: readonly {
      readonly personId?: string;
      readonly disabled?: boolean;
      readonly credentials?: readonly {
        readonly kind?: string;
        readonly issuer?: string;
        readonly subject?: unknown;
      }[];
    }[];
  } | null;
  const issuer = `host:${os.hostname()}`;
  const person = roster?.people?.find(
    (candidate) =>
      !candidate.disabled &&
      candidate.credentials?.some(
        (credential) =>
          credential.kind === "unix-socket-owner-boundary" &&
          credential.issuer === issuer &&
          String(credential.subject) === String(ownerUid),
      ),
  );
  return typeof person?.personId === "string" ? person.personId : fallback;
}
