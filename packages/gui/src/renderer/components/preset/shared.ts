import type { PresetEntry, PresetSource } from "../../model/types";
import { t } from "../../i18n/core.ts";

export type TabId = "preset" | "vertical" | "templates";

export const TABS: { id: TabId; label: string }[] = [
  { id: "preset", get label() { return t("components.shared.preset"); } },
  { id: "vertical", get label() { return t("components.shared.vertical"); } },
  { id: "templates", get label() { return t("components.shared.templateLibrary"); } },
];

export const SOURCE_SECTIONS: { source: PresetSource; label: string; hint: string }[] = [
  { source: "project", get label() { return t("components.shared.project"); }, get hint() { return t("components.shared.projectLevelHighestPriority"); } },
  { source: "user", get label() { return t("components.shared.user"); }, get hint() { return t("components.shared.userLevel"); } },
  { source: "builtin", get label() { return t("components.shared.builtin"); }, get hint() { return t("components.shared.builtCannotUninstalled"); } },
];

export const flowSteps = () => [
  t("components.shared.vertical"),
  t("components.shared.preset"),
  t("components.shared.materializedDocument"),
  t("components.shared.refsEvents"),
  t("components.shared.projectionReconstruction"),
];

export const ACTION_BTN =
  "rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted";

export const CHIP =
  "rounded border border-border px-1.5 py-px font-mono text-[10px] text-text-muted";

/** Short section titles only — long prose must not use this (see SECTION_HINT). */
export const SECTION_LABEL =
  "text-[10px] font-medium uppercase tracking-wide text-text-faint";

/** Non-uppercase hint that rides next to a short SECTION_LABEL title. */
export const SECTION_HINT =
  "text-[10px] font-normal normal-case tracking-normal text-text-faint";

/**
 * Render a section heading. If the i18n string contains " · ", the left side
 * is the short title (uppercase) and the right side is a normal-case hint —
 * avoids multi-line ALL-CAPS walls on long EN copy (D1 item10).
 */
export function sectionHeading(text: string): { title: string; hint?: string } {
  const sep = " · ";
  const i = text.indexOf(sep);
  if (i === -1) return { title: text };
  return { title: text.slice(0, i), hint: text.slice(i + sep.length) };
}

export const shortRef = (ref: string) => ref.replace(/^template:\/\//, "");

/** Shared meta-column track sizes (English-safe mins). */
export const META_COL_VERTICAL = "minmax(8.5rem,auto)";
export const META_COL_PROFILE = "minmax(9rem,auto)";
export const META_COL_KIND = "minmax(8.5rem,auto)";
export const META_COL_DOCKIND = "minmax(11rem,auto)";
export const META_COL_ID = "minmax(11rem,auto)";
export const META_COL_VERSION = "minmax(3.25rem,auto)";

/** Right-aligned version cell shared by all three row variants. */
export const VERSION_TAIL =
  "min-w-[3.25rem] shrink-0 text-right font-mono text-[11px] text-text-faint";

/**
 * Preset row header grid:
 *   title | vertical | profile | status | version | caret          (<lg, kind hidden)
 *   title | vertical | profile | kind | status | version | caret   (lg+)
 */
export const PRESET_HEADER_GRID =
  "grid w-full items-center gap-x-2 px-3 py-2 text-left hover:bg-surface-raised/60 grid-cols-[minmax(0,1fr)_minmax(8.5rem,auto)_minmax(9rem,auto)_auto_auto_auto] lg:grid-cols-[minmax(0,1fr)_minmax(8.5rem,auto)_minmax(9rem,auto)_minmax(8.5rem,auto)_auto_auto_auto]";

/** Template row header: title | documentKind | locales | version */
export const TEMPLATE_HEADER_GRID =
  "grid w-full items-center gap-x-2 grid-cols-[minmax(0,1fr)_minmax(11rem,auto)_auto_auto]";

/** Vertical row header: title | id | version */
export const VERTICAL_HEADER_GRID =
  "grid w-full items-center gap-x-2 grid-cols-[minmax(0,1fr)_minmax(11rem,auto)_auto]";

/** 继承链：单父链回溯，循环安全 */
export function chainOf(entry: PresetEntry, all: PresetEntry[]): PresetEntry[] {
  const byId = new Map(all.map((p) => [p.id, p]));
  const chain = [entry];
  let cur = entry;
  while (cur.extends) {
    const parent = byId.get(cur.extends);
    if (!parent || chain.includes(parent)) break;
    chain.push(parent);
    cur = parent;
  }
  return chain;
}
