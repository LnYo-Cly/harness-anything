import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  DecisionRow,
  RelationEdge,
} from "../src/renderer/model/types.ts";
import { GenealogyTimelineView } from "../src/renderer/views/GenealogyTimelineView.tsx";
import {
  buildGenealogyEdges,
  computeLayout,
  findGenealogyCycles,
} from "../src/renderer/views/genealogy/layout.ts";

/**
 * 谱系 timeline 视图的组件级测试。验证:
 *  1. 无谱系边时优雅降级出 empty-state(dec_01KXA7811SVVT8P66HNDFZQ7DF 原则 6 多视图)。
 *  2. 筛选严格:只认 refines/narrows/supersedes/supports 且两端皆 decision。
 *     用真实账本里观察到的边形态验证(dec_md ↔ dec_mr* 的 refines/narrows 链)。
 *  3. claim 锚正确剥离:`decision/dec_x/C1` 归一成 `dec_x` 参与谱系。
 *
 * 真实账本(2026-07-12 .harness/generated/triadic-graph)统计:
 *  refines 77 + narrows 24 + supersedes 7 + supports 2 = 110 条 decision↔decision 边。
 *  「genealogy empty」是数据环境(daemon 未连),不是筛选逻辑 bug——此测试为凭证。
 */

function baseDecision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    decisionId: "dec_default",
    title: "默认决策",
    state: "active",
    question: "Q?",
    chosen: [],
    rejected: [],
    claims: [],
    ...overrides,
  };
}

function edge(
  from: string,
  to: string,
  kind: RelationEdge["kind"],
  extra: Partial<RelationEdge> = {},
): RelationEdge {
  return { from, to, kind, provenance: "local-document", ...extra };
}

describe("GenealogyTimelineView empty-state", () => {
  it("renders the dedicated empty state when there are no relations at all", () => {
    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, {
        decisions: [baseDecision()],
        relations: [],
      }),
    );

    expect(markup).toContain("genealogy-timeline-empty-state");
    expect(markup).toContain("暂无决策谱系可展示");
  });

  it("still shows the empty state when only non-genealogy edges exist (derives/evidenced-by/depends-on)", () => {
    // 这些都是真实账本里大量存在但**不属于**思想演化谱系的边——必须被筛掉。
    const relations: RelationEdge[] = [
      edge("decision/dec_a", "task/task_1", "derives"),
      edge("decision/dec_a/CH1", "fact/task_1/F-001", "evidenced-by"),
      edge("task/task_2", "task/task_1", "depends-on"),
      edge("decision/dec_a", "decision/dec_b", "relates"),
    ];

    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, {
        decisions: [baseDecision({ decisionId: "dec_a" }), baseDecision({ decisionId: "dec_b" })],
        relations,
      }),
    );

    expect(markup).toContain("genealogy-timeline-empty-state");
  });

  it("ignores genealogy edges that touch a non-decision endpoint", () => {
    // refines/narrows/supports 只在 decision↔decision 时算谱系;
    // task→task 或 fact→decision 即便用同样 kind 也不算。
    const relations: RelationEdge[] = [
      edge("task/task_a", "task/task_b", "refines"),
      edge("fact/task_a/F-001", "decision/dec_a", "supports"),
    ];

    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, {
        decisions: [baseDecision({ decisionId: "dec_a" })],
        relations,
      }),
    );

    expect(markup).toContain("genealogy-timeline-empty-state");
  });
});

describe("GenealogyTimelineView filter correctness", () => {
  it("lists decisions joined by refines/narrows as focus candidates", () => {
    // 复刻真实账本形态:dec_01KXA7... narrows dec_mrcaa7tp(源自 dec_01KXA7811SVVT8P66HNDFZQ7DF)。
    const decisions: DecisionRow[] = [
      baseDecision({
        decisionId: "dec_mrcaa7tp",
        title: "GUI 控制面 = 可遍历三元语图",
        proposedAt: "2026-06-01T00:00:00.000Z",
        decidedAt: "2026-06-05T00:00:00.000Z",
      }),
      baseDecision({
        decisionId: "dec_01KXA7811SVVT8P66HNDFZQ7DF",
        title: "聚焦式 ego + claim 一等 + 语义轴 + coverage + 多视图",
        proposedAt: "2026-07-12T03:00:00.000Z",
        decidedAt: "2026-07-12T03:30:00.000Z",
      }),
    ];
    const relations: RelationEdge[] = [
      // 带_claim_锚:source 锚到 CH1,target 为裸 decision(真实账本格式)。
      edge(
        "decision/dec_01KXA7811SVVT8P66HNDFZQ7DF/C1",
        "decision/dec_mrcaa7tp",
        "narrows",
        { rationale: "收窄为具体显示范式" },
      ),
    ];

    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, { decisions, relations }),
    );

    // header 统计:2 决策参与,1 演化边
    expect(markup).toContain("2 决策参与谱系");
    expect(markup).toContain("1 条演化边");
    // 左栏 participant 列表里两个 decision 都出现
    expect(markup).toContain("dec_mrcaa7tp");
    expect(markup).toContain("dec_01KXA7811SVVT8P66HNDFZQ7DF");
    expect(markup).toContain("GUI 控制面 = 可遍历三元语图");
    // 不该出现 empty-state
    expect(markup).not.toContain("genealogy-timeline-empty-state");
  });

  it("counts all four genealogy kinds and dedupes identical from|to|kind triples", () => {
    const decisions: DecisionRow[] = ["dec_a", "dec_b", "dec_c", "dec_d"].map((id) =>
      baseDecision({ decisionId: id, title: id }),
    );
    const relations: RelationEdge[] = [
      edge("decision/dec_b", "decision/dec_a", "refines"),
      edge("decision/dec_c", "decision/dec_a", "narrows"),
      edge("decision/dec_d", "decision/dec_a", "supersedes"),
      edge("decision/dec_a", "decision/dec_b", "supports"),
      // 重复同一条 refines(可能来自不同 source claim)应去重
      edge("decision/dec_b/CH1", "decision/dec_a", "refines"),
      edge("decision/dec_b/CH2", "decision/dec_a", "refines"),
    ];

    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, { decisions, relations }),
    );

    // 4 个唯一 from|to|kind 组合(b/d/c supersedes + a supports b 都各算一条;
    // dec_b refines dec_a 多个 claim 锚去重为一条)。
    expect(markup).toContain("4 条演化边");
    expect(markup).toContain("4 决策参与谱系");
  });
});

describe("Genealogy cycle warning (修 #11)", () => {
  it("findGenealogyCycles 检测 A→B→A 的 refines 环", () => {
    const decisions: DecisionRow[] = ["dec_a", "dec_b"].map((id) =>
      baseDecision({ decisionId: id }),
    );
    const relations: RelationEdge[] = [
      edge("decision/dec_a", "decision/dec_b", "refines"),
      edge("decision/dec_b", "decision/dec_a", "refines"),
    ];
    const edges = buildGenealogyEdges(
      relations,
      new Map(decisions.map((d) => [d.decisionId, d])),
    );
    const cycles = findGenealogyCycles(edges);
    expect(cycles.length).toBeGreaterThan(0);
    // 至少一条环把 dec_a / dec_b 都卷进去
    const involved = new Set(cycles.flat());
    expect(involved.has("dec_a")).toBe(true);
    expect(involved.has("dec_b")).toBe(true);
  });

  it("computeLayout 把 cycle 警告透出,TimelineLayout.cycleWarning 非空", () => {
    const decisions: DecisionRow[] = ["dec_a", "dec_b"].map((id) =>
      baseDecision({ decisionId: id, title: id }),
    );
    const relations: RelationEdge[] = [
      edge("decision/dec_a", "decision/dec_b", "refines"),
      edge("decision/dec_b", "decision/dec_a", "refines"),
    ];
    const byId = new Map(decisions.map((d) => [d.decisionId, d]));
    const edges = buildGenealogyEdges(relations, byId);
    const layout = computeLayout(decisions[0], edges, byId, 900);
    expect(layout.cycleWarning.count).toBeGreaterThan(0);
    expect(layout.cycleWarning.cycles.length).toBe(layout.cycleWarning.count);
  });
});

describe("Genealogy encoding modes (非线 x 轴)", () => {
  function chainFixture() {
    // 同日 3 点 + 隔日 1 点，复现成簇；线性轴会把 3 点叠成柱。
    const decisions: DecisionRow[] = [
      baseDecision({
        decisionId: "dec_old",
        title: "祖先决策标题足够长不应被截成一截省略号",
        decidedAt: "2026-07-03T10:00:00.000Z",
      }),
      baseDecision({
        decisionId: "dec_mid_a",
        title: "同日细化 A",
        decidedAt: "2026-07-03T12:00:00.000Z",
      }),
      baseDecision({
        decisionId: "dec_mid_b",
        title: "同日细化 B",
        decidedAt: "2026-07-03T14:00:00.000Z",
      }),
      baseDecision({
        decisionId: "dec_new",
        title: "隔日收窄",
        decidedAt: "2026-07-09T09:00:00.000Z",
      }),
    ];
    const relations: RelationEdge[] = [
      edge("decision/dec_mid_a", "decision/dec_old", "refines"),
      edge("decision/dec_mid_b", "decision/dec_old", "refines"),
      edge("decision/dec_new", "decision/dec_mid_a", "narrows"),
    ];
    const byId = new Map(decisions.map((d) => [d.decisionId, d]));
    const edges = buildGenealogyEdges(relations, byId);
    // 焦点放根祖先，BFS 才能把 mid_a/mid_b/new 全收进谱系。
    return { decisions, byId, edges, focus: decisions[0]! };
  }

  it("ordinal：按事件序拉开，空白日不占宽（07-04..08 不出现空刻度）", () => {
    const { byId, edges, focus } = chainFixture();
    const layout = computeLayout(focus, edges, byId, 900, { encoding: "ordinal" });
    expect(layout.encoding).toBe("ordinal");
    expect(layout.nodes).toHaveLength(4);
    // 序数轴上 x 应单调随时间
    const ordered = [...layout.nodes].sort(
      (a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0),
    );
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!.x).toBeGreaterThanOrEqual(ordered[i - 1]!.x);
    }
    // 刻度只在有事件的日
    const labels = layout.ticks.map((t) => t.label);
    expect(labels.some((l) => l.includes("07-03") || l === "07-03")).toBe(true);
    expect(labels.every((l) => !l.includes("07-05"))).toBe(true);
  });

  it("day-cluster：同日折叠，展开后恢复成员卡", () => {
    const { byId, edges, focus } = chainFixture();
    const collapsed = computeLayout(focus, edges, byId, 900, {
      encoding: "day-cluster",
      expandedDays: new Set(),
    });
    expect(collapsed.encoding).toBe("day-cluster");
    const clusters = collapsed.nodes.filter((n) => n.isCluster);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const july3 = clusters.find((c) => c.dayKey === "2026-07-03");
    expect(july3?.clusterSize).toBe(3);

    const expanded = computeLayout(focus, edges, byId, 900, {
      encoding: "day-cluster",
      expandedDays: new Set(["2026-07-03"]),
    });
    expect(expanded.nodes.every((n) => !n.isCluster)).toBe(true);
    expect(expanded.nodes).toHaveLength(4);
  });

  it("dag：祖先在左、后代在右（rank = depth 平移）", () => {
    const { byId, edges, focus } = chainFixture();
    const layout = computeLayout(focus, edges, byId, 900, { encoding: "dag" });
    expect(layout.encoding).toBe("dag");
    const old = layout.nodes.find((n) => n.id === "dec_old")!;
    const mid = layout.nodes.find((n) => n.id === "dec_mid_a")!;
    const neu = layout.nodes.find((n) => n.id === "dec_new")!;
    expect(old.x).toBeLessThan(mid.x);
    expect(mid.x).toBeLessThanOrEqual(neu.x);
  });

  it("视图 header 渲染三种编码 tab", () => {
    const { decisions } = chainFixture();
    const relations: RelationEdge[] = [
      edge("decision/dec_mid_a", "decision/dec_old", "refines"),
      edge("decision/dec_mid_b", "decision/dec_old", "refines"),
      edge("decision/dec_new", "decision/dec_mid_a", "narrows"),
    ];
    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, { decisions, relations }),
    );
    expect(markup).toContain('data-encoding-tab="ordinal"');
    expect(markup).toContain('data-encoding-tab="day-cluster"');
    expect(markup).toContain('data-encoding-tab="dag"');
    expect(markup).toContain("序数轴");
  });
  it("渲染时 header 显示「谱系环警告 · N」(SSR 快照)", () => {
    const decisions: DecisionRow[] = ["dec_a", "dec_b"].map((id) =>
      baseDecision({ decisionId: id, title: id }),
    );
    const relations: RelationEdge[] = [
      edge("decision/dec_a", "decision/dec_b", "refines"),
      edge("decision/dec_b", "decision/dec_a", "refines"),
    ];
    const markup = renderToStaticMarkup(
      createElement(GenealogyTimelineView, { decisions, relations }),
    );
    expect(markup).toContain("谱系环警告");
  });
});
