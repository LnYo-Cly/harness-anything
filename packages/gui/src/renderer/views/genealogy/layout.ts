import type { DecisionRow, RelationEdge, RelationKind } from "../../model/types";

/**
 * 决策谱系「演化史」视图的纯逻辑层：常量、类型、关系筛选、深度优先谱系收集。
 * 布局编码实现见 layout-encodings.ts。
 *
 * 时间维度是对的，但线性 wall-clock x 轴对点事件+成簇数据是错的。
 */

export const GENEALOGY_KINDS = new Set<RelationKind>([
  "refines",
  "narrows",
  "supersedes",
  "supports",
]);

/** 边语义：色 + 线型，不靠回头读图例也能分。 */
export const KIND_META: Record<
  string,
  { label: string; color: string; verb: string; dash: string; strokeWidth: number }
> = {
  refines: {
    label: "细化",
    color: "var(--color-accent)",
    verb: "细化了",
    dash: "",
    strokeWidth: 1.6,
  },
  narrows: {
    label: "收窄",
    color: "var(--color-status-in-review)",
    verb: "收窄了",
    dash: "5 3",
    strokeWidth: 1.6,
  },
  supersedes: {
    label: "推翻",
    color: "var(--color-danger)",
    verb: "推翻了",
    dash: "",
    strokeWidth: 2.4,
  },
  supports: {
    label: "支撑",
    color: "var(--color-status-done)",
    verb: "支撑了",
    dash: "1.5 2.5",
    strokeWidth: 1.4,
  },
};

/** 编码轴：替换线性时间 x 的三种可读方案。 */
export type EncodingMode = "ordinal" | "day-cluster" | "dag";

export const ENCODING_META: Record<
  EncodingMode,
  { label: string; short: string; blurb: string }
> = {
  ordinal: {
    label: "序数轴",
    short: "序数",
    blurb: "x=事件序，空白日不占宽",
  },
  "day-cluster": {
    label: "日簇折叠",
    short: "日簇",
    blurb: "同日合成簇节点，点开展开",
  },
  dag: {
    label: "DAG 拓扑",
    short: "DAG",
    blurb: "谱系拓扑排版，时间只做排序",
  },
};

// ---- 布局常量（px）----
export const CARD_W = 248;
export const CARD_H = 72;
export const ROW_H = 94;
export const AXIS_H = 34;
export const PAD_X = 28;
export const PAD_Y = 20;
export const LANE_GAP = 18;
export const CLUSTER_W = 168;
export const CLUSTER_H = 64;

export interface GenealogyEdge {
  from: string;
  to: string;
  kind: RelationKind;
  rationale?: string;
}

export interface LaidOutNode {
  id: string;
  decision: DecisionRow;
  depth: number;
  timeMs: number | null;
  x: number;
  y: number;
  dayKey?: string;
  isCluster?: boolean;
  clusterSize?: number;
  memberIds?: string[];
}

export interface TimelineLayout {
  nodes: LaidOutNode[];
  width: number;
  height: number;
  ticks: { x: number; label: string }[];
  minT: number;
  maxT: number;
  encoding: EncodingMode;
  cycleWarning: { count: number; cycles: string[][] };
}

export function decisionIdOf(ref: string): string | null {
  if (!ref.startsWith("decision/")) return null;
  const rest = ref.slice("decision/".length);
  const id = rest.split("/")[0];
  return id.length > 0 ? id : null;
}

export function timeMsOf(decision: DecisionRow): number | null {
  const raw = decision.decidedAt ?? decision.proposedAt;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function dayKeyOf(decision: DecisionRow): string {
  const raw = decision.decidedAt ?? decision.proposedAt;
  if (!raw) return "NO_TIME";
  return raw.slice(0, 10);
}

export function shortTime(decision: DecisionRow): string {
  const raw = decision.decidedAt ?? decision.proposedAt;
  if (!raw) return "无判定时间";
  return raw.slice(0, 10);
}

export function buildGenealogyEdges(
  relations: RelationEdge[],
  byId: Map<string, DecisionRow>,
): GenealogyEdge[] {
  const seen = new Set<string>();
  const edges: GenealogyEdge[] = [];
  for (const relation of relations) {
    if (!GENEALOGY_KINDS.has(relation.kind)) continue;
    const from = decisionIdOf(relation.from);
    const to = decisionIdOf(relation.to);
    if (!from || !to || from === to) continue;
    if (!byId.has(from) || !byId.has(to)) continue;
    const key = `${from}|${to}|${relation.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to, kind: relation.kind, rationale: relation.rationale });
  }
  return edges;
}

export function collectLineage(
  focusId: string,
  edges: GenealogyEdge[],
): Map<string, number> {
  const outByFrom = new Map<string, GenealogyEdge[]>();
  const inByTo = new Map<string, GenealogyEdge[]>();
  for (const edge of edges) {
    (outByFrom.get(edge.from) ?? outByFrom.set(edge.from, []).get(edge.from)!).push(edge);
    (inByTo.get(edge.to) ?? inByTo.set(edge.to, []).get(edge.to)!).push(edge);
  }

  const depth = new Map<string, number>([[focusId, 0]]);

  const upQueue: string[] = [focusId];
  while (upQueue.length > 0) {
    const current = upQueue.shift()!;
    const currentDepth = depth.get(current)!;
    for (const edge of outByFrom.get(current) ?? []) {
      if (!depth.has(edge.to)) {
        depth.set(edge.to, currentDepth - 1);
        upQueue.push(edge.to);
      }
    }
  }

  const downQueue: string[] = [focusId];
  while (downQueue.length > 0) {
    const current = downQueue.shift()!;
    const currentDepth = depth.get(current)!;
    for (const edge of inByTo.get(current) ?? []) {
      if (!depth.has(edge.from)) {
        depth.set(edge.from, currentDepth + 1);
        downQueue.push(edge.from);
      }
    }
  }

  return depth;
}

export function findGenealogyCycles(edges: GenealogyEdge[]): string[][] {
  const byFrom = new Map<string, string[]>();
  for (const edge of edges) {
    const arr = byFrom.get(edge.from) ?? [];
    arr.push(edge.to);
    byFrom.set(edge.from, arr);
  }
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string) => {
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      if (start >= 0) {
        const cycle = [...stack.slice(start), node];
        const key = cycle.join(">");
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          cycles.push(cycle);
        }
      }
      return;
    }
    if (visited.has(node)) return;
    onStack.add(node);
    stack.push(node);
    for (const next of byFrom.get(node) ?? []) visit(next);
    stack.pop();
    onStack.delete(node);
    visited.add(node);
  };

  for (const node of byFrom.keys()) visit(node);
  return cycles;
}

export interface RawLineageNode {
  id: string;
  decision: DecisionRow;
  depth: number;
  timeMs: number | null;
  dayKey: string;
}

export function collectRawNodes(
  focus: DecisionRow,
  edges: GenealogyEdge[],
  byId: Map<string, DecisionRow>,
): RawLineageNode[] {
  const depthMap = collectLineage(focus.decisionId, edges);
  return [...depthMap.entries()]
    .map(([id, depth]) => {
      const decision = byId.get(id);
      if (!decision) return null;
      return {
        id,
        decision,
        depth,
        timeMs: timeMsOf(decision),
        dayKey: dayKeyOf(decision),
      };
    })
    .filter((node): node is RawLineageNode => node !== null);
}

/** 同 depth 带内按 x 排序后贪心装道，零重叠。 */
export function packDepthLanes(
  nodes: Array<Omit<LaidOutNode, "y"> & { x: number }>,
  rowH: number = ROW_H,
): { placed: LaidOutNode[]; rowCount: number } {
  const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const placed: LaidOutNode[] = [];
  let rowCursor = 0;
  for (const depth of depths) {
    const group = nodes
      .filter((n) => n.depth === depth)
      .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
    const laneRight: number[] = [];
    for (const node of group) {
      const cardW = node.isCluster ? CLUSTER_W : CARD_W;
      let lane = laneRight.findIndex((right) => node.x >= right + LANE_GAP);
      if (lane === -1) {
        lane = laneRight.length;
        laneRight.push(0);
      }
      laneRight[lane] = node.x + cardW;
      placed.push({
        ...node,
        y: AXIS_H + PAD_Y + (rowCursor + lane) * rowH,
      });
    }
    rowCursor += Math.max(1, laneRight.length);
  }
  return { placed, rowCount: rowCursor };
}

export const EMPTY_LAYOUT: TimelineLayout = {
  nodes: [],
  width: 0,
  height: 0,
  ticks: [],
  minT: 0,
  maxT: 0,
  encoding: "ordinal",
  cycleWarning: { count: 0, cycles: [] },
};

export type LayoutOptions = {
  encoding?: EncodingMode;
  expandedDays?: ReadonlySet<string>;
};

// re-export dispatcher so现有 import { computeLayout } from "./layout" 仍可用
export { computeLayout } from "./layout-encodings";
