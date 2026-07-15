import type { ExecutionActor } from "./execution.ts";
import type { ConsentSnapshot } from "./consent.ts";

export const reviewVerdicts = ["approved", "changes_requested", "dismissed"] as const;
export type ReviewVerdict = (typeof reviewVerdicts)[number];

export interface ReviewRecord {
  readonly schema: "review/v3";
  readonly review_id: string;
  readonly task_ref: string;
  readonly execution_ref: string;
  readonly reviewer_actor: ExecutionActor;
  readonly reviewer_session_ref: string;
  readonly findings: string;
  readonly evidence_checked: ReadonlyArray<string>;
  readonly rationale: string;
  readonly verdict: ReviewVerdict;
  readonly archive_warnings_acknowledged: boolean;
  readonly approval_basis:
    | null
    | {
        readonly kind: "human-consent";
        readonly consent_ref: string;
        readonly consent_snapshot: ConsentSnapshot;
      }
    | { readonly kind: "legacy-unverified" };
  readonly reviewed_at: string;
}
