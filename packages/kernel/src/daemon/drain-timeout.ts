export type DaemonQueueDrainTarget =
  | { readonly kind: "interactive"; readonly commandId: string; readonly opIds: ReadonlyArray<string> }
  | { readonly kind: "background"; readonly source: string };

export class DaemonDrainTimeoutError extends Error {
  readonly targets: ReadonlyArray<DaemonQueueDrainTarget>;

  constructor(rootDir: string, drainTimeoutMs: number, targets: ReadonlyArray<DaemonQueueDrainTarget>) {
    super(`daemon queue drain timed out after ${drainTimeoutMs}ms for ${rootDir}: ${targets.map(describeDrainTarget).join(", ") || "unknown in-flight operation"}`);
    this.name = "DaemonDrainTimeoutError";
    this.targets = targets;
  }
}

function describeDrainTarget(target: DaemonQueueDrainTarget): string {
  return target.kind === "interactive"
    ? `interactive command ${target.commandId} (${target.opIds.join(",")})`
    : `background source ${target.source}`;
}
