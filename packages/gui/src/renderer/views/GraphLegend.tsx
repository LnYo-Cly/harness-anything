import { t } from "../i18n/index.tsx";
import {
  AXIS_COLOR_VAR,
  KIND_LABEL,
} from "../graph/constants";
import {
  legendSampleKinds,
  visualForKind,
} from "../graph/relationVisual";

/**
 * GraphView 顶部图例 + 状态栏(dec_01KXA7811SVVT8P66HNDFZQ7DF)。
 *
 * 从 GraphView.tsx 抽出来,让 GraphView 主文件回到 600 行内的复杂度门。
 * 纯展示 + 把交互提示话术随焦点状态切换。
 * 关系类型视觉词表样例行:色(轴)+线型,与 relationVisual 一致。
 */

interface Props {
  visibleNodeCount: number;
  edgeCount: number;
  resolvedFocusId: string | null;
  cycleWarning: { count: number; cycles: string[][] };
  hasFocus: boolean;
}

export function GraphLegend({
  visibleNodeCount,
  edgeCount,
  resolvedFocusId,
  cycleWarning,
  hasFocus,
}: Props) {
  const hint = hasFocus
    ? t("views.graphLegend.escClickBlankSpaceCloseDrawerSingle")
    : t("views.graphLegend.defaultFocusedEgoSearchLeftColumnDouble");

  return (
    <header className="flex flex-col gap-1 border-b border-border px-4 py-2 text-[11px] text-text-muted">
      {/* Row A: counts + shape/coverage chips */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-text-faint">
          {visibleNodeCount} {t("views.graphLegend.node")}{edgeCount} {t("views.graphLegend.side")}{resolvedFocusId ? t("views.graphLegend.focusResolvedFocusId", { resolvedFocusId: resolvedFocusId }) : ""}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm border"
            style={{
              borderColor: "var(--color-axis-execution)",
              background: "var(--color-surface-raised)",
            }}
          />
          {t("views.graphLegend.taskBlockDerivative")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded border" style={{ borderColor: "var(--color-accent)", background: "rgba(176,124,240,0.2)" }} />
          {t("views.graphLegend.decisionDiamondClaimClaim")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ borderColor: "var(--color-axis-evidence)", background: "rgba(240,162,60,0.2)" }} />
          {t("views.graphLegend.factCircleEvidenceBadge")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-text-faint">{t("views.graphLegend.coverage")}</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--color-status-done)" }} /> {t("views.graphLegend.corroborated")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--color-danger)" }} /> {t("views.graphLegend.noEvidence")}
          </span>
        </span>
        {cycleWarning.count > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 font-mono text-danger"
            title={cycleWarning.cycles.map((c) => c.join(" → ")).join("\n")}
          >
            {t("views.graphLegend.inv3RingWarning")}{cycleWarning.count}
          </span>
        )}
      </div>
      {/* Row B: relation visual vocabulary samples (color + dash) */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-text-faint">{t("views.graphLegend.relations")}</span>
        {legendSampleKinds().map(({ kind, axis }) => {
          const visual = visualForKind(kind);
          const color = AXIS_COLOR_VAR[axis];
          return (
            <span key={kind} className="inline-flex items-center gap-1" title={kind}>
              <svg width="22" height="8" aria-hidden className="shrink-0">
                <line
                  x1="1"
                  y1="4"
                  x2="21"
                  y2="4"
                  stroke={color}
                  strokeWidth={visual.strokeWidth}
                  strokeDasharray={visual.dasharray}
                  strokeLinecap="round"
                />
              </svg>
              <span className="font-mono text-[10px] text-text-muted">
                {KIND_LABEL[kind] ?? kind}
              </span>
            </span>
          );
        })}
      </div>
      {/* Row C: muted single-line interaction hint */}
      <div className="min-w-0">
        <span className="block truncate text-text-faint" title={hint}>
          {hint}
        </span>
      </div>
    </header>
  );
}
