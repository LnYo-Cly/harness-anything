import { Effect } from "effect";
import { isTaskHolderError, type TaskHolderPrincipal } from "../../../../application/src/index.ts";
import { cliError, CliErrorCode } from "../../cli/error-codes.ts";
import type { CliResult } from "../../cli/types.ts";
import type { CommandRunner, CommandRunnerContext } from "../../cli/runner-registry.ts";

type TaskHolderAction = Extract<
  Parameters<CommandRunner>[1]["action"],
  { readonly kind: "task-claim" | "task-holder" | "task-release" }
>;

export function runTaskClaim(
  context: CommandRunnerContext,
  action: Extract<TaskHolderAction, { readonly kind: "task-claim" }>
): Effect.Effect<CliResult> {
  return Effect.gen(function* () {
    const principal = taskHolderPrincipal(context);
    if (!principal.ok) return principal.result;
    return yield* Effect.tryPromise({
      try: () => context.taskHolderService.claim({ taskId: action.taskId, principal: principal.value, ttlMs: action.ttlMs }),
      catch: taskHolderCommandFailure
    }).pipe(Effect.match({
      onFailure: (result): CliResult => resultForTaskHolderFailure("task-claim", action.taskId, result),
      onSuccess: (result): CliResult => ({
        ok: true,
        command: "task-claim",
        taskId: action.taskId,
        report: {
          schema: "task-holder-claim-result/v1",
          ...result
        }
      })
    }));
  });
}

export function runTaskHolder(
  context: CommandRunnerContext,
  action: Extract<TaskHolderAction, { readonly kind: "task-holder" }>
): Effect.Effect<CliResult> {
  return Effect.tryPromise({
    try: () => context.taskHolderService.holder({ taskId: action.taskId }),
    catch: taskHolderCommandFailure
  }).pipe(Effect.match({
    onFailure: (result): CliResult => resultForTaskHolderFailure("task-holder", action.taskId, result),
    onSuccess: (result): CliResult => ({
      ok: true,
      command: "task-holder",
      taskId: action.taskId,
      report: {
        schema: "task-holder-snapshot/v1",
        ...result
      }
    })
  }));
}

export function runTaskRelease(
  context: CommandRunnerContext,
  action: Extract<TaskHolderAction, { readonly kind: "task-release" }>
): Effect.Effect<CliResult> {
  return Effect.gen(function* () {
    const principal = taskHolderPrincipal(context);
    if (!principal.ok) return principal.result;
    return yield* Effect.tryPromise({
      try: () => context.taskHolderService.release({ taskId: action.taskId, principal: principal.value }),
      catch: taskHolderCommandFailure
    }).pipe(Effect.match({
      onFailure: (result): CliResult => resultForTaskHolderFailure("task-release", action.taskId, result),
      onSuccess: (result): CliResult => ({
        ok: true,
        command: "task-release",
        taskId: action.taskId,
        report: {
          schema: "task-holder-release-result/v1",
          ...result
        }
      })
    }));
  });
}

function taskHolderPrincipal(context: CommandRunnerContext):
  | { readonly ok: true; readonly value: TaskHolderPrincipal }
  | { readonly ok: false; readonly result: CliResult } {
  try {
    return { ok: true, value: context.taskHolderPrincipal() };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        command: "task-holder",
        error: cliError(CliErrorCode.AuthMissing, error instanceof Error ? error.message : String(error))
      }
    };
  }
}

function taskHolderCommandFailure(error: unknown): CliResult {
  if (isTaskHolderError(error)) {
    return {
      ok: false,
      command: "task-holder",
      taskId: error.taskId,
      error: cliError(CliErrorCode.WriteRejected, error.message),
      report: {
        schema: "task-holder-error/v1",
        code: error.code,
        taskId: error.taskId,
        ...("holder" in error ? { holder: error.holder } : {}),
        ...("principal" in error ? { principal: error.principal } : {}),
        ...("leaseExpiresAt" in error ? { leaseExpiresAt: error.leaseExpiresAt } : {}),
        ...("orphan" in error ? { orphan: error.orphan } : {})
      }
    };
  }
  return {
    ok: false,
    command: "task-holder",
    error: cliError(CliErrorCode.JournalUnavailable, error instanceof Error ? error.message : String(error))
  };
}

function resultForTaskHolderFailure(command: "task-claim" | "task-holder" | "task-release", taskId: string, result: CliResult): CliResult {
  return {
    ...result,
    command,
    taskId
  };
}
