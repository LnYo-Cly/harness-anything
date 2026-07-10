import type { CommandJsonInput } from "../json-input.ts";

export type JsonPayload = Readonly<Record<string, unknown>>;

export function jsonPayloadFor(input: CommandJsonInput | undefined, commandKind: string): JsonPayload | undefined {
  return input?.commandKind === commandKind ? input.payload : undefined;
}

export function jsonString(payload: JsonPayload | undefined, ...keys: ReadonlyArray<string>): string | undefined {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function jsonNumber(payload: JsonPayload | undefined, key: string): number | undefined {
  const value = payload?.[key];
  return typeof value === "number" ? value : undefined;
}

export function jsonBoolean(payload: JsonPayload | undefined, key: string): boolean {
  return payload?.[key] === true;
}

export function jsonValues(payload: JsonPayload | undefined, key: string): ReadonlyArray<unknown> {
  const value = payload?.[key];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function jsonStringList(payload: JsonPayload | undefined, key: string): ReadonlyArray<string> {
  return jsonValues(payload, key).flatMap((value) => typeof value === "string" ? [value] : []);
}

export function payloadFallback(value: string | undefined, payload: JsonPayload | undefined, ...keys: ReadonlyArray<string>): string | undefined {
  return value ?? jsonString(payload, ...keys);
}

export function booleanPayloadFallback(value: boolean, payload: JsonPayload | undefined, key: string): boolean {
  return value || jsonBoolean(payload, key);
}

export function numberPayloadFallback(value: number | null | undefined, payload: JsonPayload | undefined, key: string): number | null | undefined {
  return value === undefined ? jsonNumber(payload, key) : value;
}
