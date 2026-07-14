import path from "node:path";
import type { HarnessLayoutInput } from "../layout/index.ts";
import { resolveHarnessLayout } from "../layout/index.ts";
import { sha256Text, stablePayloadHash } from "../integrity/stable-hash.ts";
import type { AttributionEvent } from "../schemas/attribution-event.ts";
import {
  decodeStrictAttributionEventV1,
  decodeUnionAttributionEvent,
  type UnionAttributionEvent
} from "../schemas/attribution-event-union.ts";
import { isSafeRelativeSourceCachePath } from "./persistent-source-cache-paths.ts";
import { localLayoutFileSystem, localProjectionSourceFileSystem } from "./local-layout-file-system.ts";

export interface AttributionEventSourceInput {
  readonly relativePath: string;
  readonly body: string;
  readonly statSignature: string;
  readonly contentSha256: string;
  readonly eventId?: string;
}

interface AttributionEventSourceCacheEntry {
  readonly source: AttributionEventSource;
  readonly signatures: ReadonlyMap<string, string | null>;
}

export interface AttributionEventSourcePersistentCache {
  readonly schema: "attribution-event-source-cache/v1";
  readonly layoutIdentity: string;
  readonly source: AttributionEventSource;
  readonly signatures: ReadonlyArray<{ readonly relativePath: string; readonly signature: string | null }>;
}

export type AttributionSourceCacheRestore = "fresh" | "stale" | "invalid";

const attributionEventSourceCache = new Map<string, AttributionEventSourceCacheEntry>();
const attributionEventSourceCacheLimit = 16;

export function captureAttributionEventSourcePersistentCache(
  rootInput: HarnessLayoutInput,
  reuseCacheWithoutValidation = false
): AttributionEventSourcePersistentCache | null {
  const layout = resolveHarnessLayout(rootInput);
  const cached = attributionEventSourceCache.get(layout.attributionEventsRoot);
  if (!cached || (!reuseCacheWithoutValidation && !stableAttributionSignatures(cached.signatures))) return null;
  return {
    schema: "attribution-event-source-cache/v1",
    layoutIdentity: layout.attributionEventsRoot,
    source: cached.source,
    signatures: [...cached.signatures].map(([inputPath, signature]) => ({
      relativePath: path.relative(layout.rootDir, inputPath).split(path.sep).join("/"),
      signature
    }))
  };
}

export function restoreAttributionEventSourcePersistentCache(
  rootInput: HarnessLayoutInput,
  persisted: AttributionEventSourcePersistentCache
): AttributionSourceCacheRestore {
  if (!validPersistentAttributionCache(persisted)) return "invalid";
  const layout = resolveHarnessLayout(rootInput);
  if (persisted.layoutIdentity !== layout.attributionEventsRoot) return "stale";
  const signatures = new Map(persisted.signatures.map(({ relativePath, signature }) => [
    path.resolve(layout.rootDir, relativePath),
    signature
  ]));
  rememberAttributionEventSourceCache(layout.attributionEventsRoot, {
    source: persisted.source,
    signatures
  });
  return stableAttributionSignatures(signatures) ? "fresh" : "stale";
}

export interface AttributionEventSource {
  readonly inputs: ReadonlyArray<AttributionEventSourceInput>;
  readonly hash: string;
}

export function readAttributionEvents(rootInput: HarnessLayoutInput): ReadonlyArray<AttributionEvent> {
  return readAttributionEventsFromSource(readAttributionEventSource(rootInput));
}

export function readUnionAttributionEvents(rootInput: HarnessLayoutInput): ReadonlyArray<UnionAttributionEvent> {
  return readUnionAttributionEventsFromSource(readAttributionEventSource(rootInput));
}

export function readAttributionEventSource(
  rootInput: HarnessLayoutInput,
  validation: "stable" | "verify" = "stable",
  reuseCacheWithoutValidation = false
): AttributionEventSource {
  return readAttributionEventSourceAttempt(rootInput, validation, reuseCacheWithoutValidation, 0);
}

function readAttributionEventSourceAttempt(
  rootInput: HarnessLayoutInput,
  validation: "stable" | "verify",
  reuseCacheWithoutValidation: boolean,
  attempt: number
): AttributionEventSource {
  const eventsRoot = resolveHarnessLayout(rootInput).attributionEventsRoot;
  if (!localLayoutFileSystem.exists(eventsRoot)) {
    const source = emptyAttributionEventSource();
    rememberAttributionEventSourceCache(eventsRoot, {
      source,
      signatures: new Map([[eventsRoot, null]])
    });
    return source;
  }
  const cached = attributionEventSourceCache.get(eventsRoot);
  if (cached && (reuseCacheWithoutValidation
    ? attributionRootSignatureMatches(eventsRoot, cached.signatures)
    : stableAttributionSignatures(cached.signatures, validation))) {
    attributionEventSourceCache.delete(eventsRoot);
    attributionEventSourceCache.set(eventsRoot, cached);
    return cached.source;
  }
  let directory: ReturnType<typeof localProjectionSourceFileSystem.readStableDirents>;
  try {
    directory = localProjectionSourceFileSystem.readStableDirents(eventsRoot);
  } catch {
    return retryAttributionEventSource(rootInput, eventsRoot, validation, reuseCacheWithoutValidation, attempt);
  }
  const previousByPath = new Map(cached?.source.inputs.map((input) => [input.relativePath, input]));
  const inputs: AttributionEventSourceInput[] = [];
  for (const entry of directory.entries
    .filter((candidate) => !candidate.isDirectory() && candidate.name.endsWith(".jsonl"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(eventsRoot, entry.name);
    const signature = localProjectionSourceFileSystem.statSignature(filePath);
    if (signature === null) return retryAttributionEventSource(rootInput, eventsRoot, validation, reuseCacheWithoutValidation, attempt);
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
        contentSha256: sha256Text(stable.body),
        eventId: decodeUnionAttributionEventBody(stable.body).eventId
      });
    } catch {
      return retryAttributionEventSource(rootInput, eventsRoot, validation, reuseCacheWithoutValidation, attempt);
    }
  }
  const signatures = new Map<string, string | null>([
    [eventsRoot, directory.signature],
    ...inputs.map((input) => [path.join(eventsRoot, input.relativePath), input.statSignature] as const)
  ]);
  if (!stableAttributionSignatures(signatures, validation)) {
    return retryAttributionEventSource(rootInput, eventsRoot, validation, reuseCacheWithoutValidation, attempt);
  }
  const source = {
    inputs,
    hash: stablePayloadHash({
      schema: "attribution-event-source/v2",
      inputs: inputs.map(({ relativePath, contentSha256 }) => ({ relativePath, contentSha256 }))
    })
  };
  rememberAttributionEventSourceCache(eventsRoot, { source, signatures });
  return source;
}

function attributionRootSignatureMatches(
  eventsRoot: string,
  signatures: ReadonlyMap<string, string | null>
): boolean {
  return localProjectionSourceFileSystem.statSignature(eventsRoot) === signatures.get(eventsRoot);
}

function rememberAttributionEventSourceCache(
  eventsRoot: string,
  entry: AttributionEventSourceCacheEntry
): void {
  attributionEventSourceCache.delete(eventsRoot);
  attributionEventSourceCache.set(eventsRoot, entry);
  while (attributionEventSourceCache.size > attributionEventSourceCacheLimit) {
    const oldest = attributionEventSourceCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    attributionEventSourceCache.delete(oldest);
  }
}

function stableAttributionSignatures(
  signatures: ReadonlyMap<string, string | null>,
  validation: "stable" | "verify" = "stable"
): boolean {
  return attributionSignaturesMatch(signatures) &&
    (validation === "verify" || attributionSignaturesMatch(signatures));
}

function attributionSignaturesMatch(signatures: ReadonlyMap<string, string | null>): boolean {
  for (const [inputPath, expected] of signatures) {
    if (localProjectionSourceFileSystem.statSignature(inputPath) !== expected) return false;
  }
  return true;
}

function retryAttributionEventSource(
  rootInput: HarnessLayoutInput,
  eventsRoot: string,
  validation: "stable" | "verify",
  reuseCacheWithoutValidation: boolean,
  attempt: number
): AttributionEventSource {
  attributionEventSourceCache.delete(eventsRoot);
  if (attempt >= 2) throw new Error("attribution event source did not stabilize");
  return readAttributionEventSourceAttempt(rootInput, validation, reuseCacheWithoutValidation, attempt + 1);
}

function emptyAttributionEventSource(): AttributionEventSource {
  return {
    inputs: [],
    hash: stablePayloadHash({ schema: "attribution-event-source/v2", inputs: [] })
  };
}

function validPersistentAttributionSource(source: AttributionEventSource): boolean {
  if (source.inputs.some((input) => !validPersistentAttributionInput(input))) return false;
  return source.hash === stablePayloadHash({
    schema: "attribution-event-source/v2",
    inputs: source.inputs.map(({ relativePath, contentSha256 }) => ({ relativePath, contentSha256 }))
  });
}

function validPersistentAttributionInput(input: AttributionEventSourceInput): boolean {
  if (sha256Text(input.body) === input.contentSha256) return true;
  // Persisted attribution bodies are reconstructed from the normalized event
  // rows. Their authored byte hash can differ only by JSON whitespace/order;
  // the protected attribution state hash authenticates the normalized event.
  if (!input.eventId) return false;
  try {
    return decodeUnionAttributionEventBody(input.body).eventId === input.eventId;
  } catch {
    return false;
  }
}

function validPersistentAttributionCache(persisted: AttributionEventSourcePersistentCache): boolean {
  if (persisted.schema !== "attribution-event-source-cache/v1" ||
      typeof persisted.layoutIdentity !== "string" ||
      !Array.isArray(persisted.source?.inputs) ||
      !Array.isArray(persisted.signatures)) return false;
  if (persisted.source.inputs.some((input) =>
    typeof input.relativePath !== "string" ||
    !isSafeRelativeSourceCachePath(input.relativePath) ||
    typeof input.body !== "string" ||
    typeof input.statSignature !== "string" ||
    typeof input.contentSha256 !== "string")) return false;
  if (persisted.signatures.some((entry) =>
    typeof entry.relativePath !== "string" ||
    !isSafeRelativeSourceCachePath(entry.relativePath) ||
    (entry.signature !== null && typeof entry.signature !== "string"))) return false;
  return validPersistentAttributionSource(persisted.source);
}


export function readAttributionEventsFromSource(source: AttributionEventSource): ReadonlyArray<AttributionEvent> {
  return source.inputs
    .map((input) => decodeAttributionEventBody(input.body))
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
}

export function readUnionAttributionEventsFromSource(source: AttributionEventSource): ReadonlyArray<UnionAttributionEvent> {
  return source.inputs
    .map((input) => decodeUnionAttributionEventBody(input.body))
    .sort((left, right) => {
      const leftRevision = left.schema === "attribution-event/v2" ? left.revision : Number.NEGATIVE_INFINITY;
      const rightRevision = right.schema === "attribution-event/v2" ? right.revision : Number.NEGATIVE_INFINITY;
      return leftRevision - rightRevision || left.eventId.localeCompare(right.eventId);
    });
}

export function attributionEventSourceHash(rootInput: HarnessLayoutInput): string {
  return readAttributionEventSource(rootInput).hash;
}

export function decodeAttributionEventBody(body: string): AttributionEvent {
  const lines = body.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("immutable attribution event shard must contain exactly one event");
  return decodeStrictAttributionEventV1(JSON.parse(lines[0]!));
}

export function decodeUnionAttributionEventBody(body: string): UnionAttributionEvent {
  const lines = body.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) throw new Error("immutable attribution event shard must contain exactly one event");
  return decodeUnionAttributionEvent(JSON.parse(lines[0]!));
}
