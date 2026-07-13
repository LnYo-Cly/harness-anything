import type { TaskFilters } from "../model/taskFilters.ts";
import type { SnapshotStatus } from "../model/types.ts";
import type { LaneGroupBy } from "../views/SwimlaneBoard.tsx";
import type { ViewId } from "../shell-config.tsx";

/**
 * AppShell 级全局导航历史(泛化自 graph/focusHistory.ts)。
 *
 * focusHistory 只记一个 node id,活在 GraphView 里,离开图就销毁。本模块把
 * 「历史条目」从 node id 泛化成完整的应用位置快照(AppLocation)——涵盖构成
 * 「我在哪」的全部六个状态(view / selectedId / previewId / focusedEntityRef /
 * taskFilters / drill),让后退/前进能跨视图还原用户的位置。
 *
 * 语义与 focusHistory 完全一致:
 *   - push 截断 forward 栈(经典浏览器语义):从历史中间换位置后,旧 future 作废。
 *   - 重复推相同位置视为 no-op,避免把栈灌满。
 *   - patchCurrent 原地更新当前位置(不推栈)——用于过滤器微调、抽屉开关等
 *     非导航性变更,不单独占一个历史条目,但快照里保留最新值。
 *
 * 纯函数 + 显式 state,刻意不挂 React,以便 vitest 直接覆盖。
 */

export interface DrillState {
  lane: string;
  status: SnapshotStatus;
  groupBy: LaneGroupBy;
}

export interface AppLocation {
  view: ViewId;
  selectedId: string | null;
  previewId: string | null;
  focusedEntityRef: string | null;
  taskFilters: TaskFilters;
  drill: DrillState | null;
}

export interface NavigationHistoryState {
  /** 完整足迹;back 从 [0,index-1] 取,forward 从 [index+,index]。 */
  entries: AppLocation[];
  /** 当前位置在 entries 中的下标。 */
  index: number;
}

export function createNavigationHistory(initial: AppLocation): NavigationHistoryState {
  return { entries: [initial], index: 0 };
}

export function currentLocation(state: NavigationHistoryState): AppLocation {
  return state.entries[state.index];
}

export function canGoBack(state: NavigationHistoryState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavigationHistoryState): boolean {
  return state.index < state.entries.length - 1;
}

/** 结构化比较两个应用位置是否等价(taskFilters / drill 含嵌套结构,走 JSON 序列化)。 */
export function locationsEqual(a: AppLocation, b: AppLocation): boolean {
  return (
    a.view === b.view &&
    a.selectedId === b.selectedId &&
    a.previewId === b.previewId &&
    a.focusedEntityRef === b.focusedEntityRef &&
    JSON.stringify(a.taskFilters) === JSON.stringify(b.taskFilters) &&
    JSON.stringify(a.drill) === JSON.stringify(b.drill)
  );
}

/**
 * 推一个新位置。与当前位置相同则 no-op(防误灌栈)。截断 forward 栈:
 * 从历史中间换位置后,旧 future 作废。
 */
export function pushLocation(
  state: NavigationHistoryState,
  next: AppLocation,
): NavigationHistoryState {
  if (locationsEqual(currentLocation(state), next)) return state;
  const nextIndex = state.index + 1;
  const truncated = state.entries.slice(0, nextIndex);
  truncated.push(next);
  return { entries: truncated, index: nextIndex };
}

/**
 * 原地更新当前位置(不推栈)。用于过滤器微调等非导航性变更——
 * 用户「调了一下筛选」不该单独占一个历史条目,但下次导航的快照里应带上最新值。
 */
export function patchCurrent(
  state: NavigationHistoryState,
  patch: Partial<AppLocation>,
): NavigationHistoryState {
  const current = currentLocation(state);
  const updated: AppLocation = { ...current, ...patch };
  if (locationsEqual(current, updated)) return state;
  const entries = state.entries.slice();
  entries[state.index] = updated;
  return { entries, index: state.index };
}

export function goBack(state: NavigationHistoryState): NavigationHistoryState {
  if (!canGoBack(state)) return state;
  return { ...state, index: state.index - 1 };
}

export function goForward(state: NavigationHistoryState): NavigationHistoryState {
  if (!canGoForward(state)) return state;
  return { ...state, index: state.index + 1 };
}
