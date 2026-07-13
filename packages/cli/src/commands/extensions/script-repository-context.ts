import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

const gitCommitPattern = /^[0-9a-f]{40,64}$/u;
const gitMaxBuffer = 1024 * 1024;

export interface TrustedScriptRepositoryContext {
  readonly root: {
    readonly realpath: string | null;
    readonly verification: "verified" | "unverified";
  };
  readonly commit: {
    readonly sha: string | null;
    readonly verification: "verified" | "unverified";
  };
}

export function trustedScriptRepositoryContext(rootDir: string): TrustedScriptRepositoryContext {
  const root = trustedRepositoryRoot(rootDir);
  if (root.realpath === null) return { root, commit: unverifiedCommit() };
  try {
    const sha = readBoundRepositoryCommit(root.realpath);
    const verified = sha !== null && gitCommitPattern.test(sha);
    return {
      root,
      commit: {
        sha: verified ? sha : null,
        verification: verified ? "verified" : "unverified"
      }
    };
  } catch {
    return { root, commit: unverifiedCommit() };
  }
}

function readBoundRepositoryCommit(requestedRoot: string): string | null {
  const topLevel = readOnlyGit(requestedRoot, "rev-parse", "--show-toplevel");
  if (realpathSync.native(topLevel) !== requestedRoot) return null;
  return readOnlyGit(requestedRoot, "rev-parse", "--verify", "HEAD^{commit}");
}

function readOnlyGit(rootDir: string, ...args: ReadonlyArray<string>): string {
  return trimSingleLineEnding(execFileSync("git", ["-C", rootDir, ...args], {
    encoding: "utf8",
    env: readOnlyGitEnvironment(),
    maxBuffer: gitMaxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }));
}

function readOnlyGitEnvironment(): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))
  );
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

function trimSingleLineEnding(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function unverifiedCommit(): TrustedScriptRepositoryContext["commit"] {
  return { sha: null, verification: "unverified" };
}

function trustedRepositoryRoot(rootDir: string): TrustedScriptRepositoryContext["root"] {
  try {
    return { realpath: realpathSync.native(rootDir), verification: "verified" };
  } catch {
    return { realpath: null, verification: "unverified" };
  }
}
