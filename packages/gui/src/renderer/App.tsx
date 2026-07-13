import { useEffect, useMemo, useState } from "react";
import type { SnapshotStatus } from "./model/types.ts";
import { MOCK_EVENTS } from "./model/mock.ts";
import { ThemeProvider } from "./theme.tsx";
import { TaskPreviewDrawer } from "./components/TaskPreviewDrawer.tsx";
import { MockViewBanner } from "./components/shell-chrome.tsx";
import { AppSidebar } from "./components/AppSidebar.tsx";
import { ViewSwitch } from "./components/ViewSwitch.tsx";
import {
  DEFAULT_TASK_FILTERS,
  applyTaskFilters,
  type TaskFilters,
} from "./model/taskFilters.ts";
import type { LaneGroupBy } from "./views/SwimlaneBoard.tsx";
import { adaptProjectionRows, buildRealProject } from "./task-adapter.ts";
import { useTasksQuery, useSetTaskStatusMutation } from "./task-data.ts";
import { useTriadicProjectionQuery } from "./triadic-data.ts";
import { useFavorites } from "./model/favorites.ts";
import { MOCK_BACKED_VIEWS, type ViewId } from "./shell-config.tsx";

function AppShell() {
  const [view, setView] = useState<ViewId>("overview");
  const tasksQuery = useTasksQuery();
  const triadicQuery = useTriadicProjectionQuery();
  const realTasks = useMemo(
    () => adaptProjectionRows(tasksQuery.data?.tasks ?? []),
    [tasksQuery.data],
  );
  const [tasks, setTasks] = useState<import("./model/types.ts").TaskRow[]>([]);
  // 台账投影是权威真数据源;查询刷新时重播到本地态(拖拽等乐观更新为原型内交互)。
  useEffect(() => {
    setTasks(realTasks);
  }, [realTasks]);

  const project = useMemo(() => buildRealProject(realTasks), [realTasks]);
  const projectId = project.id;
  const projects = useMemo(() => [project], [project]);
  const { favorites, toggleFavorite } = useFavorites(projectId);

  const decisions = triadicQuery.decisions;
  const facts = triadicQuery.facts;
  const relations = triadicQuery.relations;
  const coverageRows = triadicQuery.coverageRows;
  const factAnchors = triadicQuery.factAnchors;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [focusedEntityRef, setFocusedEntityRef] = useState<string | null>(null);
  const [taskFilters, setTaskFilters] =
    useState<TaskFilters>(DEFAULT_TASK_FILTERS);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [drill, setDrill] = useState<{
    lane: string;
    status: SnapshotStatus;
    groupBy: LaneGroupBy;
  } | null>(null);

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId),
    [tasks, projectId],
  );
  const projectEvents = useMemo(
    () => MOCK_EVENTS.filter((e) => e.projectId === projectId),
    [projectId],
  );

  const activeCount = projectTasks.filter(
    (t) => t.coordinationStatus === "active" || t.coordinationStatus === "blocked" || t.coordinationStatus === "in_review",
  ).length;

  const selected = useMemo(
    () => tasks.find((t) => t.taskId === selectedId) ?? null,
    [tasks, selectedId],
  );
  const previewTask = useMemo(
    () => tasks.find((t) => t.taskId === previewId) ?? null,
    [previewId, tasks],
  );
  const filteredProjectTasks = useMemo(
    () => applyTaskFilters(projectTasks, taskFilters, favorites),
    [projectTasks, taskFilters, favorites],
  );

  // 决策批准角标:proposed 决策数(唯一面向人的"待人处理"计数)
  const inboxCount = decisions.filter((d) => d.state === "proposed").length;

  // 状态写真桥:乐观更新本地态 + setTaskStatus 持久化(查询刷新时被权威投影覆盖)。
  const statusMutation = useSetTaskStatusMutation();
  const updateTask = (taskId: string, patch: Partial<import("./model/types.ts").TaskRow>) => {
    setTasks((prev) =>
      prev.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t)),
    );
    if (patch.coordinationStatus && patch.coordinationStatus !== "unknown") {
      statusMutation.mutate({ taskId, status: patch.coordinationStatus });
    }
  };

  const goto = (v: ViewId) => {
    setView(v);
    setFocusedEntityRef(null);
    setSelectedId(null);
    setPreviewId(null);
    if (v !== "board") setDrill(null);
  };

  const openProject = () => {
    setTaskFilters(DEFAULT_TASK_FILTERS);
    setProjectSwitcherOpen(false);
    goto("overview");
  };

  const drillToBoard = (
    lane: string,
    status: SnapshotStatus,
    dimension: "root" | "module",
  ) => {
    // 特殊占位 __all__ 表示不锁定 lane(只 drill 到状态维度)
    const groupBy: LaneGroupBy = dimension === "root" ? "root" : "module";
    setDrill({ lane, status, groupBy });
    setView("board");
    setSelectedId(null);
    setPreviewId(null);
  };

  const openTaskPreview = (id: string) => {
    setSelectedId(null);
    setPreviewId(id);
  };

  const openTaskDetail = (id: string) => {
    setFocusedEntityRef(`task/${id}`);
    setPreviewId(null);
    setSelectedId(id);
  };

  // W2B 活链接:跨实体跳转(task→详情, decision→决策池, fact→事实分诊)
  const navigateToEntity = (ref: string) => {
    if (ref.startsWith("task/")) {
      const id = ref.slice(5).split("/")[0];
      openTaskDetail(id);
    } else if (ref.startsWith("decision/")) {
      const decisionId = ref.split("/")[1];
      setFocusedEntityRef(`decision/${decisionId}`);
      setView("decisionPool");
      setSelectedId(null);
      setPreviewId(null);
    } else if (ref.startsWith("fact/")) {
      setFocusedEntityRef(ref);
      setView("factTriage");
      setSelectedId(null);
      setPreviewId(null);
    }
  };
  const navigateToDecision = (decisionId: string) =>
    navigateToEntity(`decision/${decisionId}`);
  const navigateToTask = (taskId: string) => openTaskDetail(taskId);
  const focusEntityInGraph = (ref: string) => {
    setFocusedEntityRef(ref);
    setView("graph");
    setSelectedId(null);
    setPreviewId(null);
  };

  const showMockBanner = !selected && MOCK_BACKED_VIEWS.has(view);

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <AppSidebar
        view={view}
        selected={selected}
        tasksQuery={tasksQuery}
        projectTasks={projectTasks}
        activeCount={activeCount}
        project={project}
        projects={projects}
        projectId={projectId}
        tasks={tasks}
        projectSwitcherOpen={projectSwitcherOpen}
        onProjectSwitcherToggle={() => setProjectSwitcherOpen((open) => !open)}
        onManageAll={() => {
          setProjectSwitcherOpen(false);
          goto("home");
        }}
        openProject={openProject}
        goto={goto}
        inboxCount={inboxCount}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {showMockBanner && <MockViewBanner />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ViewSwitch
              view={view}
              selected={selected}
              filteredProjectTasks={filteredProjectTasks}
              taskFilters={taskFilters}
              drill={drill}
              focusedEntityRef={focusedEntityRef}
              project={project}
              projectTasks={projectTasks}
              tasks={tasks}
              triadic={{ decisions, facts, relations, coverageRows, factAnchors }}
              favorites={favorites}
              events={MOCK_EVENTS}
              projectName={project.name}
              goto={goto}
              onMultiViewSwitch={setView}
              onOpenTaskPreview={openTaskPreview}
              onDrillToBoard={drillToBoard}
              onUpdateTask={updateTask}
              onSelectTask={setSelectedId}
              onClearSelection={() => setSelectedId(null)}
              onNavigateEntity={navigateToEntity}
              onNavigateDecision={navigateToDecision}
              onNavigateTask={navigateToTask}
              onFocusEntityInGraph={focusEntityInGraph}
              onFiltersChange={setTaskFilters}
              onToggleFavorite={toggleFavorite}
              onOpenProject={openProject}
            />
          </div>
        </div>
      </main>
      <TaskPreviewDrawer
        task={previewTask}
        tasks={projectTasks}
        relations={relations}
        events={projectEvents}
        onClose={() => setPreviewId(null)}
        onOpenDetail={openTaskDetail}
        onPreviewTask={openTaskPreview}
      />
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
