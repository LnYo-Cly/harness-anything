import type {
  AuthorityOperationEnvelope,
  AuthorityOperationRecord,
  AuthorityOperationReceipt,
  AuthorityProtocolTuple,
  ReplicaChangeRecord
} from "../../../application/src/index.ts";

export const authorityWireFrameType = "harness-authority-wire/v1" as const;

interface AuthorityWireFrameBase {
  readonly type: typeof authorityWireFrameType;
  readonly connectionGeneration: number;
}

export interface AuthorityHelloFrame extends AuthorityWireFrameBase {
  readonly kind: "hello";
  readonly requestId: string;
  readonly workspaceId: string;
  readonly channelNonceDigest: string;
  readonly protocol: AuthorityProtocolTuple;
}

export interface AuthoritySubmitFrame extends AuthorityWireFrameBase {
  readonly kind: "submit";
  readonly requestId: string;
  readonly envelope: AuthorityOperationEnvelope;
}

export interface AuthorityGetOperationFrame extends AuthorityWireFrameBase {
  readonly kind: "get_operation";
  readonly requestId: string;
  readonly workspaceId: string;
  readonly opId: string;
}

export type AuthorityRequestFrame = AuthorityHelloFrame | AuthoritySubmitFrame | AuthorityGetOperationFrame;

export interface AuthorityResponseFrame extends AuthorityWireFrameBase {
  readonly kind: "response";
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: AuthorityOperationReceipt | AuthorityOperationRecord | AuthorityHelloResult | null;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface AuthorityReplicaChangeFrame extends AuthorityWireFrameBase {
  readonly kind: "replica_change";
  readonly change: ReplicaChangeRecord;
}

export interface AuthorityStreamClosedFrame extends AuthorityWireFrameBase {
  readonly kind: "stream_closed";
  readonly code: "BACKPRESSURE" | "UPGRADE_REQUIRED" | "SERVER_SHUTDOWN";
  readonly lastDurableRevision: number;
  readonly message: string;
}

export interface AuthorityHelloResult {
  readonly accepted: true;
  readonly protocol: AuthorityProtocolTuple;
  readonly capabilities: ReadonlyArray<string>;
}

export type AuthorityServerFrame = AuthorityResponseFrame | AuthorityReplicaChangeFrame | AuthorityStreamClosedFrame;

export function isAuthorityRequestFrame(value: unknown): value is AuthorityRequestFrame {
  if (!isBase(value) || typeof value.kind !== "string" || typeof value.requestId !== "string") return false;
  if (value.kind === "hello") {
    return typeof value.workspaceId === "string"
      && typeof value.channelNonceDigest === "string"
      && isProtocolTuple(value.protocol);
  }
  if (value.kind === "submit") return isObject(value.envelope);
  if (value.kind === "get_operation") return typeof value.workspaceId === "string" && typeof value.opId === "string";
  return false;
}

export function isAuthorityServerFrame(value: unknown): value is AuthorityServerFrame {
  if (!isBase(value) || typeof value.kind !== "string") return false;
  if (value.kind === "response") return typeof value.requestId === "string" && typeof value.ok === "boolean";
  if (value.kind === "replica_change") return isObject(value.change);
  return value.kind === "stream_closed"
    && typeof value.code === "string"
    && typeof value.lastDurableRevision === "number"
    && typeof value.message === "string";
}

export function sameAuthorityProtocol(left: AuthorityProtocolTuple, right: AuthorityProtocolTuple): boolean {
  return left.wire === right.wire
    && left.event === right.event
    && left.receipt === right.receipt
    && left.digest === right.digest
    && left.commandRegistry === right.commandRegistry;
}

function isBase(value: unknown): value is Record<string, unknown> & AuthorityWireFrameBase {
  return isObject(value)
    && value.type === authorityWireFrameType
    && typeof value.connectionGeneration === "number";
}

function isProtocolTuple(value: unknown): value is AuthorityProtocolTuple {
  return isObject(value)
    && typeof value.wire === "number"
    && typeof value.event === "number"
    && typeof value.receipt === "number"
    && typeof value.digest === "number"
    && typeof value.commandRegistry === "number";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
