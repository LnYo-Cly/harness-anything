import { runProjectionReaderCommand } from "../../commands/core/projection-readers.ts";
import { parseProjectionReaderArgs } from "../parsers/projection-readers.ts";
import { defineCommandSpecs } from "./types.ts";

export const projectionReaderCommandSpecs = defineCommandSpecs([
  {
    kind: "session-show",
    usage: "session show <session-id> [--json]",
    options: [{ flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "Show projected session metadata and its body object.",
    examples: ["harness-anything session show ses_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["sessionId", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  },
  {
    kind: "session-trace",
    usage: "session trace <session-id> [--json]",
    options: [{ flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "Trace a session to execution ranges, tasks, and reviews.",
    examples: ["harness-anything session trace ses_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["sessionId", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  },
  {
    kind: "execution-show",
    usage: "execution show <execution-id> [--json]",
    options: [{ flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "Show one execution from the SQLite projection.",
    examples: ["harness-anything execution show exe_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["executionId", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  },
  {
    kind: "execution-list",
    usage: "execution list --task <task-id> [--json]",
    options: [{ flag: "--task", description: "Select the task id to query." }, { flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "List projected executions for a task.",
    examples: ["harness-anything execution list --task task_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["taskId", "rows", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  },
  {
    kind: "task-trace",
    usage: "task trace <task-id> [--json]",
    options: [{ flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "Trace task executions to sessions, reviews, ranges, and outputs.",
    examples: ["harness-anything task trace task_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["taskId", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  },
  {
    kind: "review-show",
    usage: "review show <review-id> [--json]",
    options: [{ flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "Show one review from the SQLite projection.",
    examples: ["harness-anything review show rev_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["reviewId", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  },
  {
    kind: "audit-provenance",
    usage: "audit provenance --task <task-id> [--json]",
    options: [{ flag: "--task", description: "Select the task id to query." }, { flag: "--json", description: "Emit command-receipt/v2 JSON." }],
    summary: "Report missing, partial, and dangling execution provenance coverage.",
    examples: ["harness-anything audit provenance --task task_01ABC --json"],
    parse: parseProjectionReaderArgs,
    run: runProjectionReaderCommand,
    receiptContract: { data: ["taskId", "report"], paths: [] },
    eventPolicy: { conflictMarkerPreflight: false, runtimeEvent: "none" }
  }
]);
