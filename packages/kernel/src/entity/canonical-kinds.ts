export const canonicalEntityKinds = [
  "task",
  "decision",
  "fact",
  "relation",
  "module",
  "session",
  "execution",
  "review"
] as const;

export type CanonicalEntityKind = (typeof canonicalEntityKinds)[number];

const canonicalEntityKindSet = new Set<string>(canonicalEntityKinds);

export function isCanonicalEntityKind(value: unknown): value is CanonicalEntityKind {
  return typeof value === "string" && canonicalEntityKindSet.has(value);
}
