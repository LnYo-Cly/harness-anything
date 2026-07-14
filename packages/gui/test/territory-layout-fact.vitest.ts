import { describe, it, expect } from "vitest";
import { layoutTerritory } from "../src/renderer/graph/territoryLayout";
import { task, fact, rel, filters } from "./territory-layout-fixtures";

// ══ FACT 领地 ══
// fact 领地现在尊重 filters.modules(与 task/unified 对齐);测试需显式传入模块集。
describe("layoutTerritory · fact skel", () => {
  it("健康 fact 按宿主 task 模块分区", () => {
    const tasks = [
      task("t_a", { module: "gui" }),
      task("t_b", { module: "kernel" }),
    ];
    const facts = [
      fact("t_a", "F1"),
      fact("t_a", "F2"),
      fact("t_b", "F3"),
    ];
    const out = layoutTerritory({
      skel: "fact",
      tasks,
      decisions: [],
      facts,
      relations: [],
      filters: filters({ modules: new Set(["gui", "kernel"]) }),
      expandedZones: new Set(),
    });
    const zoneTitles = out.nodes
      .filter((n) => n.type === "territoryZone" && n.data?.variant === "zone")
      .map((n) => n.data.title);
    expect(zoneTitles).toContain("gui");
    expect(zoneTitles).toContain("kernel");
    // gui zone 有 2 条 fact chip
    const guiChips = out.nodes.filter(
      (n) => n.type === "territoryChip" && n.data?.entity === "fact" && n.id.includes("t_a"),
    );
    expect(guiChips.length).toBe(2);
  });

  it("失效 fact(invalidated-by)进示警区,健康 fact 进模块区", () => {
    const tasks = [task("t1", { module: "m" })];
    const facts = [
      fact("t1", "F_ok"),
      fact("t1", "F_bad"),
    ];
    const relations = [
      rel("fact/t1/F_bad", "decision/dec_X", "invalidated-by"),
    ];
    const out = layoutTerritory({
      skel: "fact",
      tasks,
      decisions: [],
      facts,
      relations,
      filters: filters({ modules: new Set(["m"]) }),
      expandedZones: new Set(),
    });
    const sections = out.nodes.filter((n) => n.type === "territoryZone" && n.data?.variant === "section");
    // 示警区(first section)
    expect(sections.length).toBeGreaterThanOrEqual(2);
    // 失效 fact chip 在示警区,健康 fact chip 在模块区
    const badChip = out.nodes.find((n) => n.type === "territoryChip" && n.id.includes("F_bad"));
    const okChip = out.nodes.find((n) => n.type === "territoryChip" && n.id.includes("F_ok"));
    expect(badChip).toBeDefined();
    expect(okChip).toBeDefined();
    // 失效 fact 应被标记 dimmed
    expect(badChip?.data?.dimmed).toBe(true);
    expect(okChip?.data?.dimmed).toBe(false);
  });

  it("未挂接 task 的 fact 进「未挂接任务」分区", () => {
    const facts = [fact("ghost", "F1")]; // host task "ghost" 不在 tasks 列表
    const out = layoutTerritory({
      skel: "fact",
      tasks: [],
      decisions: [],
      facts,
      relations: [],
      filters: filters(),
      expandedZones: new Set(),
    });
    const zones = out.nodes.filter((n) => n.type === "territoryZone" && n.data?.variant === "zone");
    // 单一 zone = 未挂接 task 区
    expect(zones.length).toBe(1);
    expect(zones[0].data.unlanded).toBe(true);
  });

  it("类型过滤:关掉 fact 后 fact 领地空", () => {
    const facts = [fact("t1", "F1")];
    const out = layoutTerritory({
      skel: "fact",
      tasks: [task("t1")],
      decisions: [],
      facts,
      relations: [],
      filters: filters({ modules: new Set(["m"]), types: new Set(["task", "decision"]) }),
      expandedZones: new Set(),
    });
    expect(out.nodes.length).toBe(0);
  });

  it("模块过滤:关掉宿主模块 → 该模块 fact 隐藏;未挂接 fact 保留", () => {
    // 与 unified ledger / task territory 对齐:有宿主按 host.module 过滤;
    // 无宿主(task 不在投影)→ 保留可见(unlanded 区)。
    const tasks = [
      task("t_gui", { module: "gui" }),
      task("t_kernel", { module: "kernel" }),
    ];
    const facts = [
      fact("t_gui", "F_gui"),
      fact("t_kernel", "F_kernel"),
      fact("ghost", "F_orphan"), // host 不在 tasks → unhosted,应保留
    ];
    const out = layoutTerritory({
      skel: "fact",
      tasks,
      decisions: [],
      facts,
      relations: [],
      filters: filters({ modules: new Set(["gui"]) }),
      expandedZones: new Set(),
    });
    const chipIds = out.nodes
      .filter((n) => n.type === "territoryChip" && n.data?.entity === "fact")
      .map((n) => n.id);
    expect(chipIds.some((id) => id.includes("F_gui"))).toBe(true);
    expect(chipIds.some((id) => id.includes("F_kernel"))).toBe(false);
    expect(chipIds.some((id) => id.includes("F_orphan"))).toBe(true);
  });

  it("告警区标题/subtitle 覆盖 LOW_CONFIDENCE(与 severity>0 桶一致)", () => {
    const tasks = [task("t1", { module: "m" })];
    const facts = [fact("t1", "F_low", { confidence: "low" })];
    const out = layoutTerritory({
      skel: "fact",
      tasks,
      decisions: [],
      facts,
      relations: [],
      filters: filters({ modules: new Set(["m"]) }),
      expandedZones: new Set(),
    });
    // 低置信 → 示警区 zone title 应点名 low confidence(en-US 默认 locale)。
    const alertZone = out.nodes.find(
      (n) => n.type === "territoryZone" && n.data?.variant === "zone" && n.id.includes("fact-alert"),
    );
    expect(alertZone).toBeDefined();
    const title = String(alertZone?.data?.title ?? "");
    expect(title.toLowerCase()).toMatch(/low confidence|低置信/);
  });

  it("fact chip 的 navRef 形如 fact/<task>/<id>(可被 enterSpotlight 消费)", () => {
    const facts = [fact("t1", "F1")];
    const out = layoutTerritory({
      skel: "fact",
      tasks: [task("t1")],
      decisions: [],
      facts,
      relations: [],
      filters: filters({ modules: new Set(["m"]) }),
      expandedZones: new Set(),
    });
    const chip = out.nodes.find((n) => n.type === "territoryChip" && n.data?.entity === "fact");
    expect(chip).toBeDefined();
    expect(chip?.data?.navRef).toMatch(/^fact\//);
  });
});
