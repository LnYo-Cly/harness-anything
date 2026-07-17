import { useState } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { AXIS_COLOR_VAR, type SemanticAxis } from "../constants";
import {
  shouldAnimateEdge,
  visualForKind,
  type FlowAnimMode,
  type RelationVisual,
} from "../relationVisual";
import type { RelationKind } from "../../model/types";

/**
 * 关系图通用边(dec_01KXA7811SVVT8P66HNDFZQ7DF CH4 + 流动动画 dogfood)。
 *
 * 颜色按 axis;线型/线宽/端点按 relationVisual 词表。
 * 流动:CSS stroke-dashoffset 慢速低对比;默认仅 focus(选中/悬停/邻接)开,
 * 由 data.flowMode 控制(off/focus/all)。
 *
 * C:当 data.route 存在(canvasEgoLayout 通过 ELK 算出的正交折线)时,直接消费 bend points
 * 拼路径,绕过 RF 的 getSmoothStepPath。
 */

interface RoutedPoint {
  x: number;
  y: number;
}

interface EdgeData {
  route?: RoutedPoint[];
  axis?: SemanticAxis;
  kind?: RelationKind;
  visual?: RelationVisual;
  flowMode?: FlowAnimMode;
  /** 是否邻接焦点/选中节点(由 GraphView displayEdges 写入)。 */
  adjacent?: boolean;
}

function buildRoutedPath(points: ReadonlyArray<RoutedPoint>): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

export function InteractiveEdge({
  id,
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
  const edgeData = (data as EdgeData | undefined) ?? {};
  const route = edgeData.route;
  const edgePath =
    route && route.length >= 2
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

  const axis = edgeData.axis ?? "authority";
  const axisColor = AXIS_COLOR_VAR[axis];
  const kind = edgeData.kind;
  const visual =
    edgeData.visual ?? (kind ? visualForKind(kind) : visualForKind("relates"));
  const flowMode: FlowAnimMode = edgeData.flowMode ?? "focus";
  const adjacent = edgeData.adjacent === true;

  const [hovered, setHovered] = useState(false);
  const animate = shouldAnimateEdge(flowMode, {
    selected: Boolean(selected),
    hovered,
    adjacent,
  });

  const stroke =
    selected || hovered
      ? "var(--color-accent)"
      : (style.stroke as string | undefined) ?? axisColor;
  const baseWidth =
    (style.strokeWidth as number | undefined) ?? visual.strokeWidth;
  const strokeWidth = selected || hovered ? Math.max(baseWidth, 3) : baseWidth;
  const dasharray =
    (style.strokeDasharray as string | undefined) ?? visual.dasharray;

  // diamond 端点:自定义 marker;其余沿用 RF markerEnd。
  const markerId = visual.marker === "diamond" ? `rel-diamond-${id}` : null;
  const resolvedMarkerEnd = markerId
    ? `url(#${markerId})`
    : markerEnd;

  return (
    <>
      {markerId && (
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M5,1 L9,5 L5,9 L1,5 Z" fill={stroke} />
          </marker>
        </defs>
      )}
      <BaseEdge
        path={edgePath}
        markerEnd={resolvedMarkerEnd}
        style={{
          ...style,
          strokeWidth,
          stroke,
          strokeDasharray: dasharray,
        }}
        className={`ha-rel-edge${animate ? " ha-rel-edge--flow" : ""}`}
      />
      {/* 流动层:独立虚线,慢速 dash offset;仅 animate 时挂 class,避免数百边同开。 */}
      {animate && (
        <path
          d={edgePath}
          fill="none"
          stroke={stroke}
          strokeWidth={Math.max(strokeWidth - 0.4, 1)}
          strokeDasharray="4 10"
          strokeLinecap="round"
          className="ha-rel-edge-flow pointer-events-none"
          opacity={0.55}
        />
      )}
      {/* Invisible thick path for hovering and clicking */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
        className="cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
    </>
  );
}
