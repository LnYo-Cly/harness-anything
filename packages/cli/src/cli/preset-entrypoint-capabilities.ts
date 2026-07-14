export const presetRunEntrypointCapabilities = [
  "plan",
  "scaffold",
  "check",
  "audit",
  "gather",
  "render-html"
] as const;

export type PresetRunEntrypoint = (typeof presetRunEntrypointCapabilities)[number];

export const presetRunEntrypointUsage = `<${presetRunEntrypointCapabilities.join("|")}>`;

export function isPresetRunEntrypoint(value: string | undefined): value is PresetRunEntrypoint {
  return typeof value === "string" && presetRunEntrypointCapabilities.some((entrypoint) => entrypoint === value);
}
