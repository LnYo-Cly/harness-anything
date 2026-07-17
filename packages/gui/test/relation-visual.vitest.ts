import { describe, expect, it } from "vitest";
import type { RelationKind } from "../src/renderer/model/types.ts";
import {
  RELATION_KIND_ORDER,
  RELATION_VISUAL,
  defaultKindFilter,
  edgePassesKindFilter,
  kindsByAxis,
  legendSampleKinds,
  shouldAnimateEdge,
  visualForKind,
} from "../src/renderer/graph/relationVisual.ts";
import { KIND_AXIS, AXIS_ORDER } from "../src/renderer/graph/constants.ts";

describe("relationVisual vocabulary", () => {
  it("covers every RelationKind in ORDER and VISUAL", () => {
    const orderSet = new Set(RELATION_KIND_ORDER);
    expect(orderSet.size).toBe(RELATION_KIND_ORDER.length);
    for (const kind of Object.keys(KIND_AXIS) as RelationKind[]) {
      expect(orderSet.has(kind), `missing in ORDER: ${kind}`).toBe(true);
      expect(RELATION_VISUAL[kind], `missing visual: ${kind}`).toBeDefined();
      expect(visualForKind(kind).strokeWidth).toBeGreaterThan(0);
    }
  });

  it("maps lineStyle to dasharray consistently", () => {
    for (const kind of RELATION_KIND_ORDER) {
      const v = visualForKind(kind);
      if (v.lineStyle === "solid") {
        expect(v.dasharray).toBeUndefined();
      } else {
        expect(typeof v.dasharray).toBe("string");
        expect((v.dasharray as string).length).toBeGreaterThan(0);
      }
    }
  });

  it("groups kinds by semantic axis without orphans", () => {
    const grouped = kindsByAxis();
    let total = 0;
    for (const axis of AXIS_ORDER) {
      total += grouped[axis].length;
      for (const kind of grouped[axis]) {
        expect(KIND_AXIS[kind]).toBe(axis);
      }
    }
    expect(total).toBe(RELATION_KIND_ORDER.length);
  });

  it("legend samples pick known kinds on their axes", () => {
    for (const sample of legendSampleKinds()) {
      expect(KIND_AXIS[sample.kind]).toBe(sample.axis);
      expect(RELATION_VISUAL[sample.kind]).toBeDefined();
    }
  });
});

describe("edgePassesKindFilter", () => {
  it("defaults to all kinds open", () => {
    const all = defaultKindFilter();
    expect(all.size).toBe(RELATION_KIND_ORDER.length);
    for (const kind of RELATION_KIND_ORDER) {
      expect(edgePassesKindFilter({ kind }, all)).toBe(true);
    }
  });

  it("hides unselected kinds", () => {
    const only = new Set<RelationKind>(["derives", "depends-on"]);
    expect(edgePassesKindFilter({ kind: "derives" }, only)).toBe(true);
    expect(edgePassesKindFilter({ kind: "depends-on" }, only)).toBe(true);
    expect(edgePassesKindFilter({ kind: "relates" }, only)).toBe(false);
    expect(edgePassesKindFilter({ kind: "blocks" }, only)).toBe(false);
  });

  it("empty set hides everything", () => {
    expect(edgePassesKindFilter({ kind: "derives" }, new Set())).toBe(false);
  });
});

describe("shouldAnimateEdge", () => {
  it("off never animates", () => {
    expect(shouldAnimateEdge("off", { selected: true, hovered: true, adjacent: true })).toBe(false);
  });

  it("all always animates", () => {
    expect(shouldAnimateEdge("all", { selected: false, hovered: false, adjacent: false })).toBe(true);
  });

  it("focus only for selected / hovered / adjacent", () => {
    expect(shouldAnimateEdge("focus", { selected: false, hovered: false, adjacent: false })).toBe(false);
    expect(shouldAnimateEdge("focus", { selected: true, hovered: false, adjacent: false })).toBe(true);
    expect(shouldAnimateEdge("focus", { selected: false, hovered: true, adjacent: false })).toBe(true);
    expect(shouldAnimateEdge("focus", { selected: false, hovered: false, adjacent: true })).toBe(true);
  });
});
