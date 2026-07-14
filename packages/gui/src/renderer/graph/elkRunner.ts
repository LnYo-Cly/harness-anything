/**
 * ELK 边路由器(C — `org.eclipse.elk.edgeRouting: ORTHOGONAL`)。
 *
 * 用 `elkjs/lib/elk.bundled.js`(纯主线程,无 worker)以避开 Electron renderer /
 * vitest jsdom 里 web worker 的各种不可控。 bundled 版 同步执行(异步 Promise 只是把
 * 同步结果包了一层),ego 图规模(典型 < 30 节点)耗时可忽略。
 *
 * 策略:`elk.algorithm: layered` + `elk.direction: RIGHT` —— ELK 自己排层,
 * 祖先左 / 后代右,focus 因既有入边又有出边而自然落在中段。我们随后把焦点节点平移到
 * 原点,使「焦点居中」的语义保留。边由 ELK 正交路由,bend points 直接喂给 InteractiveEdge。
 *
 * 输入是 ego 图可见节点(含 B 算出的尺寸)+ 关系边;输出是节点位置 + 每条边的折线。
 * 失败时返 undefined,上层降级到 getSmoothStepPath。
 */
import ELK from "elkjs/lib/elk.bundled.js";
import type {
  ElkNode,
  ElkExtendedEdge,
  ElkPoint,
  ElkEdgeSection,
} from "elkjs/lib/elk-api";

export interface ElkNodeInput {
  id: string;
  width: number;
  height: number;
}
export interface ElkEdgeInput {
  id: string;
  sources: string[];
  targets: string[];
}

export interface RoutedEdge {
  /** 与 RF Edge.id 对齐,便于按 id 查路由。 */
  id: string;
  /** 像素坐标的折线(含起止点);空 = 退到 getSmoothStepPath)。 */
  points: Array<{ x: number; y: number }>;
}

export interface ElkLayoutResult {
  /** node id → {x,y}(左上角,像素)。 */
  positions: Map<string, { x: number; y: number }>;
  /** edge id → 折线路由。 */
  routes: Map<string, RoutedEdge>;
}

const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  // 列间距与原 GAP_X(72)对齐,同行节点间距与 GAP_Y(36)对齐,使转换后视觉接近原布局。
  "elk.layered.spacing.nodeNodeBetweenLayers": "72",
  "elk.layered.spacing.baseValue": "36",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.thoroughness": "8",
  // 固定种子保确定性 —— 原 canvasEgoLayout 是确定性的,ELK 也必须如此。
  "elk.randomSeed": "1",
  // bendPoints 总是输出 —— InteractiveEdge 直接消费,无需 sections 二次解析。
  "elk.layered.unnecessaryBendpoints": "true",
};

function sectionToPoints(section: ElkEdgeSection): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [
    { x: section.startPoint.x, y: section.startPoint.y },
  ];
  for (const bp of section.bendPoints ?? []) pts.push({ x: bp.x, y: bp.y });
  pts.push({ x: section.endPoint.x, y: section.endPoint.y });
  return pts;
}

/**
 * 跑一次 ELK Layered。失败时返 undefined;调用方据此降级。
 *
 * 注意 ELK 的 (0,0) 是画布左上内边距处,不是焦点位置。我们后续会平移让焦点居中。
 */
export async function runElkLayout(
  nodes: ReadonlyArray<ElkNodeInput>,
  edges: ReadonlyArray<ElkEdgeInput>,
): Promise<ElkLayoutResult | undefined> {
  if (nodes.length === 0) {
    return { positions: new Map(), routes: new Map() };
  }
  try {
    const elk = new ELK();
    const graph: ElkNode = {
      id: "root",
      layoutOptions: ELK_OPTIONS,
      children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      edges: edges.map((e) => ({
        id: e.id,
        sources: e.sources,
        targets: e.targets,
      })) as ElkExtendedEdge[],
    };
    const result = await elk.layout(graph);
    const positions = new Map<string, { x: number; y: number }>();
    for (const c of result.children ?? []) {
      if (typeof c.x === "number" && typeof c.y === "number") {
        positions.set(c.id, { x: c.x, y: c.y });
      }
    }
    const routes = new Map<string, RoutedEdge>();
    for (const e of result.edges ?? []) {
      const pts: Array<{ x: number; y: number }> = [];
      for (const section of (e as ElkExtendedEdge).sections ?? []) {
        pts.push(...sectionToPoints(section));
      }
      if (pts.length >= 2) routes.set(e.id, { id: e.id, points: pts });
    }
    return { positions, routes };
  } catch (err) {
    // ELK 异常不应让画布崩。调用方降级到 smoothstep;console.warn 保留诊断。
    console.warn("ELK layout failed, falling back to smoothstep edges", err);
    return undefined;
  }
}

/** 把 ELK 的内部坐标平移,使 focus 节点的中心位于 (0,0)。 */
export function centerOnFocus(
  positions: Map<string, { x: number; y: number }>,
  focusId: string,
  dims: ReadonlyMap<string, { width: number; height: number }>,
): void {
  const focusPos = positions.get(focusId);
  const focusDim = dims.get(focusId);
  if (!focusPos || !focusDim) return;
  const cx = focusPos.x + focusDim.width / 2;
  const cy = focusPos.y + focusDim.height / 2;
  for (const [, p] of positions) {
    p.x -= cx;
    p.y -= cy;
  }
}

/** 把同一位移应用到边的折线。 */
export function translateRoutes(
  routes: Map<string, RoutedEdge>,
  dims: ReadonlyMap<string, { width: number; height: number }>,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  focusId: string,
): void {
  const focusPos = positions.get(focusId);
  const focusDim = dims.get(focusId);
  if (!focusPos || !focusDim) return;
  const dx = -(focusPos.x + focusDim.width / 2);
  const dy = -(focusPos.y + focusDim.height / 2);
  if (dx === 0 && dy === 0) return;
  for (const [, route] of routes) {
    for (const p of route.points) {
      p.x += dx;
      p.y += dy;
    }
  }
}

/** 让 TypeScript 满意:导出类型以防 lint 报未用。 */
export type { ElkPoint };
