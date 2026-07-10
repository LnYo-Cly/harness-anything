import { existsSync, readFileSync } from "node:fs";
import { resolveHarnessLayout, type HarnessLayoutInput } from "../../../kernel/src/index.ts";
import { profileIssue, type ProfileValidationIssue } from "./check-profile-types.ts";

export function validateJournalActorAttribution(rootInput: HarnessLayoutInput): ReadonlyArray<ProfileValidationIssue> {
  const journalPath = resolveHarnessLayout(rootInput).journalPath;
  if (!existsSync(journalPath)) return [];

  return readFileSync(journalPath, "utf8")
    .split("\n")
    .flatMap((line) => inheritedHumanActorIssue(line));
}

function inheritedHumanActorIssue(line: string): ReadonlyArray<ProfileValidationIssue> {
  if (!line.trim()) return [];
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return [];
    record = parsed;
  } catch {
    return [];
  }

  const actor = isRecord(record.actor) ? record.actor : undefined;
  const source = actor?.source ?? record.source;
  if (actor?.kind !== "human" || source !== "env") return [];

  const actorId = stringValue(actor.id, "unknown");
  const opId = stringValue(record.opId, "unknown-op");
  const entityId = stringValue(record.entityId, "unknown-entity");
  return [profileIssue(
    "actor-attribution-checker",
    "human_actor_from_inherited_env",
    "hard-fail",
    `${entityId} journal operation ${opId} records human:${actorId} from inherited env attribution.`,
    `Preserve the historical record as audit evidence; future human invocations must use --actor human:${actorId}.`
  )];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
