import type { TaskRow } from "../model/types";
import { factRefOf } from "./graphLayoutShared";
import { computeFactTriageSignals, type FactTriageItem } from "../model/fact-triage";
import { t as translate } from "../i18n/core.ts";
import { daysAgo, type Member, type Zone, type Section, type PartitionInput } from "./territoryPartition.ts";

/**
 * fact 领地:按宿主 task 的模块分区,失效/孤儿/被替代/低置信的 fact 单独收拢进「需关注」示警区。
 *
 * 复用 fact-triage.ts 的分诊信号(INVALIDATED/ORPHAN/SUPERSEDED/LOW_CONFIDENCE)判定
 * 示警区成员;健康 fact 按模块聚合,与 task 领地的 module zone 同构(便于用户横向对照)。
 *
 * 模块过滤策略(与 unified ledger 对齐):
 *   - 有宿主 task → 宿主 module 在 filters.modules 中才可见;
 *   - 无宿主(task 不在投影)→ 保留可见(与 unlanded 区一致,避免无主 fact 被模块误删)。
 *
 * 从 territoryPartition.ts 抽出(fact 簇 ~115 行),使各分区文件保持在文件复杂度门以内;
 * 共享类型 / daysAgo 仍由 territoryPartition.ts 权威导出,此处单向依赖、无环。
 */
export function partitionFactTerritory(input: PartitionInput): Section[] {
  const { facts, tasks, relations, filters, coverageRows, factAnchors } = input;
  const taskById = new Map<string, TaskRow>(tasks.map((t) => [t.taskId, t] as [string, TaskRow]));
  // 类型 + 宿主模块双门;无宿主 fact 不过模块门(见上 JSDoc)。
  const visible = facts.filter((f) => {
    if (!filters.types.has("fact")) return false;
    const host = taskById.get(f.taskId);
    return host ? filters.modules.has(host.module) : true;
  });

  // 分诊信号(复用 fact-triage 的权威判定)
  const triaged: FactTriageItem[] = visible.map((f) =>
    computeFactTriageSignals(
      f,
      relations,
      coverageRows ?? [],
      factAnchors ?? [],
    ),
  );

  // 告警 fact(有任意信号,severity > 0)
  const alertItems = triaged.filter((it) => it.severity > 0);
  const healthyItems = triaged.filter((it) => it.severity === 0);

  const sections: Section[] = [];

  // 示警区:first section — 失效/被替代/孤儿的 fact 单列一块(用户首要关注)
  if (alertItems.length > 0) {
    sections.push({
      id: "fact-alerts",
      title: translate("graph.territoryPartition.evidenceRequiresAttention"),
      subtitle: translate("graph.territoryPartition.countFactsNeedAttention", { count: alertItems.length }),
      zones: [buildFactZone("fact-alert", translate("graph.territoryPartition.invalidatedOrphanSuperseded"), alertItems, taskById, true)],
    });
  }

  // 健康事实:按宿主 task 的模块聚合
  const unhostedLabel = translate("graph.territoryPartition.unhostedTask");
  const byModule = new Map<string, FactTriageItem[]>();
  for (const it of healthyItems) {
    const host = taskById.get(it.fact.taskId);
    const mod = host?.module ?? unhostedLabel;
    const list = byModule.get(mod);
    if (list) list.push(it);
    else byModule.set(mod, [it]);
  }

  const moduleZones: Zone[] = [];
  for (const [mod, items] of byModule) {
    // 未挂接 task 的 fact → 标 unlanded(示警:宿主 task 不在投影里)。
    moduleZones.push(buildFactZone(`fact-mod:${mod}`, mod, items, taskById, false, mod === unhostedLabel));
  }
  moduleZones.sort((a, b) => b.total - a.total);

  if (moduleZones.length > 0) {
    sections.push({
      id: "fact-by-module",
      title: translate("graph.territoryPartition.evidenceByModule"),
      subtitle: translate("graph.territoryPartition.valueItems", { value: moduleZones.reduce((s, z) => s + z.total, 0) }),
      zones: moduleZones,
    });
  }
  return sections;
}

function buildFactZone(
  id: string,
  title: string,
  items: FactTriageItem[],
  taskById: Map<string, TaskRow>,
  isAlert: boolean,
  unlanded = false,
): Zone {
  const sorted = [...items].sort((a, b) => factScore(b) - factScore(a));
  const members: Member[] = sorted.map((it) => {
    const nodeId = factRefOf(it.fact);
    return {
      id: nodeId,
      entity: "fact" as const,
      row: it.fact,
      label: it.fact.text?.slice(0, 60) ?? it.fact.anchor,
      dimmed: Boolean(it.fact.invalidated) || it.signals.some((s) => s.kind === "INVALIDATED" || s.kind === "SUPERSEDED"),
      hiddenCount: it.citingDecisionIds.length,
      factSignals: it.signals.map((s) => s.kind),
    };
  });

  // fact 计数:失效/孤儿/被替代/低置信 各算一档,供 zone header 展示
  const stateCounts: Record<string, number> = {};
  for (const it of items) {
    for (const sig of it.signals) {
      stateCounts[sig.kind] = (stateCounts[sig.kind] ?? 0) + 1;
    }
  }
  void taskById;

  return {
    id,
    title,
    axis: "evidence",
    virtual: false,
    unlanded: isAlert || unlanded,
    skel: "fact",
    stateCounts: Object.keys(stateCounts).length > 0 ? stateCounts : undefined,
    total: members.length,
    members,
  };
}

/** fact 重要性:有信号(severity)的优先;同类按近期性。 */
function factScore(it: FactTriageItem): number {
  if (it.severity > 0) return 1000 + it.severity;
  const da = daysAgo(it.fact.at);
  return da < 3 ? 24 : da < 7 ? 14 : da < 30 ? 6 : 0;
}
