#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { integrationShardSummaries, validateIntegrationTestShards } from "./integration-test-shards.mjs";
import { testTierManifest } from "./test-tier-manifest.mjs";

export function checkIntegrationTestShards() {
  const validation = validateIntegrationTestShards(testTierManifest.integration);
  return {
    ok: validation.ok,
    errors: validation.errors,
    summaries: integrationShardSummaries(),
    fileCount: testTierManifest.integration.length
  };
}

function main() {
  const result = checkIntegrationTestShards();
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`integration shard check passed: manifestFiles=${result.fileCount} shards=${result.summaries.length}`);
  for (const summary of result.summaries) {
    console.log(`shard ${summary.id}: files=${summary.files} estimatedMs=${summary.estimatedMs.toFixed(1)}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
