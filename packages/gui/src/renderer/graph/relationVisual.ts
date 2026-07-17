import type { RelationKind, RelationEdge } from "../model/types";
import { KIND_AXIS, type SemanticAxis } from "./constants";

/**
 * 关系类型视觉词表 + 筛选/动画纯函数。
 *
 * 设计锚:dec_01KXA7811 语义轴分区保留 —— 色仍按 axis 走 CSS 变量;
 * 类型间差异用线型(dash)+ 线宽 + 端点形态表达,不另起一套色盘。
 * 动画克制:默认仅 focus(选中/悬停/邻接)边流动,全局开关兜底。
 */

export type RelationLineStyle = "solid" | "dashed" | "dotted";
export type RelationMarker = "arrowClosed" | "arrow" | "diamond";
export type FlowAnimMode = "off" | "focus" | "all";

export interface RelationVisual {
  dasharray: string | undefined;
  strokeWidth: number;
  marker: RelationMarker;
  lineStyle: RelationLineStyle;
}

/**
 * 每类 relation 的一致视觉词表。
 * 记忆锚:supersedes=堆叠(粗虚线) / derives=方向流(实线稍粗) / 路径类画线。
 */
export const RELATION_VISUAL: Record<RelationKind, RelationVisual> = {
  // authority
  derives: { dasharray: undefined, strokeWidth: 1.8, marker: "arrowClosed", lineStyle: "solid" },
  supersedes: { dasharray: "6 3", strokeWidth: 2.2, marker: "arrowClosed", lineStyle: "dashed" },
  refines: { dasharray: "6 3", strokeWidth: 1.6, marker: "arrowClosed", lineStyle: "dashed" },
  narrows: { dasharray: "2 3", strokeWidth: 1.5, marker: "arrow", lineStyle: "dotted" },
  supports: { dasharray: "1.5 2.5", strokeWidth: 1.4, marker: "arrow", lineStyle: "dotted" },
  // evidence
  "evidenced-by": { dasharray: undefined, strokeWidth: 1.6, marker: "arrowClosed", lineStyle: "solid" },
  evidences: { dasharray: undefined, strokeWidth: 1.5, marker: "arrow", lineStyle: "solid" },
  "supersedes-fact": { dasharray: "6 3", strokeWidth: 2.0, marker: "arrowClosed", lineStyle: "dashed" },
  refutes: { dasharray: "4 3", strokeWidth: 1.6, marker: "diamond", lineStyle: "dashed" },
  "invalidated-by": { dasharray: "2 3", strokeWidth: 1.5, marker: "diamond", lineStyle: "dotted" },
  // execution
  "depends-on": { dasharray: undefined, strokeWidth: 1.6, marker: "arrowClosed", lineStyle: "solid" },
  blocks: { dasharray: "8 3", strokeWidth: 2.0, marker: "diamond", lineStyle: "dashed" },
  produces: { dasharray: undefined, strokeWidth: 1.5, marker: "arrowClosed", lineStyle: "solid" },
  // assoc
  relates: { dasharray: "4 3", strokeWidth: 1.2, marker: "arrow", lineStyle: "dashed" },
  implements: { dasharray: "1.5 2.5", strokeWidth: 1.4, marker: "arrowClosed", lineStyle: "dotted" },
};

/** 稳定顺序:按语义轴分组,便于筛选 UI 与图例。 */
export const RELATION_KIND_ORDER: ReadonlyArray<RelationKind> = [
  "derives",
  "supersedes",
  "refines",
  "narrows",
  "supports",
  "evidenced-by",
  "evidences",
  "supersedes-fact",
  "refutes",
  "invalidated-by",
  "depends-on",
  "blocks",
  "produces",
  "relates",
  "implements",
];

export function visualForKind(kind: RelationKind): RelationVisual {
  return RELATION_VISUAL[kind] ?? RELATION_VISUAL.relates;
}

export function defaultKindFilter(): Set<RelationKind> {
  return new Set(RELATION_KIND_ORDER);
}

/** 边是否通过关系类型筛选。kinds 空集 = 全部隐藏(与 axis 全关语义一致)。 */
export function edgePassesKindFilter(
  edge: Pick<RelationEdge, "kind">,
  kinds: ReadonlySet<string>,
): boolean {
  return kinds.has(edge.kind);
}

/**
 * 是否应对该边开流动动画。
 * - off: 全关
 * - all: 全开(大图慎用)
 * - focus: 仅选中 / 悬停 / 邻接(one-hop)
 */
export function shouldAnimateEdge(
  mode: FlowAnimMode,
  opts: { selected: boolean; hovered: boolean; adjacent: boolean },
): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  return opts.selected || opts.hovered || opts.adjacent;
}

/** 按轴分组的 kind 列表(筛选 UI / 图例用)。 */
export function kindsByAxis(): Record<SemanticAxis, RelationKind[]> {
  const out: Record<SemanticAxis, RelationKind[]> = {
    authority: [],
    evidence: [],
    execution: [],
    assoc: [],
  };
  for (const kind of RELATION_KIND_ORDER) {
    out[KIND_AXIS[kind]].push(kind);
  }
  return out;
}

/** 图例行:取每轴代表 kind(首个),用于紧凑图例;完整词表走筛选面板。 */
export function legendSampleKinds(): ReadonlyArray<{ kind: RelationKind; axis: SemanticAxis }> {
  return [
    { kind: "derives", axis: "authority" },
    { kind: "supersedes", axis: "authority" },
    { kind: "evidenced-by", axis: "evidence" },
    { kind: "depends-on", axis: "execution" },
    { kind: "blocks", axis: "execution" },
    { kind: "relates", axis: "assoc" },
  ];
}
