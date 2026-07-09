#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export const integrationShardResults = Object.freeze(["success", "failure", "cancelled", "skipped"]);

export function evaluateIntegrationShardResult(result) {
  switch (result) {
    case "success":
      return { ok: true, message: "integration shards succeeded" };
    case "failure":
      return { ok: false, message: "integration shard matrix failed" };
    case "cancelled":
      return { ok: false, message: "integration shard matrix was cancelled" };
    case "skipped":
      return { ok: false, message: "integration shard matrix was skipped" };
    default:
      return { ok: false, message: `unknown integration shard result: ${String(result)}` };
  }
}

function main(argv) {
  const [result] = argv;
  const evaluation = evaluateIntegrationShardResult(result);
  const normalized = result ?? "<missing>";
  console.log(`integration-shard result=${normalized}`);
  console.log(evaluation.message);
  if (!evaluation.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
