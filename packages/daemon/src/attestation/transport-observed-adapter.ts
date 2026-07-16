import { createHash } from "node:crypto";
import type { AuthorityConnectionContext } from "../protocol/connection-context.ts";
import { credentialKey } from "../identity/types.ts";
import { constantTimeStringEqual } from "./constant-time.ts";
import {
  localIpcAttestationProtocol,
  type AttestationProofInput,
  type AttestationProofProvider,
  type AttestationProofVerifier
} from "./types.ts";

const transportObservedProofDomain = "ha/transport-observed-attestation/v1\0";

export interface TransportObservedAttestationAdapter {
  readonly proofProvider: AttestationProofProvider;
  readonly proofVerifier: AttestationProofVerifier;
}

/**
 * Adapts evidence already observed on the accepted transport connection. This
 * is not a new signing root: it is valid only while the caller retains the
 * exact AuthorityConnectionContext produced for that live connection.
 */
export function createTransportObservedAttestationAdapter(
  context: AuthorityConnectionContext
): TransportObservedAttestationAdapter {
  const expectedChannel = Buffer.from(context.channelBinding.digest).toString("hex");
  const expectedChallengeDigest = createHash("sha256").update(expectedChannel, "utf8").digest("hex");
  const expectedCredential = credentialKey(context.actor.resolvedCredential);
  const proof = (input: AttestationProofInput): string | undefined => {
    if (input.challenge.protocol !== localIpcAttestationProtocol
      || input.challenge.channelBindingDigest !== expectedChallengeDigest
      || credentialKey(input.credential) !== expectedCredential
      || !input.canonicalTranscript) return undefined;
    return createHash("sha256")
      .update(transportObservedProofDomain, "utf8")
      .update(context.connectionId, "utf8")
      .update("\0", "utf8")
      .update(context.connectionGeneration, "utf8")
      .update("\0", "utf8")
      .update(expectedChannel, "utf8")
      .update("\0", "utf8")
      .update(peerCredentialTuple(context), "utf8")
      .update("\0", "utf8")
      .update(input.canonicalTranscript, "utf8")
      .digest("base64url");
  };
  return {
    proofProvider: {
      issue: async (input) => proof(input) ?? ""
    },
    proofVerifier: {
      verify: async (input) => {
        const expected = proof(input);
        return expected !== undefined && constantTimeStringEqual(expected, input.proof);
      }
    }
  };
}

function peerCredentialTuple(context: AuthorityConnectionContext): string {
  const peer = context.peerCredential;
  return [peer.schema, peer.platform, peer.source, peer.uid, peer.gid, peer.pid ?? ""].join("\0");
}
