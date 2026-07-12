import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ClockCounterClockwise,
  GitBranch,
  Graph,
  MagnifyingGlass,
  ArrowSquareOut,
  X,
} from "@phosphor-icons/react";
import type { DecisionRow, RelationEdge, RelationKind } from "../model/types";
import { DecisionStateBadge } from "../components/badges";

/**
 * 决策谱系「演化史」视图（Jaeger-timeline 式）。
 *
 * 承接 dec_01KXA7811SVVT8P66HNDFZQ7DF 原则 6：关系图解决「结构」，而 decision
 * 谱系（refines/narrows/supersedes/supports）本质是**时间演化**，用一条时间轴
 * 更清晰——X=decidedAt（缺则 fallback proposedAt），行=谱系深度，节点=决策卡。
 *
 * 纯前端派生：从 triadicQuery.relations 里筛 kind ∈ 谱系四类且两端皆 decision，
 * 以选中 decision 为焦点上溯祖先 / 下溯后代。不改后端、不换图库、不碰 graph/**。
 */

// 谱系边：只认权威轴里表达「思想演化」的四类关系，两端必须都是 decision。
const GENEALOGY_KINDS = new Set<RelationKind>([
  "refines",
  "narrows",
  "supersedes",
  "supports",
]);

// 每类边的语义标签 + 语义色（复用 styles.css 里已定义的 token，绝不新造）。
const KIND_META: Record<
  string,
  { label: string; color: string; verb: string }
> = {
  refines: { label: "细化", color: "var(--color-accent)", verb: "细化了" },
  narrows: { label: "收窄", color: "var(--color-status-in-review)", verb: "收窄了" },
  supersedes: { label: "推翻", color: "var(--color-danger)", verb: "推翻了" },
  supports: { label: "支撑", color: "var(--color-status-done)", verb: "支撑了" },
};

// ---- 布局常量（px）----
const CARD_W = 210;
const CARD_H = 60;
const ROW_H = 82;
const AXIS_H = 34;
const PAD_X = 28;
const PAD_Y = 20;
const LANE_GAP = 26; // 同一深度带内两卡的最小水平间隙

/** 把 `decision/dec_x/CH1` 之类的 ref 归一成裸 decision id；非 decision 端返回 null。 */
function decisionIdOf(ref: string): string | null {
  if (!ref.startsWith("decision/")) return null;
  const rest = ref.slice("decision/".length);
  const id = rest.split("/")[0];
  return id.length > 0 ? id : null;
}

/** decidedAt 优先，缺则 proposedAt；都无 → null（优雅降级）。 */
function timeMsOf(decision: DecisionRow): number | null {
  const raw = decision.decidedAt ?? decision.proposedAt;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function shortTime(decision: DecisionRow): string {
  const raw = decision.decidedAt ?? decision.proposedAt;
  if (!raw) return "无判定时间";
  return raw.slice(0, 10);
}

interface GenealogyEdge {
  from: string; // 后代（较新，refines/narrows/... 的一方）
  to: string; // 祖先（较旧，被 refine 的一方）
  kind: RelationKind;
  rationale?: string;
}

interface LaidOutNode {
  id: string;
  decision: DecisionRow;
  depth: number; // 相对焦点：祖先为负、焦点为 0、后代为正
  timeMs: number | null;
  x: number; // 卡片左上角 x（含 PAD）
  y: number; // 卡片左上角 y（含 AXIS + PAD）
}

/** 全量谱系边（decision→decision），去重。 */
function buildGenealogyEdges(
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

/** 以 focus 为中心，上溯祖先（沿 from→to）+ 下溯后代（沿 to→from），返回带 depth 的谱系集合。 */
function collectLineage(
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

  // 上溯祖先：focus --refines--> ancestor，祖先更旧 → 负 depth。
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

  // 下溯后代：descendant --refines--> focus，后代更新 → 正 depth。
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

/** 时间轴上做 3–6 个刻度。 */
function axisTicks(minT: number, maxT: number): { t: number; label: string }[] {
  if (!(maxT > minT)) return [];
  const count = 5;
  const ticks: { t: number; label: string }[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = minT + ((maxT - minT) * i) / count;
    ticks.push({ t, label: new Date(t).toISOString().slice(0, 10) });
  }
  return ticks;
}

function DecisionDetailPanel({
  decision,
  onClose,
  onNavigateEntity,
  onFocusGraph,
}: {
  decision: DecisionRow;
  onClose: () => void;
  onNavigateEntity?: (ref: string) => void;
  onFocusGraph?: (ref: string) => void;
}) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex items-start gap-2 border-b border-border px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-text-faint">{decision.decisionId}</span>
            <DecisionStateBadge state={decision.state} />
          </div>
          <h3 className="mt-1 text-[15px] font-semibold leading-snug text-text">{decision.title}</h3>
        </div>
        <button
          onClick={onClose}
          title="关闭详情"
          className="grid size-6 shrink-0 place-items-center rounded text-text-faint hover:bg-surface-raised hover:text-text"
        >
          <X weight="bold" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-text-faint">
          <span>decided {decision.decidedAt ? decision.decidedAt.slice(0, 16).replace("T", " ") : "—"}</span>
          <span>proposed {decision.proposedAt ? decision.proposedAt.slice(0, 16).replace("T", " ") : "—"}</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
          <span className="font-semibold text-text-faint">Q: </span>
          {decision.question}
        </p>
        {decision.chosen.length > 0 && (
          <section className="mt-3">
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-faint">chosen</div>
            <ul className="mt-1 space-y-1">
              {decision.chosen.map((claim) => (
                <li key={claim.id} className="flex gap-1.5 text-[12px] leading-snug text-text">
                  <span className="font-mono text-[10px] text-accent">{claim.id}</span>
                  <span className="min-w-0">{claim.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {decision.rejected.length > 0 && (
          <section className="mt-3">
            <div className="font-mono text-[10px] uppercase tracking-wide text-text-faint">rejected</div>
            <ul className="mt-1 space-y-1">
              {decision.rejected.map((claim) => (
                <li key={claim.id} className="text-[12px] leading-snug text-text-muted">
                  <span className="font-mono text-[10px] text-danger">{claim.id}</span> {claim.text}
                  {claim.whyNot && (
                    <span className="mt-0.5 block text-[11px] text-text-faint">↳ {claim.whyNot}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        {onNavigateEntity && (
          <button
            onClick={() => onNavigateEntity(`decision/${decision.decisionId}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-text-muted hover:border-border-strong hover:text-text"
          >
            <ArrowSquareOut weight="bold" />
            在决策池查看
          </button>
        )}
        {onFocusGraph && (
          <button
            onClick={() => onFocusGraph(`decision/${decision.decisionId}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-text-muted hover:border-border-strong hover:text-accent"
          >
            <Graph weight="bold" />
            在关系图聚焦
          </button>
        )}
      </footer>
    </aside>
  );
}

export function GenealogyTimelineView({
  decisions,
  relations,
  focusRef,
  onNavigateEntity,
  onFocusGraph,
}: {
  decisions: DecisionRow[];
  relations: RelationEdge[];
  /** 跨视图带入的聚焦实体（decision/<id>）；用于多视图切换同一实体。 */
  focusRef?: string | null;
  onNavigateEntity?: (ref: string) => void;
  onFocusGraph?: (ref: string) => void;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, DecisionRow>();
    for (const decision of decisions) map.set(decision.decisionId, decision);
    return map;
  }, [decisions]);

  const edges = useMemo(() => buildGenealogyEdges(relations, byId), [relations, byId]);

  // 参与谱系（有任一谱系边）的 decision——左栏候选焦点集。
  const participants = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edges) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
    return [...ids]
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .sort((a, b) => (timeMsOf(b) ?? 0) - (timeMsOf(a) ?? 0));
  }, [edges, byId]);

  // 每个 decision 的谱系规模（祖先+后代数），用于默认挑一个「最有料」的焦点。
  const lineageSize = useMemo(() => {
    const size = new Map<string, number>();
    for (const decision of participants) {
      size.set(decision.decisionId, collectLineage(decision.decisionId, edges).size - 1);
    }
    return size;
  }, [participants, edges]);

  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // 跨视图带入的焦点优先；否则挑谱系最大的一个。
  useEffect(() => {
    const incoming = focusRef ? decisionIdOf(focusRef) : null;
    if (incoming && byId.has(incoming)) {
      setFocusId(incoming);
      return;
    }
    setFocusId((current) => {
      if (current && byId.has(current)) return current;
      if (participants.length === 0) return null;
      let best = participants[0].decisionId;
      let bestSize = lineageSize.get(best) ?? 0;
      for (const decision of participants) {
        const size = lineageSize.get(decision.decisionId) ?? 0;
        if (size > bestSize) {
          best = decision.decisionId;
          bestSize = size;
        }
      }
      return best;
    });
  }, [focusRef, byId, participants, lineageSize]);

  const focus = focusId ? byId.get(focusId) ?? null : null;

  // 容器宽度测量（时间轴需要具体像素宽）。
  const plotRef = useRef<HTMLDivElement | null>(null);
  const [plotWidth, setPlotWidth] = useState(900);
  useLayoutEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const update = () => setPlotWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 焦点谱系的布局。
  const layout = useMemo(() => {
    if (!focus) {
      return { nodes: [] as LaidOutNode[], width: 0, height: 0, ticks: [] as { x: number; label: string }[], minT: 0, maxT: 0 };
    }
    const depthMap = collectLineage(focus.decisionId, edges);
    const rawNodes = [...depthMap.entries()]
      .map(([id, depth]) => {
        const decision = byId.get(id);
        if (!decision) return null;
        return { id, decision, depth, timeMs: timeMsOf(decision) };
      })
      .filter((node): node is Omit<LaidOutNode, "x" | "y"> => node !== null);

    const times = rawNodes.map((node) => node.timeMs).filter((t): t is number => t !== null);
    const minT = times.length > 0 ? Math.min(...times) : 0;
    const maxT = times.length > 0 ? Math.max(...times) : 0;
    const span = maxT - minT;

    const plotW = Math.max(360, plotWidth - PAD_X * 2 - CARD_W);
    const xOfTime = (timeMs: number | null): number => {
      if (timeMs === null) return 0; // 无时间 → 贴最左，并在卡上标注
      if (span <= 0) return plotW / 2;
      return ((timeMs - minT) / span) * plotW;
    };

    // 按 depth 升序（祖先在上）分带，带内按 x 排序后贪心装道，保证零重叠。
    const depths = [...new Set(rawNodes.map((node) => node.depth))].sort((a, b) => a - b);
    const placed: LaidOutNode[] = [];
    let rowCursor = 0;
    for (const depth of depths) {
      const group = rawNodes
        .filter((node) => node.depth === depth)
        .sort((a, b) => xOfTime(a.timeMs) - xOfTime(b.timeMs));
      const laneRight: number[] = [];
      for (const node of group) {
        const nx = xOfTime(node.timeMs);
        let lane = laneRight.findIndex((right) => nx >= right + LANE_GAP);
        if (lane === -1) {
          lane = laneRight.length;
          laneRight.push(0);
        }
        laneRight[lane] = nx + CARD_W;
        placed.push({
          ...node,
          x: PAD_X + nx,
          y: AXIS_H + PAD_Y + (rowCursor + lane) * ROW_H,
        });
      }
      rowCursor += Math.max(1, laneRight.length);
    }

    const width = PAD_X * 2 + plotW + CARD_W;
    const height = AXIS_H + PAD_Y * 2 + rowCursor * ROW_H;
    const ticks = axisTicks(minT, maxT).map((tick) => ({
      x: PAD_X + xOfTime(tick.t),
      label: tick.label,
    }));
    return { nodes: placed, width, height, ticks, minT, maxT };
  }, [focus, edges, byId, plotWidth]);

  const nodeById = useMemo(() => {
    const map = new Map<string, LaidOutNode>();
    for (const node of layout.nodes) map.set(node.id, node);
    return map;
  }, [layout.nodes]);

  // 焦点谱系内的边（两端都在布局集合里）。
  const lineageEdges = useMemo(
    () => edges.filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to)),
    [edges, nodeById],
  );

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const ancestorCount = layout.nodes.filter((node) => node.depth < 0).length;
  const descendantCount = layout.nodes.filter((node) => node.depth > 0).length;

  const filteredParticipants = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return participants;
    return participants.filter(
      (decision) =>
        decision.title.toLowerCase().includes(needle) ||
        decision.decisionId.toLowerCase().includes(needle),
    );
  }, [participants, query]);

  if (edges.length === 0) {
    return (
      <div
        data-testid="genealogy-timeline-empty-state"
        className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface px-6 text-center"
      >
        <ClockCounterClockwise weight="duotone" className="text-3xl text-text-faint" />
        <div className="text-[14px] font-semibold text-text">暂无决策谱系可展示</div>
        <div className="max-w-md text-[12px] leading-relaxed text-text-faint">
          当前 ledger 里没有 refines / narrows / supersedes / supports 的 decision→decision 边。
          出现思想演化关系后，这里会按时间轴渲染其谱系。
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5">
        <h1 className="ui-title inline-flex items-center gap-1.5 font-semibold">
          <ClockCounterClockwise weight="duotone" className="text-accent" />
          决策演化史
        </h1>
        <span className="font-mono text-[12px] text-text-faint">
          {participants.length} 决策参与谱系 · {edges.length} 条演化边
        </span>
        {focus && (
          <span className="font-mono text-[11px] text-text-faint">
            焦点谱系：{ancestorCount} 祖先 · {descendantCount} 后代
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
          {(["refines", "narrows", "supersedes", "supports"] as const).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1 text-text-muted">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" y1="3" x2="18" y2="3" stroke={KIND_META[kind].color} strokeWidth="2" />
              </svg>
              {KIND_META[kind].label}
            </span>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左栏：谱系参与决策列表（选一个作焦点，主区聚焦其演化史）。 */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface/60">
          <div className="border-b border-border px-2.5 py-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1">
              <MagnifyingGlass weight="bold" className="text-text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索决策 id / 标题"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-faint"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {filteredParticipants.map((decision) => {
              const active = decision.decisionId === focusId;
              const size = lineageSize.get(decision.decisionId) ?? 0;
              return (
                <button
                  key={decision.decisionId}
                  onClick={() => {
                    setFocusId(decision.decisionId);
                    setSelectedId(null);
                  }}
                  className={`flex w-full flex-col gap-0.5 border-l-2 px-2.5 py-1.5 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent/10"
                      : "border-transparent hover:bg-surface-raised"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[10px] text-text-faint">{decision.decisionId}</span>
                    <span className="ml-auto inline-flex items-center gap-0.5 font-mono text-[10px] text-text-faint">
                      <GitBranch weight="bold" />
                      {size}
                    </span>
                  </div>
                  <span className={`truncate text-[12px] leading-snug ${active ? "text-text" : "text-text-muted"}`}>
                    {decision.title}
                  </span>
                  <span className="font-mono text-[10px] text-text-faint">{shortTime(decision)}</span>
                </button>
              );
            })}
            {filteredParticipants.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-text-faint">无匹配决策</div>
            )}
          </div>
        </div>

        {/* 主区：时间轴谱系。 */}
        <div ref={plotRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg">
          {focus && layout.nodes.length <= 1 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <div className="text-[13px] font-semibold text-text">{focus.title}</div>
              <div className="max-w-md text-[12px] leading-relaxed text-text-faint">
                该决策暂无 refines / narrows / supersedes / supports 谱系关系（孤立节点）。
                从左栏选择一个带谱系的决策查看其演化史。
              </div>
            </div>
          ) : (
            <div className="relative" style={{ width: layout.width, height: layout.height, minWidth: "100%" }}>
              {/* 时间轴刻度 + 竖向网格 */}
              <svg
                className="pointer-events-none absolute inset-0"
                width={layout.width}
                height={layout.height}
              >
                <defs>
                  {(["refines", "narrows", "supersedes", "supports"] as const).map((kind) => (
                    <marker
                      key={kind}
                      id={`gen-arrow-${kind}`}
                      viewBox="0 0 8 8"
                      refX="7"
                      refY="4"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L8,4 L0,8 z" fill={KIND_META[kind].color} />
                    </marker>
                  ))}
                </defs>
                {layout.ticks.map((tick, index) => (
                  <g key={index}>
                    <line
                      x1={tick.x}
                      y1={AXIS_H}
                      x2={tick.x}
                      y2={layout.height}
                      stroke="var(--color-border)"
                      strokeWidth="1"
                      strokeDasharray="2 4"
                    />
                    <text x={tick.x + 3} y={20} fill="var(--color-text-faint)" fontSize="10" fontFamily="var(--font-mono)">
                      {tick.label}
                    </text>
                  </g>
                ))}
                {/* 谱系边 */}
                {lineageEdges.map((edge, index) => {
                  const ancestor = nodeById.get(edge.to)!;
                  const descendant = nodeById.get(edge.from)!;
                  const ancRight = ancestor.x <= descendant.x;
                  const sx = ancRight ? ancestor.x + CARD_W : ancestor.x;
                  const sy = ancestor.y + CARD_H / 2;
                  const ex = ancRight ? descendant.x : descendant.x + CARD_W;
                  const ey = descendant.y + CARD_H / 2;
                  const dx = (ex - sx) * 0.45;
                  const incident = hoverId === edge.from || hoverId === edge.to;
                  const dim = hoverId !== null && !incident;
                  return (
                    <path
                      key={index}
                      d={`M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`}
                      fill="none"
                      stroke={KIND_META[edge.kind]?.color ?? "var(--color-border-strong)"}
                      strokeWidth={incident ? 2.2 : 1.4}
                      strokeOpacity={dim ? 0.15 : 0.85}
                      markerEnd={`url(#gen-arrow-${edge.kind})`}
                    />
                  );
                })}
              </svg>

              {/* 决策卡 */}
              {layout.nodes.map((node) => {
                const isFocus = node.depth === 0;
                const isSelected = node.id === selectedId;
                const dim = hoverId !== null && hoverId !== node.id;
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedId((prev) => (prev === node.id ? null : node.id))}
                    onMouseEnter={() => setHoverId(node.id)}
                    onMouseLeave={() => setHoverId(null)}
                    style={{ left: node.x, top: node.y, width: CARD_W, height: CARD_H }}
                    className={`absolute flex flex-col justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                      isFocus
                        ? "border-accent bg-accent/10"
                        : isSelected
                          ? "border-border-strong bg-surface-raised"
                          : "border-border bg-surface hover:border-border-strong"
                    } ${dim ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[10px] text-text-faint">{node.id}</span>
                      {isFocus && (
                        <span className="ml-auto rounded bg-accent px-1 py-px font-mono text-[9px] font-semibold text-accent-fg">
                          焦点
                        </span>
                      )}
                    </div>
                    <span className="truncate text-[12px] font-medium leading-tight text-text">{node.decision.title}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] text-text-faint">{shortTime(node.decision)}</span>
                      {node.timeMs === null && (
                        <span className="rounded bg-stale/15 px-1 font-mono text-[9px] text-stale">无时间</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selected && (
          <DecisionDetailPanel
            decision={selected}
            onClose={() => setSelectedId(null)}
            onNavigateEntity={onNavigateEntity}
            onFocusGraph={onFocusGraph}
          />
        )}
      </div>
    </div>
  );
}
