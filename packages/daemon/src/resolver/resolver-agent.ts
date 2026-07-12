import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../broker/durable-state-store.ts";
import type { LocalConflictEvent, LocalConflictStore } from "../broker/conflict-store.ts";
import type { ConfirmedResolution, ResolverPreview } from "./types.ts";

export class ResolverAgent {
  private readonly previewsRoot: string;
  private readonly previews = new Map<string, ResolverPreview>();

  constructor(options: { readonly stateRoot: string }) {
    this.previewsRoot = path.join(options.stateRoot, "resolver-previews");
  }

  attach(store: LocalConflictStore): () => void {
    return store.onConflict(async (event) => {
      await this.consume(event);
    });
  }

  async replay(store: LocalConflictStore): Promise<ReadonlyArray<ResolverPreview>> {
    const previews: ResolverPreview[] = [];
    for (const event of await store.list()) previews.push(await this.consume(event));
    return previews;
  }

  async consume(event: LocalConflictEvent): Promise<ResolverPreview> {
    const previewId = `preview-${randomUUID()}`;
    if (event.record.reason === "BLOCKED_DECISION") {
      const preview: ResolverPreview = {
        schema: "resolver-preview/v1",
        previewId,
        conflictId: event.record.conflictId,
        path: event.record.path,
        status: "MANUAL_ARBITRATION_REQUIRED",
        previewPath: null,
        confirmationToken: null,
        strategy: "BLOCKED_DECISION",
        createdAt: new Date().toISOString()
      };
      await this.persist(preview);
      return preview;
    }
    const [base, ours, theirs] = await Promise.all([
      readOptional(path.join(event.directory, "base")),
      readOptional(path.join(event.directory, "ours")),
      readOptional(path.join(event.directory, "theirs"))
    ]);
    const merged = mergePreview(base, ours, theirs);
    const previewPath = path.join(this.previewsRoot, previewId, "merged-preview");
    await atomicWrite(previewPath, merged.content);
    const preview: ResolverPreview = {
      schema: "resolver-preview/v1",
      previewId,
      conflictId: event.record.conflictId,
      path: event.record.path,
      status: "CONFIRMATION_REQUIRED",
      previewPath,
      confirmationToken: randomUUID(),
      strategy: merged.strategy,
      createdAt: new Date().toISOString()
    };
    await this.persist(preview);
    return preview;
  }

  async confirm(previewId: string, confirmationToken: string): Promise<ConfirmedResolution> {
    const preview = this.previews.get(previewId) ?? await this.load(previewId);
    if (!isConfirmable(preview)) {
      throw new Error("resolver preview requires manual arbitration and cannot be confirmed here");
    }
    if (preview.confirmationToken !== confirmationToken) throw new Error("resolver confirmation token mismatch");
    return {
      schema: "confirmed-resolution/v1",
      previewId,
      conflictId: preview.conflictId,
      path: preview.path,
      resolvedContent: await readFile(preview.previewPath),
      confirmedAt: new Date().toISOString(),
      canonicalSubmitRequired: true
    };
  }

  private async persist(preview: ResolverPreview): Promise<void> {
    const directory = path.join(this.previewsRoot, preview.previewId);
    await atomicWrite(path.join(directory, "preview.json"), Buffer.from(`${JSON.stringify(preview, null, 2)}\n`, "utf8"));
    this.previews.set(preview.previewId, preview);
  }

  private async load(previewId: string): Promise<ResolverPreview> {
    if (!/^preview-[a-f0-9-]+$/u.test(previewId)) throw new Error("invalid resolver preview id");
    const preview = JSON.parse(await readFile(path.join(this.previewsRoot, previewId, "preview.json"), "utf8")) as ResolverPreview;
    if (preview.schema !== "resolver-preview/v1" || preview.previewId !== previewId) throw new Error("invalid resolver preview");
    this.previews.set(previewId, preview);
    return preview;
  }
}

function isConfirmable(preview: ResolverPreview): preview is ResolverPreview & {
  readonly previewPath: string;
  readonly confirmationToken: string;
} {
  return preview.status === "CONFIRMATION_REQUIRED"
    && preview.previewPath !== null
    && preview.confirmationToken !== null;
}

function mergePreview(
  base: Buffer | undefined,
  ours: Buffer | undefined,
  theirs: Buffer | undefined
): { readonly content: Buffer; readonly strategy: "OURS" | "THEIRS" | "THREE_WAY_MARKED" } {
  const baseBytes = base ?? Buffer.alloc(0);
  const oursBytes = ours ?? Buffer.alloc(0);
  const theirsBytes = theirs ?? Buffer.alloc(0);
  if (oursBytes.equals(baseBytes)) return { content: theirsBytes, strategy: "THEIRS" };
  if (theirsBytes.equals(baseBytes) || oursBytes.equals(theirsBytes)) return { content: oursBytes, strategy: "OURS" };
  const content = Buffer.from([
    "<<<<<<< LOCAL OURS\n",
    oursBytes.toString("utf8"),
    oursBytes.at(-1) === 10 ? "" : "\n",
    "||||||| FROZEN BASE\n",
    baseBytes.toString("utf8"),
    baseBytes.at(-1) === 10 ? "" : "\n",
    "=======\n",
    theirsBytes.toString("utf8"),
    theirsBytes.at(-1) === 10 ? "" : "\n",
    ">>>>>>> CANONICAL THEIRS\n"
  ].join(""), "utf8");
  return { content, strategy: "THREE_WAY_MARKED" };
}

async function readOptional(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
