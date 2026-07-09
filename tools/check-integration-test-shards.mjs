#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { integrationShardCount, integrationShardSummaries, validateIntegrationTestShards } from "./integration-test-shards.mjs";
import { testTierManifest } from "./test-tier-manifest.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const workflowPath = path.join(repoRoot, ".github/workflows/rewrite-ci.yml");
const gateManifestPath = path.join(repoRoot, "tools/gate-manifest.json");

export function checkIntegrationTestShards({
  workflowText = readFileSync(workflowPath, "utf8"),
  gateManifestText = readFileSync(gateManifestPath, "utf8")
} = {}) {
  const validation = validateIntegrationTestShards(testTierManifest.integration);
  const workflowValidation = validateIntegrationShardWorkflowMatrix(workflowText, integrationShardCount);
  const manifestValidation = validateIntegrationShardRequiredContexts(gateManifestText, integrationShardCount);
  const errors = [...validation.errors, ...workflowValidation.errors, ...manifestValidation.errors];
  return {
    ok: errors.length === 0,
    errors,
    summaries: integrationShardSummaries(),
    fileCount: testTierManifest.integration.length,
    workflowShards: workflowValidation.shards,
    requiredContexts: manifestValidation.contexts
  };
}

export function validateIntegrationShardWorkflowMatrix(workflowText, shardCount = integrationShardCount) {
  const shards = parseIntegrationShardMatrix(workflowText);
  const expected = Array.from({ length: shardCount }, (_, index) => index + 1);
  const errors = [];

  if (shards.length === 0) {
    errors.push("integration-shard workflow matrix shard list is missing");
    return { shards, errors };
  }
  if (shards.length !== expected.length || shards.some((value, index) => value !== expected[index])) {
    errors.push(`integration-shard workflow matrix mismatch: expected [${expected.join(", ")}], got [${shards.join(", ")}]`);
  }

  return { shards, errors };
}

export function validateIntegrationShardRequiredContexts(gateManifestText, shardCount = integrationShardCount) {
  const expected = Array.from({ length: shardCount }, (_, index) => `integration-shard (${index + 1})`);
  const errors = [];
  let manifest;

  try {
    manifest = JSON.parse(gateManifestText);
  } catch (error) {
    return { contexts: [], errors: [`gate-manifest.json parse failed: ${error.message}`] };
  }

  const gate = Array.isArray(manifest.gates) ? manifest.gates.find((entry) => entry.id === "test-integration") : undefined;
  const githubContexts = gate?.githubContext?.requiredContexts;
  const branchProtectionContexts = gate?.executionSurfaces?.branchProtection?.contexts;

  if (!Array.isArray(githubContexts)) {
    errors.push("test-integration githubContext.requiredContexts is missing");
  } else if (!sameOrderedList(githubContexts, expected)) {
    errors.push(`test-integration githubContext.requiredContexts mismatch: expected [${expected.join(", ")}], got [${githubContexts.join(", ")}]`);
  }

  if (!Array.isArray(branchProtectionContexts)) {
    errors.push("test-integration executionSurfaces.branchProtection.contexts is missing");
  } else if (!sameOrderedList(branchProtectionContexts, expected)) {
    errors.push(`test-integration executionSurfaces.branchProtection.contexts mismatch: expected [${expected.join(", ")}], got [${branchProtectionContexts.join(", ")}]`);
  }

  return { contexts: Array.isArray(githubContexts) ? githubContexts : [], errors };
}

function sameOrderedList(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function parseIntegrationShardMatrix(workflowText) {
  const lines = workflowText.split(/\r?\n/u);
  let inIntegrationShardJob = false;
  let jobIndent = 0;

  for (const line of lines) {
    const jobMatch = /^(\s*)integration-shard:\s*$/u.exec(line);
    if (jobMatch) {
      inIntegrationShardJob = true;
      jobIndent = jobMatch[1].length;
      continue;
    }
    if (!inIntegrationShardJob) {
      continue;
    }
    const nextJobMatch = /^(\s*)[A-Za-z0-9_-]+:\s*$/u.exec(line);
    if (nextJobMatch && nextJobMatch[1].length <= jobIndent) {
      return [];
    }
    const shardMatch = /^\s*shard:\s*\[(.+?)\]\s*$/u.exec(line);
    if (shardMatch) {
      return shardMatch[1]
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((value) => Number.isInteger(value));
    }
  }

  return [];
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

  console.log(`integration shard check passed: manifestFiles=${result.fileCount} shards=${result.summaries.length} workflowShards=[${result.workflowShards.join(", ")}] requiredContexts=[${result.requiredContexts.join(", ")}]`);
  for (const summary of result.summaries) {
    console.log(`shard ${summary.id}: files=${summary.files} estimatedMs=${summary.estimatedMs.toFixed(1)}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
