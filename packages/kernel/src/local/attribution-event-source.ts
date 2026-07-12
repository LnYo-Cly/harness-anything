import path from "node:path";
import { Schema } from "effect";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { stablePayloadHash } from "../integrity/stable-hash.ts";
import { AttributionEventSchema, type AttributionEvent } from "../schemas/attribution-event.ts";
import { localLayoutFileSystem } from "./local-layout-file-system.ts";

export function readAttributionEvents(rootInput: HarnessLayoutInput): ReadonlyArray<AttributionEvent> {
  const eventsRoot = resolveHarnessLayout(rootInput).attributionEventsRoot;
  if (!localLayoutFileSystem.exists(eventsRoot)) return [];
  return localLayoutFileSystem.readDirents(eventsRoot)
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith(".jsonl"))
    .map((entry) => decodeAttributionEvent(localLayoutFileSystem.readText(path.join(eventsRoot, entry.name))))
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
}

export function attributionEventSourceHash(rootInput: HarnessLayoutInput): string {
  return stablePayloadHash(readAttributionEvents(rootInput));
}

function decodeAttributionEvent(body: string): AttributionEvent {
  const lines = body.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("immutable attribution event shard must contain exactly one event");
  return Schema.decodeUnknownSync(AttributionEventSchema)(JSON.parse(lines[0]!));
}
