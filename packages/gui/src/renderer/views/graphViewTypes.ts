import { TaskNode } from "../graph/nodes/TaskNode";
import { DecisionNode } from "../graph/nodes/DecisionNode";
import { DecisionFocusNode } from "../graph/nodes/DecisionFocusNode";
import { FactNode } from "../graph/nodes/FactNode";
import { EgoNode } from "../graph/nodes/EgoNode";
import { ModuleGroupNode } from "../graph/nodes/ModuleGroupNode";
import { LaneBackgroundNode } from "../graph/nodes/LaneBackgroundNode";
import { TerritoryZoneNode } from "../graph/nodes/TerritoryZoneNode";
import { TerritoryChipNode } from "../graph/nodes/TerritoryChipNode";
import { InteractiveEdge } from "../graph/edges/InteractiveEdge";

export const graphNodeTypes = {
  task: TaskNode,
  decision: DecisionNode,
  decisionFocus: DecisionFocusNode,
  fact: FactNode,
  ego: EgoNode,
  moduleGroup: ModuleGroupNode,
  laneBackground: LaneBackgroundNode,
  territoryZone: TerritoryZoneNode,
  territoryChip: TerritoryChipNode,
};

export const graphEdgeTypes = {
  interactive: InteractiveEdge,
};

export const MINIMAP_AXIS: Record<string, string> = {
  task: "var(--color-axis-execution)",
  decision: "var(--color-axis-authority)",
  fact: "var(--color-axis-evidence)",
};

/** relates (assoc) 默认关 — dec_01KXA7811SVVT8P66HNDFZQ7DF CH4。 */
export function defaultAxes() {
  return { authority: true, evidence: true, execution: true, assoc: false };
}
