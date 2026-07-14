import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { AXIS_COLOR_VAR, type SemanticAxis } from "../constants";

/**
 * 关系图通用边(dec_01KXA7811SVVT8P66HNDFZQ7DF CH4)。
 *
 * 颜色按 axis (authority / evidence / execution / assoc) 区分;
 * 轴配色由 graphLayout.buildEdge 写入 style.stroke,本组件保留 hover 高亮。
 *
 * C:当 data.route 存在(canvasEgoLayout 通过 ELK 算出的正交折线)时,直接消费 bend points
 * 拼路径,绕过 RF 的 getSmoothStepPath —— 这样用 ELK 的避障路由而不是手揉的 2-bend 平滑步阶。
 * route 缺失(simpleEgo / threeLane / ELK 失败的降级)时回退到 smoothstep。
 */
interface RoutedPoint {
  x: number;
  y: number;
}

function buildRoutedPath(points: ReadonlyArray<RoutedPoint>): string {
  if (points.length === 0) return "";
  // ELK 给的已经是正交折线;直接 L 串起来,起点 M。无圆角 —— ELK 的几何已经决定了拐角,
  // 加 arc 会让 bend point 偏离 ELK 的避障计算。
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

export function InteractiveEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const route = (data as { route?: RoutedPoint[] } | undefined)?.route;
  // 有路由用路由,否则回退 smoothstep(legacy / ELK 降级 / 其他布局器)。
  const edgePath = route && route.length >= 2
    ? buildRoutedPath(route)
    : getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 12,
      })[0];

  const axis = (data as { axis?: SemanticAxis } | undefined)?.axis ?? "authority";
  const axisColor = AXIS_COLOR_VAR[axis];

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 3.5 : (style.strokeWidth as number | undefined) ?? 1.6,
          stroke: selected ? "var(--color-accent)" : (style.stroke as string | undefined) ?? axisColor,
        }}
        className="transition-all duration-200 ease-in-out"
      />
      {/* Invisible thick path for hovering and clicking */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
        className="cursor-pointer"
        onMouseEnter={(e) => {
          const el = e.currentTarget.previousElementSibling as SVGPathElement | null;
          if (el && !selected) {
            el.style.stroke = "var(--color-accent)";
            el.style.strokeWidth = "3";
          }
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget.previousElementSibling as SVGPathElement | null;
          if (el && !selected) {
            el.style.stroke = (style.stroke as string | undefined) ?? axisColor;
            el.style.strokeWidth = String((style.strokeWidth as number | undefined) ?? 1.6);
          }
        }}
      />
    </>
  );
}
