import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DecisionRow, RelationEdge } from "../model/types";
import {
  ENCODING_META,
  KIND_META,
  buildGenealogyEdges,
  collectLineage,
  computeLayout,
  decisionIdOf,
  findGenealogyCycles,
  timeMsOf,
} from "./genealogy/layout";
import { DecisionDetailPanel } from "./genealogy/DecisionDetailPanel";
import { GenealogyEmptyState, IsolatedNodeMessage } from "./genealogy/EmptyStates";
import { ParticipantsSidebar } from "./genealogy/ParticipantsSidebar";
import { TimelinePlot } from "./genealogy/TimelinePlot";
import { t, tp } from "../i18n/index.tsx";

/**
 * 决策谱系「演化史」面板(G3 §③ 降级为 facet)。
 *
 * 纯前端派生:从 relations 筛谱系四类边(refines/narrows/supersedes/supports),
 * 焦点上溯/下溯。布局 = DAG 拓扑(x = 谱系深度),同列内同日节点过多时自动折成簇。
 *
 * 改造点(原独立 ViewId 现降级为 EntityWorkspace 的 lineage facet):
 *   - 去掉全页 header(标题/图例栏) —— 由 EntityWorkspace 的 facet tabs 提供入口
 *   - 必填 focusRef —— 没焦点时显示空态(引导用户先在 Graph 里选 decision)
 *   - 参与者侧栏的焦点切换通过 onFocusChange 上行 —— 不再是本地状态
 *
 * task/facet 无谱系(GENEALOGY_KINDS 只认 decision↔decision),由 EntityWorkspace
 * 在 tab 层隐藏,不进入此面板。
 */
export function GenealogyTimelineView({
  decisions,
  relations,
  focusRef,
  onNavigateEntity,
  onFocusGraph,
  onFocusChange,
}: {
  decisions: DecisionRow[];
  relations: RelationEdge[];
  focusRef?: string | null;
  onNavigateEntity?: (ref: string) => void;
  onFocusGraph?: (ref: string) => void;
  /** 参与者侧栏点击焦点切换上行(写回 AppLocation.focusedEntityRef)。 */
  onFocusChange?: (ref: string) => void;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, DecisionRow>();
    for (const decision of decisions) map.set(decision.decisionId, decision);
    return map;
  }, [decisions]);

  const edges = useMemo(() => buildGenealogyEdges(relations, byId), [relations, byId]);

  const cycleWarning = useMemo(() => {
    const cycles = findGenealogyCycles(edges);
    return { count: cycles.length, cycles };
  }, [edges]);

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

  const lineageSize = useMemo(() => {
    const size = new Map<string, number>();
    for (const decision of participants) {
      size.set(decision.decisionId, collectLineage(decision.decisionId, edges).size - 1);
    }
    return size;
  }, [participants, edges]);

  // focusRef 是必填入参 —— 不再自动挑最大谱系。同步派生(G3 §③4):
  //   1. AppLocation.focusedEntityRef 变 → focusId 立即跟上,无 useEffect race
  //   2. SSR(renderToStaticMarkup)也能算 —— useEffect 在 SSR 不跑,纯派生不踩坑
  //   3. 无 ref / ref 非 decision / ref 指向不存在的 decision → null,触发空态
  const focusId = useMemo(() => {
    if (!focusRef) return null;
    const incoming = decisionIdOf(focusRef);
    return incoming && byId.has(incoming) ? incoming : null;
  }, [focusRef, byId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());

  // 换焦点时收起日簇,避免状态串台。
  useEffect(() => {
    setExpandedDays(new Set());
    setSelectedId(null);
  }, [focusId]);

  const focus = focusId ? byId.get(focusId) ?? null : null;

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

  const layout = useMemo(
    () =>
      computeLayout(focus, edges, byId, plotWidth, {
        expandedDays,
      }),
    [focus, edges, byId, plotWidth, expandedDays],
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, (typeof layout.nodes)[number]>();
    for (const node of layout.nodes) map.set(node.id, node);
    return map;
  }, [layout.nodes]);

  const lineageEdges = useMemo(
    () => edges.filter((edge) => {
      // 边端点在布局集合，或被折叠进某个可见簇。
      const covered = (id: string) =>
        nodeById.has(id) ||
        layout.nodes.some((n) => n.isCluster && n.memberIds?.includes(id));
      return covered(edge.from) && covered(edge.to);
    }),
    [edges, nodeById, layout.nodes],
  );

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const ancestorCount = layout.nodes.filter((node) => !node.isCluster && node.depth < 0).length;
  const descendantCount = layout.nodes.filter((node) => !node.isCluster && node.depth > 0).length;
  const visibleCards = layout.nodes.filter((n) => !n.isCluster).length;
  const visibleClusters = layout.nodes.filter((n) => n.isCluster).length;

  const headerStatsText = tp(edges.length, {
    one: "views.genealogyTimelineView.headerStatsOne",
    other: "views.genealogyTimelineView.headerStatsOther",
  }, {
    participants: participants.length,
  });
  const focusPedigreeText = `${t("views.genealogyTimelineView.focusPedigree")}${ancestorCount} ${t("views.genealogyTimelineView.ancestors")}${descendantCount} ${t("views.genealogyTimelineView.descendants")}${visibleClusters > 0
    ? t("views.genealogyTimelineView.visibleClustersDayClustersVisibleCardsCards", { visibleClusters: visibleClusters, visibleCards: visibleCards })
    : ""}`;

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
    return <GenealogyEmptyState />;
  }

  // G3 §③4:无 focus = 引导用户先选 decision。不再像独立视图那样自动挑最大谱系。
  if (!focus) {
    return (
      <div
        data-testid="genealogy-no-focus"
        className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-surface px-6 text-center"
      >
        <div className="text-[13px] font-semibold text-text">{t("components.entityWorkspace.lineageRequiresDecisionFocus")}</div>
        <div className="max-w-md text-[12px] leading-relaxed text-text-faint">{t("components.entityWorkspace.lineageAvailableForDecisionsOnly")}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="genealogy-timeline">
      {/* 嵌入式状态条(原全页 header 已删,facet 标签由 EntityWorkspace 提供) */}
      <div className="flex flex-col gap-0.5 border-b border-border px-4 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <span
            className="min-w-0 truncate font-mono text-[12px] tabular-nums text-text-faint"
            title={headerStatsText}
          >
            {headerStatsText}
          </span>
          {cycleWarning.count > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 font-mono text-danger"
              title={cycleWarning.cycles.map((c) => c.join(" → ")).join("\n")}
            >
              {t("views.genealogyTimelineView.cycleWarning", { count: cycleWarning.count })}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <span
            className="block truncate font-mono text-[11px] tabular-nums text-text-faint"
            title={focusPedigreeText}
          >
            {focusPedigreeText}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-border px-4 py-1.5">
        <span className="font-mono text-[11px] text-text-faint">
          {ENCODING_META.dag.label}：{ENCODING_META.dag.blurb}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
          {(["refines", "narrows", "supersedes", "supports"] as const).map((kind) => {
            const meta = KIND_META[kind];
            return (
              <span key={kind} className="inline-flex items-center gap-1 text-text-muted">
                <svg width="22" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="22"
                    y2="4"
                    stroke={meta.color}
                    strokeWidth={meta.strokeWidth}
                    strokeDasharray={meta.dash || undefined}
                  />
                </svg>
                {meta.label}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ParticipantsSidebar
          participants={filteredParticipants}
          focusId={focusId}
          lineageSize={lineageSize}
          query={query}
          onQueryChange={setQuery}
          onFocus={(id) => {
            // G3 §④1:焦点切换上行而非本地。AppLocation.focusedEntityRef 变化后,本视图
            // 经 focusRef prop 拿回新焦点(effect 同步本地 focusId)。这样 Cmd+[ 能回到
            // 上一个谱系焦点,而不是丢状态。
            if (onFocusChange) onFocusChange(`decision/${id}`);
            setSelectedId(null);
          }}
        />

        <div ref={plotRef} className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-bg">
          {focus && layout.nodes.length <= 1 && !layout.nodes[0]?.isCluster ? (
            <IsolatedNodeMessage decision={focus} />
          ) : (
            <TimelinePlot
              layout={layout}
              nodeById={nodeById}
              lineageEdges={lineageEdges}
              selectedId={selectedId}
              expandedDays={expandedDays}
              onToggleSelect={(id) =>
                setSelectedId((prev) => (prev === id ? null : id))
              }
              onToggleCluster={(dayKey) => {
                setExpandedDays((prev) => {
                  const next = new Set(prev);
                  if (next.has(dayKey)) next.delete(dayKey);
                  else next.add(dayKey);
                  return next;
                });
              }}
            />
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
