import path from "node:path";
import { Schema } from "effect";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { sha256Text, stablePayloadHash } from "../integrity/stable-hash.ts";
import { AttributionEventSchema, type AttributionEvent } from "../schemas/attribution-event.ts";
import { localLayoutFileSystem, localProjectionSourceFileSystem } from "./local-layout-file-system.ts";

export interface AttributionEventSourceInput {
  readonly relativePath: string;
  readonly body: string;
  readonly statSignature: string;
  readonly contentSha256: string;
}

interface AttributionEventSourceCacheEntry {
  readonly source: AttributionEventSource;
  readonly signatures: ReadonlyMap<string, string>;
}

const attributionEventSourceCache = new Map<string, AttributionEventSourceCacheEntry>();
const attributionEventSourceCacheLimit = 16;

export interface AttributionEventSource {
  readonly inputs: ReadonlyArray<AttributionEventSourceInput>;
  readonly hash: string;
}

export function readAttributionEvents(rootInput: HarnessLayoutInput): ReadonlyArray<AttributionEvent> {
  return readAttributionEventsFromSource(readAttributionEventSource(rootInput));
}

export function readAttributionEventSource(rootInput: HarnessLayoutInput): AttributionEventSource {
  return readAttributionEventSourceAttempt(rootInput, 0);
}

function readAttributionEventSourceAttempt(rootInput: HarnessLayoutInput, attempt: number): AttributionEventSource {
  const eventsRoot = resolveHarnessLayout(rootInput).attributionEventsRoot;
  if (!localLayoutFileSystem.exists(eventsRoot)) {
    attributionEventSourceCache.delete(eventsRoot);
    return emptyAttributionEventSource();
  }
  const cached = attributionEventSourceCache.get(eventsRoot);
  if (cached && stableAttributionSignatures(cached.signatures)) {
    attributionEventSourceCache.delete(eventsRoot);
    attributionEventSourceCache.set(eventsRoot, cached);
    return cached.source;
  }
  let directory: ReturnType<typeof localProjectionSourceFileSystem.readStableDirents>;
  try {
    directory = localProjectionSourceFileSystem.readStableDirents(eventsRoot);
  } catch {
    return retryAttributionEventSource(rootInput, eventsRoot, attempt);
  }
  const previousByPath = new Map(cached?.source.inputs.map((input) => [input.relativePath, input]));
  const inputs: AttributionEventSourceInput[] = [];
  for (const entry of directory.entries
    .filter((candidate) => !candidate.isDirectory() && candidate.name.endsWith(".jsonl"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(eventsRoot, entry.name);
    const signature = localProjectionSourceFileSystem.statSignature(filePath);
    if (signature === null) return retryAttributionEventSource(rootInput, eventsRoot, attempt);
    const previous = previousByPath.get(entry.name);
    if (previous?.statSignature === signature) {
      inputs.push(previous);
      continue;
    }
    try {
      const stable = localProjectionSourceFileSystem.readStableText(filePath);
      inputs.push({
        relativePath: entry.name,
        body: stable.body,
        statSignature: stable.signature,
        contentSha256: sha256Text(stable.body)
      });
    } catch {
      return retryAttributionEventSource(rootInput, eventsRoot, attempt);
    }
  }
  const signatures = new Map<string, string>([
    [eventsRoot, directory.signature],
    ...inputs.map((input) => [path.join(eventsRoot, input.relativePath), input.statSignature] as const)
  ]);
  if (!stableAttributionSignatures(signatures)) return retryAttributionEventSource(rootInput, eventsRoot, attempt);
  const source = {
    inputs,
    hash: stablePayloadHash({
      schema: "attribution-event-source/v2",
      inputs: inputs.map(({ relativePath, contentSha256 }) => ({ relativePath, contentSha256 }))
    })
  };
  attributionEventSourceCache.delete(eventsRoot);
  attributionEventSourceCache.set(eventsRoot, { source, signatures });
  while (attributionEventSourceCache.size > attributionEventSourceCacheLimit) {
    const oldest = attributionEventSourceCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    attributionEventSourceCache.delete(oldest);
  }
  return source;
}

function stableAttributionSignatures(signatures: ReadonlyMap<string, string>): boolean {
  return attributionSignaturesMatch(signatures) && attributionSignaturesMatch(signatures);
}

function attributionSignaturesMatch(signatures: ReadonlyMap<string, string>): boolean {
  for (const [inputPath, expected] of signatures) {
    if (localProjectionSourceFileSystem.statSignature(inputPath) !== expected) return false;
  }
  return true;
}

function retryAttributionEventSource(
  rootInput: HarnessLayoutInput,
  eventsRoot: string,
  attempt: number
): AttributionEventSource {
  attributionEventSourceCache.delete(eventsRoot);
  if (attempt >= 2) throw new Error("attribution event source did not stabilize");
  return readAttributionEventSourceAttempt(rootInput, attempt + 1);
}

function emptyAttributionEventSource(): AttributionEventSource {
  return {
    inputs: [],
    hash: stablePayloadHash({ schema: "attribution-event-source/v2", inputs: [] })
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
