#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { entryValues, loadGateAllowlist } from "./gate-allowlists/load-gate-allowlist.mjs";

const gateId = "check-error-next-steps";
const cliRegistryPath = "packages/cli/src/cli/error-codes.ts";
const callerFacingRoots = [
  "packages/application/src",
  "packages/daemon/src"
];
const cliSourceRoot = "packages/cli/src";

export const maxErrorHintLength = 480;

const rejectionSignalPattern = /\b(?:blocked|cannot|conflict|disabled|failed|forbidden|invalid|mismatch|missing|must|not (?:available|configured|enabled|found|implemented|mapped|ready|registered)|refused|require|required|requires|rejected|retired|unavailable|unknown)\b/iu;
const actionVerbPattern = /\b(?:add|call|check|choose|configure|connect|create|fix|inspect|keep|open|pass|provide|remove|replace|rerun|re-run|resolve|retry|run|set|start|submit|use|verify|wait|write)\b/iu;
const concreteTargetPattern = /(?:\b(?:ha|harness-anything|git|node|npm|npx)\s+[a-z]|--[a-z][a-z0-9-]*|\b[A-Z][A-Z0-9_]{2,}\b|(?:^|[\s'"`])(?:\.?\.?\/|~\/)[^\s'"`]+|\b[\w.-]+\.(?:json|md|toml|ya?ml)\b|<[^>\n]+>)/u;
const commandSignaturePattern = /\b(?:ha|harness-anything|git|node|npm|npx)\s+[a-z][^;\n]*/giu;

export function assessErrorHint(hint) {
  const normalized = hint.trim();
  const overload = [];
  const nextStep = [];

  if (normalized.length > maxErrorHintLength) {
    overload.push(`hint is ${normalized.length} characters; maximum is ${maxErrorHintLength}`);
  }
  const signatures = normalized.match(commandSignaturePattern) ?? [];
  const catalogDump = /\b(?:commands|supported commands)\s*:/iu.test(normalized)
    && (signatures.length > 3 || (normalized.match(/;/gu) ?? []).length > 3);
  if (catalogDump || signatures.length > 3) {
    overload.push(`hint contains ${signatures.length} command signatures; maximum is 3`);
  }

  if (!rejectionSignalPattern.test(normalized)) {
    nextStep.push("does not identify the rejected or missing requirement");
  }
  const hasExecutableAction = concreteTargetPattern.test(normalized)
    && (actionVerbPattern.test(normalized) || commandSignaturePattern.test(normalized));
  if (!hasExecutableAction) {
    nextStep.push("does not provide a concrete command, env var, option, or file action");
  }
  return { overload, nextStep };
}

export function inspectErrorNextSteps(rootDir = process.cwd(), allowedDebtKeys = []) {
  const inventory = collectCallerRejections(rootDir);
  const allowed = new Set(allowedDebtKeys);
  const warnings = [];
  const violations = [];
  const failingKeys = new Set();

  for (const entry of inventory) {
    const nextStepIssues = new Set();
    for (const occurrence of entry.occurrences) {
      const assessment = assessErrorHint(occurrence.hint);
      for (const issue of assessment.overload) {
        violations.push(`${entry.key} at ${occurrence.location}: ${issue}`);
      }
      for (const issue of assessment.nextStep) nextStepIssues.add(issue);
    }
    if (nextStepIssues.size === 0) continue;
    failingKeys.add(entry.key);
    const detail = `${entry.key}: ${[...nextStepIssues].join("; ")}`;
    if (allowed.has(entry.key)) {
      warnings.push(detail);
    } else {
      violations.push(detail);
    }
  }

  for (const key of allowed) {
    if (!inventory.some((entry) => entry.key === key)) {
      violations.push(`allowlist entry ${key} is stale because the rejection code is no longer enumerated`);
    } else if (!failingKeys.has(key)) {
      violations.push(`allowlist entry ${key} is stale because every enumerated hint now teaches a next step`);
    }
  }

  violations.push(...findCliHintOverloadSources(rootDir));
  return { inventory, warnings, violations };
}

export function collectCallerRejections(rootDir = process.cwd()) {
  const byKey = new Map();
  collectCliRegistry(rootDir, byKey);
  for (const sourceRoot of callerFacingRoots) {
    const absoluteRoot = path.join(rootDir, sourceRoot);
    if (!existsSync(absoluteRoot)) continue;
    const surface = sourceRoot.split("/")[1];
    for (const filePath of walkTypeScriptFiles(absoluteRoot)) {
      collectSourceRejections(rootDir, filePath, surface, byKey);
    }
  }
  return [...byKey.entries()]
    .map(([key, occurrences]) => ({ key, occurrences }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function collectCliRegistry(rootDir, byKey) {
  const filePath = path.join(rootDir, cliRegistryPath);
  const sourceFile = parseSource(filePath);
  const codes = objectVariable(sourceFile, "CliErrorCode");
  const registry = objectVariable(sourceFile, "cliErrorCodeRegistry");
  if (!codes || !registry) throw new Error(`${cliRegistryPath} must declare CliErrorCode and cliErrorCodeRegistry object literals`);

  const valuesByName = new Map();
  for (const property of codes.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const value = staticStrings(property.initializer)[0];
    const name = propertyNameText(property.name);
    if (name && value !== undefined) valuesByName.set(name, value);
  }

  for (const property of registry.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const memberName = computedCliErrorMember(property.name);
    const code = memberName ? valuesByName.get(memberName) : undefined;
    const hintProperty = objectProperty(property.initializer, "defaultHint");
    const hint = hintProperty && ts.isPropertyAssignment(hintProperty)
      ? staticStrings(hintProperty.initializer)[0]
      : undefined;
    if (code && hint !== undefined) addOccurrence(byKey, `cli:${code}`, hint, `${cliRegistryPath}:${sourceFile.getLineAndCharacterOfPosition(property.getStart()).line + 1}`);
  }

  for (const code of valuesByName.values()) {
    if (!byKey.has(`cli:${code}`)) addOccurrence(byKey, `cli:${code}`, "", cliRegistryPath);
  }
}

function collectSourceRejections(rootDir, filePath, surface, byKey) {
  const sourceFile = parseSource(filePath);
  const relative = path.relative(rootDir, filePath).split(path.sep).join("/");
  const location = (node) => `${relative}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const positions = node.expression.text === "failureReceipt"
        ? { code: 1, hint: 2 }
        : node.expression.text === "identityFailure"
          ? { code: 1, hint: 2 }
          : undefined;
      if (positions) {
        addStaticOccurrences(byKey, surface, node.arguments[positions.code], node.arguments[positions.hint], location(node));
      }
    }
    if (ts.isObjectLiteralExpression(node) && objectBoolean(node, "ok") === false) {
      const nestedError = objectProperty(node, "error");
      const failure = nestedError && ts.isPropertyAssignment(nestedError) && ts.isObjectLiteralExpression(nestedError.initializer)
        ? nestedError.initializer
        : node;
      const code = propertyInitializer(failure, "code");
      const hint = propertyInitializer(failure, "hint") ?? propertyInitializer(failure, "message");
      addStaticOccurrences(byKey, surface, code, hint, location(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function addStaticOccurrences(byKey, surface, codeNode, hintNode, location) {
  const codes = staticStrings(codeNode);
  if (codes.length === 0) return;
  const hints = staticStrings(hintNode);
  for (const code of codes) {
    if (!/^[A-Za-z0-9_:/{}<>-]+$/u.test(code)) continue;
    if (hints.length === 0) {
      addOccurrence(byKey, `${surface}:${code}`, "", location);
      continue;
    }
    for (const hint of hints) addOccurrence(byKey, `${surface}:${code}`, hint, location);
  }
}

function findCliHintOverloadSources(rootDir) {
  const violations = [];
  const absoluteRoot = path.join(rootDir, cliSourceRoot);
  if (!existsSync(absoluteRoot)) return violations;
  for (const filePath of walkTypeScriptFiles(absoluteRoot)) {
    const sourceFile = parseSource(filePath);
    const relative = path.relative(rootDir, filePath).split(path.sep).join("/");
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "cliError") {
        const hint = node.arguments[1];
        if (hint) {
          const expression = hint.getText(sourceFile);
          const line = sourceFile.getLineAndCharacterOfPosition(hint.getStart()).line + 1;
          if (/\b(?:commandRegistry|commandDescriptors)\b/u.test(expression) && /\.map\s*\(/u.test(expression)) {
            violations.push(`${relative}:${line} builds an error hint by dumping the command registry`);
          }
          for (const text of staticStrings(hint)) {
            for (const issue of assessErrorHint(text).overload) violations.push(`${relative}:${line}: ${issue}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

function staticStrings(node) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [node.head.text + node.templateSpans.map((span) => `<context>${span.literal.text}`).join("")];
  }
  if (ts.isConditionalExpression(node)) return [...staticStrings(node.whenTrue), ...staticStrings(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return staticStrings(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStrings(node.left);
    const right = staticStrings(node.right);
    if (left.length > 0 && right.length > 0) return left.flatMap((a) => right.map((b) => a + b));
  }
  return [];
}

function objectVariable(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
      const initializer = ts.isAsExpression(declaration.initializer) || ts.isSatisfiesExpression(declaration.initializer)
        ? declaration.initializer.expression
        : declaration.initializer;
      if (ts.isObjectLiteralExpression(initializer)) return initializer;
    }
  }
  return undefined;
}

function computedCliErrorMember(name) {
  if (!ts.isComputedPropertyName(name) || !ts.isPropertyAccessExpression(name.expression)) return undefined;
  return ts.isIdentifier(name.expression.expression) && name.expression.expression.text === "CliErrorCode"
    ? name.expression.name.text
    : undefined;
}

function objectProperty(object, name) {
  return object.properties.find((property) => ts.isPropertyAssignment(property) && propertyNameText(property.name) === name);
}

function propertyInitializer(object, name) {
  const property = objectProperty(object, name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function objectBoolean(object, name) {
  const initializer = propertyInitializer(object, name);
  if (initializer?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (initializer?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

function addOccurrence(byKey, key, hint, location) {
  const occurrences = byKey.get(key) ?? [];
  if (!occurrences.some((entry) => entry.hint === hint && entry.location === location)) occurrences.push({ hint, location });
  byKey.set(key, occurrences);
}

function parseSource(filePath) {
  return ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walkTypeScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(entryPath);
  }
  return files;
}

function main() {
  const entries = loadGateAllowlist(gateId, { requiredSections: ["knownDebt"] });
  const result = inspectErrorNextSteps(process.cwd(), entryValues(entries.knownDebt));
  console.log(`Error next-step inventory: ${result.inventory.length} caller-facing rejection code(s).`);
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (result.violations.length === 0) return;
  console.error(`Error next-step gate failed with ${result.violations.length} finding(s):`);
  for (const violation of result.violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
