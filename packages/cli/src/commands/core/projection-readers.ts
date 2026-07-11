import { Effect } from "effect";
import {
  auditTaskProvenance,
  queryExecutionProjection,
  queryExecutionsByTask,
  queryReviewProjection,
  querySessionExecutionTrace,
  querySessionProjection,
  queryTaskExecutionTrace,
  readContentAddressedTextBlob
} from "../../../../kernel/src/index.ts";
import { cliError, CliErrorCode } from "../../cli/error-codes.ts";
import type { CommandRunner } from "../../cli/runner-registry.ts";
import type { CliResult, ParsedCommand } from "../../cli/types.ts";

type ProjectionReadAction = Extract<ParsedCommand["action"], {
  readonly kind: "session-show" | "session-trace" | "execution-show" | "execution-list" | "task-trace" | "review-show" | "audit-provenance";
}>;

export const runProjectionReaderCommand: CommandRunner = (context, command) => Effect.sync(() => {
  const action = command.action as ProjectionReadAction;
  const options = { rootDir: context.rootDir, layoutOverrides: context.layoutOverrides };
  if (action.kind === "session-show") {
    const session = querySessionProjection({ ...options, sessionId: action.sessionId });
    if (!session) return notFound(action.kind, "session", action.sessionId, { sessionId: action.sessionId });
    let body: string;
    try {
      body = readContentAddressedTextBlob(context.layoutInput, session.bodyRef as {
        readonly ref: string; readonly sha256: string; readonly size: number; readonly mediaType: string;
      });
    } catch (error) {
      return {
        ok: false,
        command: action.kind,
        sessionId: action.sessionId,
        error: cliError(CliErrorCode.RefNotFound, error instanceof Error ? error.message : String(error))
      } satisfies CliResult;
    }
    return success(action.kind, { sessionId: action.sessionId, report: { schema: "session-show-report/v1", session, body } });
  }
  if (action.kind === "session-trace") {
    const trace = querySessionExecutionTrace({ ...options, sessionId: action.sessionId });
    if (!trace.session) return notFound(action.kind, "session", action.sessionId, { sessionId: action.sessionId });
    return success(action.kind, { sessionId: action.sessionId, report: { schema: "session-trace-report/v1", trace } });
  }
  if (action.kind === "execution-show") {
    const execution = queryExecutionProjection({ ...options, executionId: action.executionId });
    if (!execution) return notFound(action.kind, "execution", action.executionId, { executionId: action.executionId });
    return success(action.kind, { executionId: action.executionId, report: { schema: "execution-show-report/v1", execution } });
  }
  if (action.kind === "execution-list") {
    const executions = queryExecutionsByTask({ ...options, taskId: action.taskId });
    return success(action.kind, { taskId: action.taskId, rows: executions.length, report: { schema: "execution-list-report/v1", taskId: action.taskId, executions } });
  }
  if (action.kind === "task-trace") {
    const trace = queryTaskExecutionTrace({ ...options, taskId: action.taskId });
    return success(action.kind, { taskId: action.taskId, report: { schema: "task-trace-report/v1", trace } });
  }
  if (action.kind === "review-show") {
    const review = queryReviewProjection({ ...options, reviewId: action.reviewId });
    if (!review) return notFound(action.kind, "review", action.reviewId, { reviewId: action.reviewId });
    return success(action.kind, { reviewId: action.reviewId, report: { schema: "review-show-report/v1", review } });
  }
  const audit = auditTaskProvenance({ ...options, taskId: action.taskId });
  return success(action.kind, { taskId: action.taskId, report: { schema: "provenance-audit-report/v1", audit } });
});

function success(command: string, fields: Omit<CliResult, "ok" | "command">): CliResult {
  return { ok: true, command, ...fields };
}

function notFound(command: string, kind: string, id: string, fields: Pick<CliResult, "sessionId" | "executionId" | "reviewId">): CliResult {
  return { ok: false, command, ...fields, error: cliError(CliErrorCode.RefNotFound, `${kind} not found: ${id}`) };
}
