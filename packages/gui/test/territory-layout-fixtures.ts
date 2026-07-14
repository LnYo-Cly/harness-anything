import { expect } from "vitest";
import type { TaskRow, DecisionRow, FactRef, RelationEdge } from "../src/renderer/model/types";
import type { GraphFilterInput } from "../src/renderer/graph/graphLayoutTypes";

// 共享测试工厂 + 几何断言 —— territory-layout*.vitest.ts 各文件共用。
// 从 territory-layout.vitest.ts 抽出,使各测试文件保持在文件复杂度门以内。

// ── 精简工厂 ──
export const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({
    taskId: id,
    title: `T ${id}`,
    coordinationStatus: "active",
    module: "m",
    rootTaskId: id,
    rootTitle: `Root ${id}`,
    lastKnownAt: new Date().toISOString(),
    ...extra,
  }) as unknown as TaskRow;

export const decision = (id: string, extra: Partial<DecisionRow> = {}): DecisionRow =>
  ({
    decisionId: id,
    title: `D ${id}`,
    state: "active",
    question: "q",
    chosen: [],
    rejected: [],
    claims: [],
    ...extra,
  }) as unknown as DecisionRow;

export const fact = (taskId: string, factId: string, extra: Partial<FactRef> = {}): FactRef =>
  ({
    anchor: `${taskId}/${factId}`,
    taskId,
    category: "finding",
    text: `Fact ${factId}`,
    at: "2026-07-10",
    confidence: "high",
    ...extra,
  }) as unknown as FactRef;

export const rel = (from: string, to: string, kind: RelationEdge["kind"]): RelationEdge =>
  ({ from, to, kind, provenance: "local-document" }) as RelationEdge;

export const ALL_FILTERS: GraphFilterInput = {
  modules: new Set<string>(),
  types: new Set(["task", "decision", "fact"]),
  axes: { authority: true, evidence: true, execution: true, assoc: true },
};

export const filters = (over: Partial<GraphFilterInput> = {}): GraphFilterInput => ({
  ...ALL_FILTERS,
  ...over,
});

// ── 辅助:节点重叠检测 ──
export function boxesOverlap(a: any, b: any): boolean {
  const aw = a.width ?? a.style?.width ?? 0;
  const ah = a.height ?? a.style?.height ?? 0;
  const bw = b.width ?? b.style?.width ?? 0;
  const bh = b.height ?? b.style?.height ?? 0;
  return (
    a.position.x < b.position.x + bw &&
    b.position.x < a.position.x + aw &&
    a.position.y < b.position.y + bh &&
    b.position.y < a.position.y + ah
  );
}

// section 节点是宽薄标签,不参与重叠检测(它们故意横跨整行)
// chip 故意叠在 zone 上面(zone 是背景),所以只检测:
//   zone-vs-zone(不同 zone 不应重叠)
//   chip-vs-chip(不同 chip 不应重叠)
export function zoneNodes(ns: any[]): any[] {
  return ns.filter((n) => n.type === "territoryZone" && n.data?.variant === "zone");
}
export function chipNodes(ns: any[]): any[] {
  return ns.filter((n) => n.type === "territoryChip");
}
/** zone-vs-zone + chip-vs-chip 零重叠(不检 zone-vs-chip:后者故意叠在前者上)。 */
export function expectNoOverlap(ns: any[]) {
  const zones = zoneNodes(ns);
  const chips = chipNodes(ns);
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      expect(boxesOverlap(zones[i], zones[j])).toBe(false);
    }
  }
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      expect(boxesOverlap(chips[i], chips[j])).toBe(false);
    }
  }
}
