import { describe, it, expect, beforeAll } from "vitest";
import {
  layoutCanvasEgo,
  buildEgoGraph,
  bfsShown,
  egoFocusIdOf,
  estimateCardHeight,
} from "../src/renderer/graph/canvasEgoLayout";
import type { LayoutOutput } from "../src/renderer/graph/graphLayoutTypes";
import type { TaskRow, DecisionRow, FactRef, RelationEdge } from "../src/renderer/model/types";
import type { AxisFilter, GraphFilterInput } from "../src/renderer/graph/graphLayoutTypes";

// 精简工厂:布局器只读少数字段,其余用类型断言跳过。
const task = (id: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ taskId: id, title: `T ${id}`, coordinationStatus: "active", module: "m", ...extra }) as unknown as TaskRow;
const decision = (id: string, extra: Partial<DecisionRow> = {}): DecisionRow =>
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
const fact = (taskId: string, tail: string): FactRef =>
  ({ anchor: `${taskId}/${tail}`, taskId, category: "finding", text: `obs ${tail}`, at: "2026", confidence: "high" }) as unknown as FactRef;
const rel = (from: string, to: string, kind: RelationEdge["kind"]): RelationEdge =>
  ({ from, to, kind, provenance: "local-document" }) as RelationEdge;

const ALL_AXES: AxisFilter = { authority: true, evidence: true, execution: true, assoc: true };
const filters = (over: Partial<GraphFilterInput> = {}): GraphFilterInput => ({
  modules: new Set<string>(),
  types: new Set(["task", "decision", "fact"]),
  axes: ALL_AXES,
  ...over,
});

// 场景:焦点 dec_F。上游 dec_U refines→dec_F(dec_U 更有一个 evidence fact);
// 下游 dec_F derives→task_C;task_C 有子任务 C1/C2;C1 又有孙任务 C1a(第 3 跳)。
function scene() {
  const tasks = [
    task("task_C"),
    task("task_C1", { parentTaskId: "task_C" }),
    task("task_C2", { parentTaskId: "task_C" }),
    task("task_C1a", { parentTaskId: "task_C1" }),
  ];
  const decisions = [
    decision("dec_F", { chosen: [{ id: "CH1", text: "chosen text", evidence: [], whyNot: undefined } as any] }),
    decision("dec_U"),
  ];
  const facts = [fact("task_x", "F1")];
  const relations = [
    rel("decision/dec_U", "decision/dec_F", "refines"), // 上游(focus 是 to → in → left)
    rel("decision/dec_F/CH1", "task/task_C", "derives"), // 下游(focus 是 from → out → right)
    rel("decision/dec_U/C1", "fact/task_x/F1", "evidenced-by"), // dec_U 的证据(第 2 跳上游)
  ];
  return { tasks, decisions, facts, relations };
}

const FOCUS = "decision/dec_F";

function boxesOverlap(a: any, b: any): boolean {
  const aw = a.width;
  const ah = a.height;
  const bw = b.width;
  const bh = b.height;
  return (
    a.position.x < b.position.x + bw &&
    b.position.x < a.position.x + aw &&
    a.position.y < b.position.y + bh &&
    b.position.y < a.position.y + ah
  );
}
const centerX = (n: any) => n.position.x + n.width / 2;

describe("layoutCanvasEgo", () => {
  const { tasks, decisions, facts, relations } = scene();
  const graph = buildEgoGraph(tasks, decisions, facts, relations);
  const shown = bfsShown(graph, FOCUS, 2, ALL_AXES);
  let out: LayoutOutput;
  let byId: Map<string, any>;
  beforeAll(async () => {
    out = await layoutCanvasEgo({
      focusId: FOCUS,
      tasks,
      decisions,
      facts,
      relations,
      filters: filters(),
      inLoopEdges: new Set(),
      shown,
      expanded: new Set([FOCUS]),
    });
    byId = new Map(out.nodes.map((n) => [n.id, n]));
  });

  it("合成 task 父子边(parentTaskId 不在 relations 里)", () => {
    // dec_F 的 ±2 跳:C1/C2 是 task_C 子任务;父子边应存在。
    expect(shown.has("task_C1")).toBe(true);
    expect(shown.has("task_C2")).toBe(true);
    expect(out.edges.some((e) => e.id === "e_child_task_C1")).toBe(true);
    expect(out.edges.some((e) => e.id === "e_child_task_C2")).toBe(true);
  });

  it("默认 ±2 跳铺开(第 3 跳 C1a 不在 shown)", () => {
    expect(shown.get(FOCUS)).toBe(0);
    expect(shown.get("decision/dec_U")).toBe(1);
    expect(shown.get("task_C")).toBe(1);
    expect(shown.get("task_C1")).toBe(2);
    expect(shown.has("task_C1a")).toBe(false); // 第 3 跳,默认不铺
  });

  it("焦点居中,上游→左 / 下游→右", () => {
    expect(centerX(byId.get(FOCUS))).toBeCloseTo(0, 0);
    expect(centerX(byId.get("decision/dec_U"))).toBeLessThan(0); // 上游左
    expect(centerX(byId.get("task_C"))).toBeGreaterThan(0); // 下游右
  });

  it("按跳级逐层外扩(下游第 2 跳比第 1 跳更远)", () => {
    // 下游:C1/C2(第 2 跳)在 task_C(第 1 跳)右侧更远。
    expect(centerX(byId.get("task_C1"))!).toBeGreaterThan(centerX(byId.get("task_C"))!);
    // C:ELK 按 edge direction 分层(dec_U→fact_x),fact_x 落在 dec_U 右侧而非 BFS hop 的更远上游。
    // 这里只验「相连节点不同列」—— fact_x 与 dec_U 有边,ELK 必分到不同列。
    expect(centerX(byId.get("fact/task_x/F1"))!).not.toEqual(centerX(byId.get("decision/dec_U"))!);
  });

  it("确定性布局零重叠", () => {
    const ns = out.nodes;
    for (let i = 0; i < ns.length; i += 1) {
      for (let j = i + 1; j < ns.length; j += 1) {
        expect(boxesOverlap(ns[i], ns[j])).toBe(false);
      }
    }
  });

  it("+N 徽章:C1 有未展开的孙任务", () => {
    expect(byId.get("task_C1")!.data.hiddenCount).toBeGreaterThanOrEqual(1);
  });

  it("类型筛选:关掉 fact 后 fact 节点消失,task/decision 保留", async () => {
    const out2 = await layoutCanvasEgo({
      focusId: FOCUS,
      tasks,
      decisions,
      facts,
      relations,
      filters: filters({ types: new Set(["task", "decision"]) }),
      inLoopEdges: new Set(),
      shown,
      expanded: new Set([FOCUS]),
    });
    const ids = new Set(out2.nodes.map((n) => n.id));
    expect(ids.has("fact/task_x/F1")).toBe(false);
    expect(ids.has("decision/dec_U")).toBe(true);
    expect(ids.has("task_C")).toBe(true);
  });

  it("焦点渲染为卡片(expanded),其余为 chip", () => {
    expect(byId.get(FOCUS)!.data.expanded).toBe(true);
    // D3:聚焦决策卡片宽 = CARD_W_FOCUS.decision = 380(聚焦预算大于外围)。B2:改用顶层 width。
    expect(byId.get(FOCUS)!.width).toBe(380);
    expect(byId.get("task_C")!.data.expanded).toBe(false);
    expect(byId.get("task_C")!.width).toBe(216); // CHIP_W
  });

  // C:ELK 正交路由后,edge.data.route 携带 bend points(start/end + 中间折点)。
  // InteractiveEdge 据此拼 SVG path;route 缺失时才回退 getSmoothStepPath。
  it("C · 边携带 ELK 正交路由(bend points)", () => {
    const routed = out.edges.filter((e) => Array.isArray((e.data as any)?.route));
    // 至少有一条边带路由(场景里有 5+ 条边,ELK 通常全部路由)。
    expect(routed.length).toBeGreaterThan(0);
    const sample = routed[0];
    const pts = (sample.data as any).route as Array<{ x: number; y: number }>;
    expect(pts.length).toBeGreaterThanOrEqual(2);
    // 折点都是有限数(防 NaN/Infinity 进 SVG path)。
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  // C(P0 回归):边折线必须与节点共享同一个坐标空间。InteractiveEdge 把 data.route 当
  // 绝对 SVG path 消费(绕过 RF 的 sourceX/sourceY),所以 route 的起点必须落在源节点盒
  // 的边界上、终点必须落在目标节点盒的边界上。修复前 centerOnFocus 先位移了 positions,
  // translateRoutes 再从已位移的 positions 反推 delta 得到 ≈0 → 折线留在 raw ELK 坐标,
  // 节点却是 focus-centered → 起止点漂离源/目标盒数百像素。
  it("C · ELK 路由起止点锚在源/目标节点盒上(同一坐标空间,P0 回归)", () => {
    const tol = 1.0; // 1px 浮点容差;ELK 把端点放在节点边界,distToBox 应为 0。
    const distToBox = (
      p: { x: number; y: number },
      box: { x: number; y: number; w: number; h: number },
    ): number => {
      const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.w));
      const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.h));
      return Math.hypot(dx, dy);
    };
    const routed = out.edges.filter((e) => Array.isArray((e.data as any)?.route));
    expect(routed.length).toBeGreaterThan(0);
    for (const e of routed) {
      const pts = (e.data as any).route as Array<{ x: number; y: number }>;
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      expect(src).toBeDefined();
      expect(tgt).toBeDefined();
      const srcBox = {
        x: src!.position.x,
        y: src!.position.y,
        w: src!.width as number,
        h: src!.height as number,
      };
      const tgtBox = {
        x: tgt!.position.x,
        y: tgt!.position.y,
        w: tgt!.width as number,
        h: tgt!.height as number,
      };
      // 起点落在源节点盒边界上、终点落在目标节点盒边界上(同坐标空间不变量)。
      expect(distToBox(pts[0], srcBox)).toBeLessThanOrEqual(tol);
      expect(distToBox(pts[pts.length - 1], tgtBox)).toBeLessThanOrEqual(tol);
    }
  });
});

// ══ D1:领地→聚光灯 ID 命名空间归一 ══
// 复现:territoryLayout.buildChipNode 给 task chip 发射的 navRef 是 `task/<id>` 形态,
// 而 ego 图 byId 的 task 键是裸 id(canvasEgoLayout.buildEgoGraph)。
// 修复前 useEgoCanvas.openFocus 直接把 navRef 当 focusId → bfsShown 从 task/<id> 出发,
// adj/byId 都键不上 → 焦点不在 byId → layoutCanvasEgo 丢弃 → 0 节点(空白画布)。
// 修复:导出 egoFocusIdOf 作为 ego 图入口不变量,openFocus 必须经它归一。
describe("D1 · egoFocusIdOf (territory chip → ego 焦点归一)", () => {
  it("task/<id> 归一为裸 id(territory chip navRef 形态)", () => {
    // territoryLayout.buildChipNode:m.entity === "task" ? `task/${m.id}` : m.id
    expect(egoFocusIdOf("task/task_01ABC")).toBe("task_01ABC");
  });

  it("decision/<id> 与裸 task id 原样通过(其他入口形态)", () => {
    // decision chip navRef = `decision/${id}`(已与 byId 键对齐)
    expect(egoFocusIdOf("decision/dec_X")).toBe("decision/dec_X");
    // FocusSwitcher / 双击 / 抽屉「设为焦点」传的是裸 task id
    expect(egoFocusIdOf("task_01ABC")).toBe("task_01ABC");
    // fact ref 原样通过
    expect(egoFocusIdOf("fact/task_x/F1")).toBe("fact/task_x/F1");
  });

  it("领地 task chip navRef 经 egoFocusIdOf 后喂进 ego 图 >0 节点(集成)", async () => {
    // 真实场景:task_C 有子任务 C1/C2;从领地点 task_C chip 进聚光灯。
    const { tasks, decisions, facts, relations } = scene();
    const navRef = "task/task_C"; // territoryLayout 给 task_C chip 的 navRef
    const focusId = egoFocusIdOf(navRef); // 修复后 openFocus 内部做这步
    const graph = buildEgoGraph(tasks, decisions, facts, relations);
    const shown = bfsShown(graph, focusId, 2, ALL_AXES);
    const out = await layoutCanvasEgo({
      focusId,
      tasks,
      decisions,
      facts,
      relations,
      filters: filters(),
      inLoopEdges: new Set(),
      shown,
      expanded: new Set([focusId]),
    });
    expect(out.nodes.length).toBeGreaterThan(0);
    expect(out.nodes.some((n) => n.id === "task_C")).toBe(true);
    // 焦点本身必须渲染为卡片
    const focus = out.nodes.find((n) => n.id === "task_C");
    expect(focus?.data.expanded).toBe(true);
  });

  it("阴性对照:不经归一直接用 navRef 当 focusId → 0 节点(复现 D1 bug)", async () => {
    // 这是修复前 useEgoCanvas.openFocus 的行为:直接 setFocusId(navRef)。
    const { tasks, decisions, facts, relations } = scene();
    const navRef = "task/task_C"; // 未经 egoFocusIdOf 归一
    const graph = buildEgoGraph(tasks, decisions, facts, relations);
    // byId 键为裸 task id,task/task_C 不在里面
    expect(graph.byId.has(navRef)).toBe(false);
    expect(graph.byId.has(egoFocusIdOf(navRef))).toBe(true);
    const out = await layoutCanvasEgo({
      focusId: navRef,
      tasks,
      decisions,
      facts,
      relations,
      filters: filters(),
      inLoopEdges: new Set(),
      shown: bfsShown(graph, navRef, 2, ALL_AXES),
      expanded: new Set([navRef]),
    });
    // bug:焦点不在 byId → vis 集为空 → 0 节点
    expect(out.nodes.length).toBe(0);
  });
});

// ══ D4:task 卡片高度内容感知 ══
// 修复前 estimateCardHeight 对 task 永远返回 150,长标题被截、短标题浪费空间。
describe("D4 · estimateCardHeight(task 内容感知)", () => {
  it("短标题 task 卡片高度基线", () => {
    const t = task("t_short", { title: "短标题" });
    const h = estimateCardHeight("task", t);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(260); // 合理上限
  });

  it("长标题 task 卡片比短标题高(内容感知)", () => {
    const shortT = task("t_s", { title: "short" });
    const longT = task("t_l", { title: "X".repeat(120) });
    const shortH = estimateCardHeight("task", shortT);
    const longH = estimateCardHeight("task", longT);
    // 修复前:两者都返回 150(完全相等,bug)。修复后:长标题需要更多行 → 更高。
    expect(longH).toBeGreaterThan(shortH);
  });

  it("task 卡片高度不再是无视内容的常量 150(回归)", () => {
    // 修复前:任何 task 都返回 exactly 150。修复后:基线随内容浮动。
    const t = task("t", { title: "a".repeat(80) });
    const h = estimateCardHeight("task", t);
    expect(h).not.toBe(150);
  });
});

// ══ D3/G1:聚焦 3:4 竖卡 + focus/peripheral 尺寸预算 + 内容驱动高度 ══
// D3:聚焦卡片拿到更大尺寸预算(CARD_W_FOCUS + W:H ≤ 0.75 的 3:4 竖地板 + 更高 min/cap),
// 外围展开卡片用稍松的 0.82 地板 + 560 cap 保留邻居密度。estimateCardHeight 诚实估高(去掉
// fact 的 160px 观察段硬帽),低内容 fact 按地板定高不出滚动条,只有真实内容超过 cap 才滚。
describe("D3/G1 · 聚焦 3:4 竖卡 + 内容驱动高度", () => {
  it("estimateCardHeight 对 decision 包含 rejected 段(原漏算)", () => {
    const dNoRej = decision("d1");
    const dWithRej = decision("d2", {
      rejected: [
        { id: "RJ1", text: "rejected option", evidence: [], whyNot: "reason" } as any,
      ],
    });
    const hNoRej = estimateCardHeight("decision", dNoRej);
    const hWithRej = estimateCardHeight("decision", dWithRej);
    // types.ts:145 标注 rejected 必填非空,但原公式漏算 → 现在补上。
    expect(hWithRej).toBeGreaterThan(hNoRej);
  });

  // ── 聚焦卡片:3:4 竖卡,显著大于外围预算 ──
  it("D3 · focus fact 是 3:4 竖卡(340×453),低内容无滚动条", async () => {
    const f = fact("task_x", "F1");
    const id = `fact/${f.taskId}/${f.anchor.split("/")[1] ?? f.anchor}`;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [], decisions: [], facts: [f], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    const w = node.width as number;
    const h = node.height as number;
    expect(w).toBe(340); // CARD_W_FOCUS.fact
    // 3:4 地板:round(340/0.75)=453,且 ≥ H_MIN_FOCUS.fact(420)。
    expect(h).toBeGreaterThanOrEqual(420);
    expect(w / h).toBeLessThanOrEqual(0.75 + 0.01); // 3:4 竖向
    // 低内容按地板定高、未顶到 cap → body 有足够空间,不出滚动条。
    expect(h).toBeLessThan(720);
  });

  it("D3 · focus task 是 3:4 竖卡(360×480)", async () => {
    const t = task("task_short", { title: "x" });
    const id = t.taskId;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [t], decisions: [], facts: [], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    expect(node.width).toBe(360); // CARD_W_FOCUS.task
    expect(node.height).toBeGreaterThanOrEqual(400); // H_MIN_FOCUS.task
    expect((node.width as number) / (node.height as number)).toBeLessThanOrEqual(0.75 + 0.01);
  });

  it("D3 · focus decision 是 3:4 竖卡(380×507)", async () => {
    const d = decision("dec_short");
    const id = `decision/${d.decisionId}`;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [], decisions: [d], facts: [], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    expect(node.width).toBe(380); // CARD_W_FOCUS.decision
    expect(node.height).toBeGreaterThanOrEqual(440); // H_MIN_FOCUS.decision
    expect((node.width as number) / (node.height as number)).toBeLessThanOrEqual(0.75 + 0.01);
  });

  // ── 外围展开卡片:更小预算 + 较松地板,保留邻居密度 ──
  it("D3 · peripheral expanded fact 用 CARD_W + 0.82 地板(300×366)", async () => {
    const focusTask = task("task_focus");
    const f = fact("task_focus", "P1");
    const factId = `fact/${f.taskId}/${f.anchor.split("/")[1] ?? f.anchor}`;
    const relations = [rel("task/task_focus", factId, "evidenced-by")];
    const graph = buildEgoGraph([focusTask], [], [f], relations);
    const out = await layoutCanvasEgo({
      focusId: "task_focus",
      tasks: [focusTask], decisions: [], facts: [f], relations,
      filters: filters(), inLoopEdges: new Set(),
      shown: bfsShown(graph, "task_focus", 2, ALL_AXES),
      expanded: new Set(["task_focus", factId]),
    });
    const factNode = out.nodes.find((n) => n.id === factId)!;
    expect(factNode).toBeDefined();
    expect(factNode.width).toBe(300); // CARD_W.fact(peripheral)
    expect(factNode.height).toBeGreaterThanOrEqual(340); // H_MIN_PERIPH.fact
    // 0.82 地板(比 focus 的 0.75 松),保留邻居密度。
    expect((factNode.width as number) / (factNode.height as number)).toBeLessThanOrEqual(0.82 + 0.01);
    // 焦点本身仍是更宽的 focus 预算。
    const focusNode = out.nodes.find((n) => n.id === "task_focus")!;
    expect(focusNode.width).toBeGreaterThan(factNode.width);
  });

  // ── 诚实估高:中长内容按内容定高,不出滚动条 ──
  it("D3 · focus fact 中长文本按内容定高(诚实估高 > 地板,在 cap 内不滚)", async () => {
    // 修复前:obs 段被 min(160,…) 压住 → est 268 < 地板 → 卡片停在地板,中等内容被迫滚。
    // 修复后:去掉 obs 硬帽,est 随内容上抬并超过地板 → 卡片真正长高;仍在 cap 内 → 不滚。
    const f = fact("task_mid", "M1");
    (f as any).text = "x".repeat(500);
    const id = `fact/${f.taskId}/${f.anchor.split("/")[1] ?? f.anchor}`;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [], decisions: [], facts: [f], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    const w = node.width as number;
    const h = node.height as number;
    expect(w).toBe(340);
    // 内容驱动高度应高于地板(round(340/0.75)=453),且仍在 cap 内(不滚)。
    expect(h).toBeGreaterThan(453);
    expect(h).toBeLessThanOrEqual(720);
    // estimateCardHeight 去掉 obs 硬帽后,中长文本的估高应远高于旧 268 上限。
    expect(estimateCardHeight("fact", f, 340)).toBeGreaterThan(268);
  });

  it("D3 · focus decision 三段内容(Q+chosen+rejected)在 cap 内不滚", async () => {
    const d = decision("dec_full", {
      question: "x".repeat(80),
      chosen: [
        { id: "CH1", text: "chosen strategy", evidence: [] } as any,
        { id: "CH2", text: "alt", evidence: [] } as any,
      ],
      rejected: [
        { id: "RJ1", text: "nope", evidence: [], whyNot: "why" } as any,
      ],
      claims: [{ id: "CL1", text: "claim" }],
    });
    const id = `decision/${d.decisionId}`;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [], decisions: [d], facts: [], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    expect(node.width).toBe(380);
    expect(node.height).toBeGreaterThanOrEqual(440); // H_MIN_FOCUS.decision
    expect(node.height).toBeLessThanOrEqual(720); // H_CAP_FOCUS,在 cap 内不滚
  });

  // ── 硬 cap:真实超长内容顶到 cap,body 由 overflow-y-auto 出滚动条 ──
  it("D3 · focus 超长 decision 顶到 H_CAP_FOCUS=720", async () => {
    const huge = decision("dec_huge", {
      question: "y".repeat(400),
      chosen: Array.from({ length: 10 }, (_, i) => ({
        id: `CH${i}`, text: "c", evidence: [],
      })) as any,
      rejected: Array.from({ length: 10 }, (_, i) => ({
        id: `RJ${i}`, text: "r", evidence: [], whyNot: "w",
      })) as any,
      claims: Array.from({ length: 10 }, (_, i) => ({
        id: `CL${i}`, text: "cl",
      })),
    });
    const id = `decision/${huge.decisionId}`;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [], decisions: [huge], facts: [], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    expect(node.height).toBeLessThanOrEqual(720);
    expect(node.height).toBe(720); // 估高远超 → 顶到 cap
  });

  it("D3 · peripheral 超长 decision 顶到 H_CAP_PERIPH=560", async () => {
    const focusTask = task("task_focus2");
    const huge = decision("dec_huge_p", {
      question: "y".repeat(400),
      chosen: Array.from({ length: 10 }, (_, i) => ({
        id: `CH${i}`, text: "c", evidence: [],
      })) as any,
      rejected: Array.from({ length: 10 }, (_, i) => ({
        id: `RJ${i}`, text: "r", evidence: [], whyNot: "w",
      })) as any,
      claims: Array.from({ length: 10 }, (_, i) => ({
        id: `CL${i}`, text: "cl",
      })),
    });
    const decId = `decision/${huge.decisionId}`;
    const relations = [rel(decId, "task/task_focus2", "derives")];
    const graph = buildEgoGraph([focusTask], [huge], [], relations);
    const out = await layoutCanvasEgo({
      focusId: "task_focus2",
      tasks: [focusTask], decisions: [huge], facts: [], relations,
      filters: filters(), inLoopEdges: new Set(),
      shown: bfsShown(graph, "task_focus2", 2, ALL_AXES),
      expanded: new Set(["task_focus2", decId]),
    });
    const node = out.nodes.find((n) => n.id === decId)!;
    expect(node).toBeDefined();
    expect(node.height).toBeLessThanOrEqual(560); // H_CAP_PERIPH
    expect(node.height).toBe(560); // 估高远超 → 顶到 peripheral cap
  });

  // ── override 下限夹具:防 stale localStorage / 误拖把卡片钉成细条 ──
  it("D3 · sizeOverride 过小被夹到可读下限(focus fact → 300×420)", async () => {
    const f = fact("task_ov", "O1");
    const id = `fact/${f.taskId}/${f.anchor.split("/")[1] ?? f.anchor}`;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [], decisions: [], facts: [f], relations: [],
      filters: filters(), inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
      sizeOverrides: new Map([[id, { w: 100, h: 80 }]]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    // focus fact:minW = CARD_W_FOCUS.fact - 40 = 300;minH = H_MIN_FOCUS.fact = 420。
    expect(node.width).toBe(300);
    expect(node.height).toBe(420);
  });

  // B2:NodeResizer 走 sizeOverrides 通道。override 必须原样落地为顶层 width/height,
  // 不被内容估高覆盖,且不再写 style.width(避免与 NodeResizer 的中间态打架)。
  it("B2 · sizeOverride 落地为顶层 width/height(不被内容估高覆盖)", async () => {
    const t = task("task_override", { title: "short" });
    const id = t.taskId;
    const out = await layoutCanvasEgo({
      focusId: id,
      tasks: [t],
      decisions: [],
      facts: [],
      relations: [],
      filters: filters(),
      inLoopEdges: new Set(),
      shown: new Map([[id, 0]]),
      expanded: new Set([id]),
      sizeOverrides: new Map([[id, { w: 500, h: 400 }]]),
    });
    const node = out.nodes.find((n) => n.id === id)!;
    expect(node.width).toBe(500);
    expect(node.height).toBe(400);
    // B2:不再写 style.width / style.height —— 让 NodeResizer 控盒子。
    expect(node.style?.width).toBeUndefined();
    expect(node.style?.height).toBeUndefined();
  });
});
