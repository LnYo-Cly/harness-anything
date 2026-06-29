import { readFileSync } from "fs";
import { resolvePresetEntry } from "./packages/cli/dist/cli/src/commands/extensions/registry.js";
import { materializePresetTaskDocuments } from "./packages/cli/dist/cli/src/commands/extensions/state.js";

const rootDir = process.cwd();
const preset = resolvePresetEntry(rootDir, "standard-task");
const mat = materializePresetTaskDocuments(preset.manifest, { locale: "zh-CN", profileId: "baseline" });
console.log(mat.documents.map(d => d.materializeAs));
