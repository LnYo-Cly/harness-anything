import path from "node:path";
import { Schema } from "effect";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { stablePayloadHash } from "../integrity/stable-hash.ts";
import { AttributionEventSchema, type AttributionEvent } from "../schemas/attribution-event.ts";
import { localLayoutFileSystem } from "./local-layout-file-system.ts";

export interface AttributionEventSourceInput {
  readonly relativePath: string;
  readonly body: string;
}

export interface AttributionEventSource {
  readonly inputs: ReadonlyArray<AttributionEventSourceInput>;
  readonly hash: string;
}

export function readAttributionEvents(rootInput: HarnessLayoutInput): ReadonlyArray<AttributionEvent> {
  return readAttributionEventsFromSource(readAttributionEventSource(rootInput));
}

export function readAttributionEventSource(rootInput: HarnessLayoutInput): AttributionEventSource {
  const eventsRoot = resolveHarnessLayout(rootInput).attributionEventsRoot;
  const inputs = localLayoutFileSystem.exists(eventsRoot)
    ? localLayoutFileSystem.readDirents(eventsRoot)
    .filter((entry) => !entry.isDirectory() && entry.name.endsWith(".jsonl"))
    .map((entry) => ({
      relativePath: entry.name,
      body: localLayoutFileSystem.readText(path.join(eventsRoot, entry.name))
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    : [];
  return {
    inputs,
    hash: stablePayloadHash({ schema: "attribution-event-source/v1", inputs })
  };
}

export function readAttributionEventsFromSource(source: AttributionEventSource): ReadonlyArray<AttributionEvent> {
  return source.inputs
    .map((input) => decodeAttributionEvent(input.body))
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
}

export function attributionEventSourceHash(rootInput: HarnessLayoutInput): string {
  return readAttributionEventSource(rootInput).hash;
}

function decodeAttributionEvent(body: string): AttributionEvent {
  const lines = body.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("immutable attribution event shard must contain exactly one event");
  return Schema.decodeUnknownSync(AttributionEventSchema)(JSON.parse(lines[0]!));
}
