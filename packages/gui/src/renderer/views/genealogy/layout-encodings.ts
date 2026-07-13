import type { DecisionRow } from "../../model/types";
import {
  AXIS_H,
  CARD_H,
  CARD_W,
  CLUSTER_H,
  CLUSTER_W,
  EMPTY_LAYOUT,
  type GenealogyEdge,
  type LaidOutNode,
  type LayoutOptions,
  type TimelineLayout,
  PAD_X,
  PAD_Y,
  ROW_H,
  collectRawNodes,
  findGenealogyCycles,
  packDepthLanes,
  type RawLineageNode,
} from "./layout";

/**
 * 三种非线性时间编码。各自在真实 143 参与者谱系上可独立截图对照。
 */

/**
 * 焦点谱系布局调度。encoding 决定 x 轴语义：
 * - ordinal：事件序，空白日不占宽
 * - day-cluster：同日折叠为簇，点开展开
 * - dag：拓扑 LR，时间只排序
 */
export function computeLayout(
  focus: DecisionRow | null,
  edges: GenealogyEdge[],
  byId: Map<string, DecisionRow>,
  plotWidth: number,
  options: LayoutOptions = {},
): TimelineLayout {
  if (!focus) return EMPTY_LAYOUT;
  const encoding = options.encoding ?? "ordinal";
  const expandedDays = options.expandedDays ?? new Set<string>();
  const cycles = findGenealogyCycles(edges);
  const cycleWarning = { count: cycles.length, cycles };

  let layout: TimelineLayout;
  if (encoding === "day-cluster") {
    layout = computeDayClusterLayout(focus, edges, byId, plotWidth, expandedDays);
  } else if (encoding === "dag") {
    layout = computeDagLayout(focus, edges, byId, plotWidth);
  } else {
    layout = computeOrdinalLayout(focus, edges, byId, plotWidth);
  }
  return { ...layout, cycleWarning };
}

function timeExtent(nodes: RawLineageNode[]): { minT: number; maxT: number } {
  const times = nodes.map((n) => n.timeMs).filter((t): t is number => t !== null);
  if (times.length === 0) return { minT: 0, maxT: 0 };
  return { minT: Math.min(...times), maxT: Math.max(...times) };
}

function finishLayout(
  placed: LaidOutNode[],
  ticks: { x: number; label: string }[],
  minT: number,
  maxT: number,
  encoding: TimelineLayout["encoding"],
  cardW: number = CARD_W,
): TimelineLayout {
  const maxRight = placed.reduce((m, n) => {
    const w = n.isCluster ? CLUSTER_W : cardW;
    return Math.max(m, n.x + w);
  }, PAD_X + 360);
  const maxBottom = placed.reduce((m, n) => {
    const h = n.isCluster ? CLUSTER_H : CARD_H;
    return Math.max(m, n.y + h);
  }, AXIS_H + PAD_Y + ROW_H);
  return {
    nodes: placed,
    width: Math.max(maxRight + PAD_X, 480),
    height: maxBottom + PAD_Y,
    ticks,
    minT,
    maxT,
    encoding,
    cycleWarning: { count: 0, cycles: [] },
  };
}

/**
 * 序数轴：按 timeMs 排序后等距占位。同一毫秒用 id 稳定破并列。
 * 空白日不占 x 宽度——这是相对线性轴的核心修正。
 */
export function computeOrdinalLayout(
  focus: DecisionRow,
  edges: GenealogyEdge[],
  byId: Map<string, DecisionRow>,
  plotWidth: number,
): TimelineLayout {
  const raw = collectRawNodes(focus, edges, byId);
  const { minT, maxT } = timeExtent(raw);
  const ordered = [...raw].sort((a, b) => {
    const ta = a.timeMs ?? Number.POSITIVE_INFINITY;
    const tb = b.timeMs ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });

  const n = Math.max(1, ordered.length);
  const plotW = Math.max(360, plotWidth - PAD_X * 2 - CARD_W);
  // 节点多时拉开画布，避免挤成一团；节点少时填满可视宽。
  const step = Math.max(CARD_W + LANE_STEP_MIN, Math.min(CARD_W + 48, plotW / Math.max(1, n - 1 || 1)));
  const contentW = Math.max(plotW, (n - 1) * step);

  const rankOf = new Map(ordered.map((node, index) => [node.id, index]));
  const withX = ordered.map((node) => {
    const rank = rankOf.get(node.id) ?? 0;
    const x =
      n === 1
        ? PAD_X + contentW / 2 - CARD_W / 2
        : PAD_X + rank * step;
    return { ...node, x, isCluster: false as const };
  });

  const { placed } = packDepthLanes(withX);

  // 刻度：每个新出现的 day 在该日首个节点处标一次。
  const seenDays = new Set<string>();
  const ticks: { x: number; label: string }[] = [];
  for (const node of ordered) {
    if (seenDays.has(node.dayKey)) continue;
    seenDays.add(node.dayKey);
    const rank = rankOf.get(node.id) ?? 0;
    const x = n === 1 ? PAD_X + contentW / 2 : PAD_X + rank * step;
    ticks.push({ x, label: node.dayKey === "NO_TIME" ? "无时间" : node.dayKey.slice(5) });
  }

  return finishLayout(placed, ticks, minT, maxT, "ordinal");
}

const LANE_STEP_MIN = 12;

/**
 * 日簇折叠：同日合成簇。expandedDays 内的日展开为独立卡。
 * 143 → 可读的十余个日单元（参与者日分布约 12 桶）。
 */
export function computeDayClusterLayout(
  focus: DecisionRow,
  edges: GenealogyEdge[],
  byId: Map<string, DecisionRow>,
  plotWidth: number,
  expandedDays: ReadonlySet<string>,
): TimelineLayout {
  const raw = collectRawNodes(focus, edges, byId);
  const { minT, maxT } = timeExtent(raw);

  const byDay = new Map<string, RawLineageNode[]>();
  for (const node of raw) {
    const list = byDay.get(node.dayKey) ?? [];
    list.push(node);
    byDay.set(node.dayKey, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      const ta = a.timeMs ?? 0;
      const tb = b.timeMs ?? 0;
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
  }

  const dayOrder = [...byDay.keys()].sort((a, b) => {
    if (a === "NO_TIME") return 1;
    if (b === "NO_TIME") return -1;
    return a.localeCompare(b);
  });

  // 展开单元序列：折叠日=1 单元，展开日=成员数。
  type Unit =
    | { kind: "cluster"; dayKey: string; members: RawLineageNode[] }
    | { kind: "card"; dayKey: string; node: RawLineageNode };
  const units: Unit[] = [];
  for (const day of dayOrder) {
    const members = byDay.get(day)!;
    if (members.length === 1 || expandedDays.has(day)) {
      for (const node of members) units.push({ kind: "card", dayKey: day, node });
    } else {
      units.push({ kind: "cluster", dayKey: day, members });
    }
  }

  const n = Math.max(1, units.length);
  const plotW = Math.max(360, plotWidth - PAD_X * 2 - CARD_W);
  const step = Math.max(CLUSTER_W + LANE_STEP_MIN, Math.min(CARD_W + 40, plotW / Math.max(1, n - 1 || 1)));
  const contentW = Math.max(plotW, (n - 1) * step);

  const withX: Array<Omit<LaidOutNode, "y">> = units.map((unit, index) => {
    const x = n === 1 ? PAD_X + contentW / 2 - CARD_W / 2 : PAD_X + index * step;
    if (unit.kind === "cluster") {
      // 簇挂在成员 depth 中位数，避免全贴焦点行。
      const depths = unit.members.map((m) => m.depth).sort((a, b) => a - b);
      const mid = depths[Math.floor(depths.length / 2)] ?? 0;
      const seed = unit.members[0]!;
      return {
        id: `cluster:${unit.dayKey}`,
        decision: seed.decision,
        depth: mid,
        timeMs: seed.timeMs,
        dayKey: unit.dayKey,
        x,
        isCluster: true,
        clusterSize: unit.members.length,
        memberIds: unit.members.map((m) => m.id),
      };
    }
    return {
      ...unit.node,
      x,
      isCluster: false,
      dayKey: unit.dayKey,
    };
  });

  const { placed } = packDepthLanes(withX);

  const ticks: { x: number; label: string }[] = [];
  const tickDays = new Set<string>();
  units.forEach((unit, index) => {
    if (tickDays.has(unit.dayKey)) return;
    tickDays.add(unit.dayKey);
    const x = n === 1 ? PAD_X + contentW / 2 : PAD_X + index * step;
    ticks.push({
      x,
      label: unit.dayKey === "NO_TIME" ? "无时间" : unit.dayKey.slice(5),
    });
  });

  return finishLayout(placed, ticks, minT, maxT, "day-cluster");
}

/**
 * DAG 优先：x = 拓扑层（祖先→后代），同层按时间排序后垂直装道。
 * 时间不做坐标，只做层内排序约束。
 */
export function computeDagLayout(
  focus: DecisionRow,
  edges: GenealogyEdge[],
  byId: Map<string, DecisionRow>,
  plotWidth: number,
): TimelineLayout {
  const raw = collectRawNodes(focus, edges, byId);
  const { minT, maxT } = timeExtent(raw);
  const ids = new Set(raw.map((n) => n.id));
  const nodeById = new Map(raw.map((n) => [n.id, n]));

  // 仅焦点谱系内的边。
  const local = edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  // 祖先方向 edge.to ← edge.from；拓扑层：无入边（纯祖先端）层 0。
  // 但我们要「祖先在左、后代在右」：用 depth 平移到非负 rank 更稳——
  // rank = depth - minDepth，使最老祖先 rank=0。
  const depths = raw.map((n) => n.depth);
  const minDepth = depths.length ? Math.min(...depths) : 0;
  const rankOf = new Map(raw.map((n) => [n.id, n.depth - minDepth]));

  // 若边跨越非相邻 rank，保留；不重算 longest-path（depth BFS 已给谱系层）。
  // 同 rank 内按时间排序。
  const byRank = new Map<number, RawLineageNode[]>();
  for (const node of raw) {
    const rank = rankOf.get(node.id) ?? 0;
    const list = byRank.get(rank) ?? [];
    list.push(node);
    byRank.set(rank, list);
  }
  for (const list of byRank.values()) {
    list.sort((a, b) => {
      const ta = a.timeMs ?? Number.POSITIVE_INFINITY;
      const tb = b.timeMs ?? Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
  }

  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const maxRank = ranks.length ? Math.max(...ranks) : 0;
  const plotW = Math.max(360, plotWidth - PAD_X * 2 - CARD_W);
  const colStep =
    maxRank <= 0
      ? 0
      : Math.max(CARD_W + LANE_STEP_MIN, Math.min(CARD_W + 80, plotW / maxRank));
  const contentW = Math.max(plotW, maxRank * colStep);

  // 同列垂直堆叠（时间序），不按 depth 分带——depth 已编码为 x。
  const placed: LaidOutNode[] = [];
  let maxRows = 1;
  for (const rank of ranks) {
    const col = byRank.get(rank) ?? [];
    maxRows = Math.max(maxRows, col.length);
    col.forEach((node, row) => {
      const x =
        maxRank === 0
          ? PAD_X + contentW / 2 - CARD_W / 2
          : PAD_X + rank * colStep;
      placed.push({
        ...node,
        x,
        y: AXIS_H + PAD_Y + row * ROW_H,
        isCluster: false,
      });
    });
  }

  // 可选：用 local 边做轻微交叉惩罚重排——保持 deterministic 简单列堆叠。
  void local;
  void nodeById;

  const ticks = ranks.map((rank) => {
    const col = byRank.get(rank) ?? [];
    const label =
      rank === 0
        ? "祖先"
        : rank === maxRank
          ? "后代"
          : `层 ${rank}`;
    const x =
      maxRank === 0 ? PAD_X + contentW / 2 : PAD_X + rank * colStep;
    // 副标签：该列最早日期
    const day = col[0]?.dayKey;
    const dayLabel = day && day !== "NO_TIME" ? day.slice(5) : "";
    return {
      x,
      label: dayLabel ? `${label} · ${dayLabel}` : label,
    };
  });

  return finishLayout(placed, ticks, minT, maxT, "dag");
}
