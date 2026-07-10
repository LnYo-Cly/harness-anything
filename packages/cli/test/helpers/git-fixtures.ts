import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const testHarnessConfig = [
  "schema: harness-anything/v1",
  "layout:",
  "  authoredRoot: harness",
  "  localRoot: .harness",
  "settings:",
  "  identity:",
  "    personId: person_test",
  "    displayName: Harness Test",
  ""
].join("\n");

export function ensureTestHarnessIdentity(rootDir: string): void {
  const configPath = path.join(rootDir, "harness", "harness.yaml");
  if (existsSync(configPath)) {
    const config = readFileSync(configPath, "utf8");
    if (!/^  identity:\r?\n    personId: person_test$/mu.test(config)) {
      throw new Error(`Test harness config must declare settings.identity.personId at ${configPath}`);
    }
    return;
  }
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, testHarnessConfig, "utf8");
}

export function withTestHarnessRoot<T>(
  fn: (rootDir: string) => T,
  options: { readonly identity?: boolean; readonly prefix?: string } = {}
): T {
  const rootDir = mkdtempSync(path.join(tmpdir(), options.prefix ?? "ha-cli-"));
  try {
    if (options.identity !== false) ensureTestHarnessIdentity(rootDir);
    return fn(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

export function initializeNestedHarnessRepo(rootDir: string, options: { readonly writeOuterGitignore?: boolean } = {}): void {
  if (options.writeOuterGitignore) {
    writeFileSync(path.join(rootDir, ".gitignore"), "/harness/\n/.harness/\n", "utf8");
  }

  const harnessRoot = path.join(rootDir, "harness");
  mkdirSync(harnessRoot, { recursive: true });
  ensureTestHarnessIdentity(rootDir);
  if (existsSync(path.join(harnessRoot, ".git"))) return;

  execFileSync("git", ["-C", harnessRoot, "init", "-q"]);
  execFileSync("git", ["-C", harnessRoot, "config", "user.email", "harness@example.test"]);
  execFileSync("git", ["-C", harnessRoot, "config", "user.name", "Harness Test"]);
  writeFileSync(path.join(harnessRoot, ".gitignore"), "*.log\n", "utf8");
  execFileSync("git", ["-C", harnessRoot, "add", ".gitignore", "harness.yaml"]);
  execFileSync("git", ["-C", harnessRoot, "commit", "-m", "seed harness repo"]);
}
