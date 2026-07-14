export interface MarkdownHeadingSection {
  readonly anchor: string;
  readonly body: string;
}

export function extractMarkdownSection(markdown: string, anchor: string): string {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === anchor);
  if (start < 0) return "";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/u.test(line.trim())) break;
    if (line.trim().length > 0) body.push(line.trim());
  }
  return body.join("\n").trim();
}

export function markdownHeadingSections(markdown: string): ReadonlyArray<MarkdownHeadingSection> {
  const anchors = markdown.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^##\s+\S/u.test(line));
  return [...new Set(anchors)].map((anchor) => ({
    anchor,
    body: extractMarkdownSection(markdown, anchor)
  }));
}
