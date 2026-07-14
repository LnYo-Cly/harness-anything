import path from "node:path";
import { parseFactFlowRecords } from "../domain/index.ts";
import { stablePayloadHash } from "../integrity/stable-hash.ts";
import { readBlockScalar } from "../markdown/flow-frontmatter.ts";
import { readFrontmatter, readScalar } from "../markdown/frontmatter.ts";
import { parseRelationFlowRecords } from "./relation-flow-frontmatter.ts";

export function relationGraphSourceSemanticHash(sourcePathValue: string, body: string | undefined): string {
  if (body === undefined) return stablePayloadHash({ schema: "relation-source-semantics/v1", absent: true });
  const basename = path.basename(sourcePathValue);
  if (basename === "INDEX.md") {
    const frontmatter = readFrontmatter(body) ?? "";
    return stablePayloadHash({
      schema: "relation-source-semantics/v1",
      kind: "task-index",
      taskId: readScalar(frontmatter, "task_id"),
      status: readScalar(frontmatter, "  status"),
      relations: parseRelationFlowRecords(frontmatter)
    });
  }
  if (basename === "facts.md") {
    return stablePayloadHash({
      schema: "relation-source-semantics/v1",
      kind: "facts",
      facts: parseFactFlowRecords(body),
      relations: parseRelationFlowRecords(body)
    });
  }
  if (basename === "decision.md") {
    const frontmatter = readFrontmatter(body) ?? "";
    return stablePayloadHash({
      schema: "relation-source-semantics/v1",
      kind: "decision",
      schemaValue: readScalar(frontmatter, "schema"),
      decisionId: readScalar(frontmatter, "decision_id"),
      watermark: readScalar(frontmatter, "_coordinatorWatermark"),
      claims: readSemanticFlowObjectBlock(frontmatter, "claims"),
      chosen: readSemanticFlowObjectBlock(frontmatter, "chosen"),
      rejected: readSemanticFlowObjectBlock(frontmatter, "rejected"),
      appliesTo: {
        modules: readBlockScalar(frontmatter, "applies_to", "modules"),
        productLines: readBlockScalar(frontmatter, "applies_to", "productLines")
      },
      relations: parseRelationFlowRecords(frontmatter)
    });
  }
  return stablePayloadHash({ schema: "relation-source-semantics/v1", kind: "unrelated" });
}

export function relationGraphFactProjectionSemanticHash(sourcePathValue: string, body: string | undefined): string {
  if (body === undefined) return stablePayloadHash({ schema: "relation-fact-source-semantics/v1", absent: true });
  const basename = path.basename(sourcePathValue);
  if (basename === "INDEX.md") {
    const frontmatter = readFrontmatter(body) ?? "";
    return stablePayloadHash({
      schema: "relation-fact-source-semantics/v1",
      kind: "task-index",
      taskId: readScalar(frontmatter, "task_id")
    });
  }
  if (basename === "facts.md") {
    return stablePayloadHash({
      schema: "relation-fact-source-semantics/v1",
      kind: "facts",
      facts: parseFactFlowRecords(body)
    });
  }
  return stablePayloadHash({ schema: "relation-fact-source-semantics/v1", kind: "unrelated" });
}

function readSemanticFlowObjectBlock(frontmatter: string, key: string): string {
  const lines = frontmatter.split(/\r?\n/u);
  const output: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line === `${key}:`) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\s*-\s*\{/u.test(line)) {
      output.push(line);
      continue;
    }
    if (/^\S/u.test(line)) break;
  }
  return output.join("\n");
}
