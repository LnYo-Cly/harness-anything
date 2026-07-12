import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "./durable-state-store.ts";
import type { BrokerVersion, ManagedFingerprint } from "./types.ts";

export type ConflictReason =
  | "REMOTE_CHANGED_DIRTY_PATH"
  | "PRECHECK_FINGERPRINT_MISMATCH"
  | "AUTHORITY_REJECTED"
  | "RECOVERY_GENERATION_AMBIGUOUS"
  | "BLOCKED_DECISION";

export interface LocalConflictRecord {
  readonly schema: "local-conflict/v1";
  readonly conflictId: string;
  readonly workspaceId: string;
  readonly viewId: string;
  readonly path: string;
  readonly reason: ConflictReason;
  readonly createdAt: string;
  readonly baseVersion: BrokerVersion | null;
  readonly theirsVersion: BrokerVersion | null;
  readonly oursFingerprint: ManagedFingerprint;
  readonly authorityReason?: string;
  readonly opId?: string;
}

export interface LocalConflictEvent {
  readonly type: "local_conflict_created";
  readonly record: LocalConflictRecord;
  readonly directory: string;
}

export class LocalConflictStore {
  private readonly root: string;
  private readonly listeners = new Set<(event: LocalConflictEvent) => void | Promise<void>>();

  constructor(stateRoot: string) {
    this.root = path.join(stateRoot, "conflicts");
  }

  onConflict(listener: (event: LocalConflictEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async create(input: {
    readonly workspaceId: string;
    readonly viewId: string;
    readonly path: string;
    readonly reason: ConflictReason;
    readonly baseVersion: BrokerVersion | null;
    readonly theirsVersion: BrokerVersion | null;
    readonly oursFingerprint: ManagedFingerprint;
    readonly base?: Uint8Array;
    readonly ours?: Uint8Array;
    readonly theirs?: Uint8Array;
    readonly authorityReason?: string;
    readonly opId?: string;
    readonly notify?: boolean;
  }): Promise<LocalConflictEvent> {
    const conflictId = `conflict-${Date.now().toString(36)}-${randomUUID().slice(0, 12)}`;
    const directory = path.join(this.root, conflictId);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    const record: LocalConflictRecord = {
      schema: "local-conflict/v1",
      conflictId,
      workspaceId: input.workspaceId,
      viewId: input.viewId,
      path: input.path,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      baseVersion: input.baseVersion,
      theirsVersion: input.theirsVersion,
      oursFingerprint: input.oursFingerprint,
      ...(input.authorityReason ? { authorityReason: input.authorityReason } : {}),
      ...(input.opId ? { opId: input.opId } : {})
    };
    await Promise.all([
      input.base ? atomicWrite(path.join(directory, "base"), input.base) : Promise.resolve(),
      input.ours ? atomicWrite(path.join(directory, "ours"), input.ours) : Promise.resolve(),
      input.theirs ? atomicWrite(path.join(directory, "theirs"), input.theirs) : Promise.resolve()
    ]);
    await atomicWrite(path.join(directory, "metadata.json"), Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8"));
    const event: LocalConflictEvent = { type: "local_conflict_created", record, directory };
    if (input.notify !== false) await this.publish(event);
    return event;
  }

  async publish(event: LocalConflictEvent): Promise<void> {
    await Promise.allSettled([...this.listeners].map((listener) => listener(event)));
  }

  async read(conflictId: string): Promise<{ readonly record: LocalConflictRecord; readonly directory: string }> {
    if (!/^conflict-[a-z0-9-]+$/u.test(conflictId)) throw new Error("invalid conflict id");
    const directory = path.join(this.root, conflictId);
    const record = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")) as LocalConflictRecord;
    if (record.schema !== "local-conflict/v1" || record.conflictId !== conflictId) throw new Error("invalid conflict record");
    return { record, directory };
  }

  async list(): Promise<ReadonlyArray<LocalConflictEvent>> {
    let entries: ReadonlyArray<string>;
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const events: LocalConflictEvent[] = [];
    for (const conflictId of [...entries].sort()) {
      if (!/^conflict-[a-z0-9-]+$/u.test(conflictId)) continue;
      const item = await this.read(conflictId);
      events.push({ type: "local_conflict_created", record: item.record, directory: item.directory });
    }
    return events;
  }
}
