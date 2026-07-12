import type { LocalConflictEvent } from "../broker/conflict-store.ts";

export type ResolverPreviewStatus = "CONFIRMATION_REQUIRED" | "MANUAL_ARBITRATION_REQUIRED";

export interface ResolverPreview {
  readonly schema: "resolver-preview/v1";
  readonly previewId: string;
  readonly conflictId: string;
  readonly path: string;
  readonly status: ResolverPreviewStatus;
  readonly previewPath: string | null;
  readonly confirmationToken: string | null;
  readonly strategy: "OURS" | "THEIRS" | "THREE_WAY_MARKED" | "BLOCKED_DECISION";
  readonly createdAt: string;
}

export interface ConfirmedResolution {
  readonly schema: "confirmed-resolution/v1";
  readonly previewId: string;
  readonly conflictId: string;
  readonly path: string;
  readonly resolvedContent: Uint8Array;
  readonly confirmedAt: string;
  readonly canonicalSubmitRequired: true;
}

export interface ResolverConflictConsumer {
  readonly consume: (event: LocalConflictEvent) => Promise<ResolverPreview>;
}
