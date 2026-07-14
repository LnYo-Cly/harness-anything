import { cliError, CliErrorCode } from "../error-codes.ts";
import { readOption } from "../parse-options.ts";
import type { CliResult, ParsedCommand } from "../types.ts";

type ParseResult = { readonly ok: true; readonly value: ParsedCommand } | { readonly ok: false; readonly error: CliResult["error"] };

export function parseDecisionPinCommand(
  op: string | undefined,
  args: ReadonlyArray<string>,
  rootDir: string,
  json: boolean
): ParseResult | null {
  if (op === "verify") {
    const all = args.includes("--all");
    const selector = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
    if (all === Boolean(selector)) {
      return { ok: false, error: cliError(CliErrorCode.UnknownCommand, "Use decision verify <decision-id> or decision verify --all.") };
    }
    return parsedDecisionPin(rootDir, json, {
      kind: "decision-verify",
      ...(selector ? { decisionIds: [selector] } : {})
    });
  }
  if (op !== "repin" || !args[2]) return null;
  const migrationEvidence = readOption(args, "--migration-evidence");
  if (!migrationEvidence?.startsWith("task/")) {
    return { ok: false, error: cliError(CliErrorCode.UnknownCommand, "Use decision repin <decision-id> --migration-evidence task/<task-id>/<audit-marker>.") };
  }
  return parsedDecisionPin(rootDir, json, {
    kind: "decision-repin",
    decisionId: args[2],
    migrationEvidence
  });
}

function parsedDecisionPin(rootDir: string, json: boolean, action: ParsedCommand["action"]): ParseResult {
  return { ok: true, value: { rootDir, json, action } };
}
