export const retiredAttributionDocumentKinds = ["task-index", "decision"] as const;

export type RetiredAttributionDocumentKind = typeof retiredAttributionDocumentKinds[number];

export interface RetiredAttributionFieldCleanupResult {
  readonly body: string;
  readonly removedKeys: ReadonlyArray<string>;
  readonly removedByteCount: number;
  readonly authoredBodyBefore: string;
  readonly authoredBodyAfter: string;
  readonly contentPinArbitersBefore: number;
  readonly contentPinArbitersAfter: number;
}

interface LineSpan {
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

const expectedKeys = {
  "task-index": ["createdBy"],
  decision: ["proposedBy", "arbiter"]
} as const satisfies Record<RetiredAttributionDocumentKind, ReadonlyArray<string>>;

export function hasRetiredAttributionFields(body: string, documentKind: RetiredAttributionDocumentKind): boolean {
  const frontmatter = frontmatterSpans(body);
  const keys = new Set<string>(expectedKeys[documentKind]);
  return frontmatter.lines.some((line) => {
    const key = topLevelKey(line.content);
    return key !== null && keys.has(key);
  });
}

export function countContentPinArbitersInDocument(body: string): number {
  return countContentPinArbiters(frontmatterSpans(body).lines);
}

export function cleanupRetiredAttributionFields(
  body: string,
  documentKind: RetiredAttributionDocumentKind
): RetiredAttributionFieldCleanupResult {
  const frontmatter = frontmatterSpans(body);
  const required = expectedKeys[documentKind];
  const requiredSet = new Set<string>(required);
  const removals: Array<{ readonly start: number; readonly end: number; readonly key: string }> = [];

  for (let index = 0; index < frontmatter.lines.length; index += 1) {
    const line = frontmatter.lines[index]!;
    const key = topLevelKey(line.content);
    if (key === null || !requiredSet.has(key)) continue;
    const value = line.content.slice(line.content.indexOf(":") + 1);
    let end = line.end;
    if (value.trim().length === 0) {
      let nested = index + 1;
      while (nested < frontmatter.lines.length && /^[\t ]+\S/u.test(frontmatter.lines[nested]!.content)) {
        end = frontmatter.lines[nested]!.end;
        nested += 1;
      }
    }
    removals.push({ start: line.start, end, key });
  }

  const removedKeys = removals.map((entry) => entry.key);
  for (const key of required) {
    const count = removedKeys.filter((candidate) => candidate === key).length;
    if (count !== 1) {
      throw new Error(`${documentKind} cleanup requires exactly one top-level ${key} key; found ${count}`);
    }
  }

  let cleaned = body;
  for (const removal of [...removals].sort((left, right) => right.start - left.start)) {
    cleaned = `${cleaned.slice(0, removal.start)}${cleaned.slice(removal.end)}`;
  }
  const cleanedFrontmatter = frontmatterSpans(cleaned);
  const contentPinArbitersBefore = countContentPinArbiters(frontmatter.lines);
  const contentPinArbitersAfter = countContentPinArbiters(cleanedFrontmatter.lines);
  return {
    body: cleaned,
    removedKeys,
    removedByteCount: Buffer.byteLength(body, "utf8") - Buffer.byteLength(cleaned, "utf8"),
    authoredBodyBefore: body.slice(frontmatter.bodyStart),
    authoredBodyAfter: cleaned.slice(cleanedFrontmatter.bodyStart),
    contentPinArbitersBefore,
    contentPinArbitersAfter
  };
}

function frontmatterSpans(body: string): { readonly lines: ReadonlyArray<LineSpan>; readonly bodyStart: number } {
  const lines = lineSpans(body);
  if (lines.length < 2 || lines[0]!.content !== "---") {
    throw new Error("retired attribution cleanup requires leading YAML frontmatter");
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.content === "---");
  if (closingIndex < 0) throw new Error("retired attribution cleanup requires closing YAML frontmatter");
  return {
    lines: lines.slice(1, closingIndex),
    bodyStart: lines[closingIndex]!.end
  };
}

function lineSpans(body: string): ReadonlyArray<LineSpan> {
  const lines: LineSpan[] = [];
  const pattern = /.*(?:\r\n|\n|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (match[0].length === 0) break;
    const start = match.index;
    const end = start + match[0].length;
    lines.push({ start, end, content: match[0].replace(/\r?\n$/u, "") });
  }
  return lines;
}

function topLevelKey(line: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9_]*):/u.exec(line);
  return match?.[1] ?? null;
}

function countContentPinArbiters(lines: ReadonlyArray<LineSpan>): number {
  const start = lines.findIndex((line) => line.content === "contentPins:");
  if (start < 0) return 0;
  let count = 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const content = lines[index]!.content;
    if (topLevelKey(content) !== null) break;
    count += content.match(/\barbiter\s*:/gu)?.length ?? 0;
  }
  return count;
}
