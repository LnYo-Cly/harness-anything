import type { Readable, Writable } from "node:stream";
import type { AcceptedConnectionBinding } from "../protocol/connection-context.ts";
import type {
  AcceptedConnectionEvidence,
  DaemonAuthenticationContext
} from "./auth-context.ts";
import type { SshAuthorityWireBootstrapFrame } from "./ssh-forced-command.ts";

export interface AuthorityWireIngressSession {
  readonly close: () => Promise<void>;
}

/**
 * Server-owned handoff after the versioned SSH bootstrap has been accepted.
 * The raw streams begin immediately after the consumed JSON-line bootstrap.
 */
export interface AuthorityWireIngressRequest {
  readonly bootstrap: SshAuthorityWireBootstrapFrame;
  readonly authContext: DaemonAuthenticationContext & {
    readonly sshForcedCommand: NonNullable<DaemonAuthenticationContext["sshForcedCommand"]>;
  };
  readonly input: Readable;
  readonly output: Writable;
  readonly acceptedConnection: AcceptedConnectionBinding;
  readonly acceptedConnectionEvidence: AcceptedConnectionEvidence;
}

export type AuthorityWireIngressHandler = (
  request: AuthorityWireIngressRequest
) => AuthorityWireIngressSession | void | Promise<AuthorityWireIngressSession | void>;
