import { commandSpecMap, type CommandKind } from "./command-spec/index.ts";
import type { CommandReceiptContract } from "./command-spec/types.ts";

export type { CommandReceiptContract } from "./command-spec/types.ts";
export type { CommandKind } from "./command-spec/index.ts";

export const commandReceiptContractsByKind: Record<CommandKind, CommandReceiptContract> = {
  ...commandSpecMap((entry) => entry.receiptContract)
};

export const commandDryRunPreviewRequiredByKind: Record<CommandKind, boolean> = {
  ...commandSpecMap((entry) => entry.options.some((option) => option.flag === "--dry-run"))
};
