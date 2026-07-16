import type { ReactNode } from "react";
import { ArrowsClockwise, CircleNotch, HardDrives, WarningCircle } from "@phosphor-icons/react";
import { BTN, Section, Row } from "../../components/ui/widgets";
import { useDaemonStatusQuery } from "../../model/daemon-status-query.ts";
import type { DaemonStatusModel } from "../../model/daemon-status.ts";
import { t } from "../../i18n/index.tsx";
import { DaemonRepoTable } from "./DaemonRepoTable.tsx";

function formatUptime(status: DaemonStatusModel): string {
  if (typeof status.uptimeMs === "number" && Number.isFinite(status.uptimeMs)) {
    return formatDurationMs(status.uptimeMs);
  }
  if (typeof status.startedAt === "string" && status.startedAt.length > 0) {
    const started = Date.parse(status.startedAt);
    if (Number.isFinite(started)) {
      return formatDurationMs(Date.now() - started);
    }
  }
  return t("views.settingsView.systemUnknownDash");
}

function formatDurationMs(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return t("views.settingsView.systemUnknownDash");
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3_600);
  const minutes = Math.floor((totalSec % 3_600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function ReachabilityBadge({ started }: { started: boolean }) {
  if (started) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[13px] font-semibold text-success">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
        {t("views.settingsView.systemRunning")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-danger/15 px-2.5 py-1 text-[13px] font-semibold text-danger">
      <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
      {t("views.settingsView.systemStopped")}
    </span>
  );
}

function MonoValue({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="max-w-full break-all font-mono text-[12px] text-text-muted" title={title}>
      {children}
    </span>
  );
}

function DaemonStatusCard({ status }: { status: DaemonStatusModel }) {
  const lockLabel = status.lock.path ?? t("views.settingsView.systemUnlocked");
  const connectionsLabel = `${status.connections.active} / ${status.connections.total}`;

  return (
    <Section
      title={t("views.settingsView.systemDaemonStatus")}
      action={<ReachabilityBadge started={status.started} />}
    >
      <Row label={t("views.settingsView.systemVersion")}>
        <MonoValue>{status.version || "—"}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemProtocolVersion")}>
        <MonoValue>{String(status.protocolVersion)}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemPid")}>
        <MonoValue>{status.pid || "—"}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemEndpoint")}>
        <MonoValue>{status.endpoint || "—"}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemDaemonId")}>
        <MonoValue>{status.daemonId || "—"}</MonoValue>
      </Row>
      <Row
        label={t("views.settingsView.systemUptime")}
        desc={t("views.settingsView.systemUptimeHint")}
      >
        <MonoValue>{formatUptime(status)}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemQueueDepth")}>
        <MonoValue>{status.queueDepth}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemConnections")}>
        <MonoValue>{connectionsLabel}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemLock")}>
        <MonoValue title={status.lock.path ?? undefined}>{lockLabel}</MonoValue>
      </Row>
      <Row label={t("views.settingsView.systemRootDir")}>
        <MonoValue title={status.rootDir}>{status.rootDir || "—"}</MonoValue>
      </Row>
    </Section>
  );
}

function ControlsRow({
  onRefresh,
  isRefreshing,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className={BTN}
      >
        <span className="inline-flex items-center gap-1">
          <ArrowsClockwise
            weight="bold"
            className={`text-[12px] ${isRefreshing ? "animate-spin" : ""}`}
          />
          {t("views.settingsView.systemRefresh")}
        </span>
      </button>
      <button
        type="button"
        disabled
        title={t("views.settingsView.systemRestartPending")}
        className={BTN}
      >
        {t("views.settingsView.systemRestart")}
      </button>
    </div>
  );
}

export function SystemStatusPanel() {
  const query = useDaemonStatusQuery();

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-8 text-[13px] text-text-muted">
          <CircleNotch weight="bold" className="animate-spin" />
          {t("views.settingsView.systemLoading")}
        </div>
      </div>
    );
  }

  if (query.isError) {
    const message =
      (query.error as Error | undefined)?.message ??
      t("views.settingsView.systemUnreachableReason");
    return (
      <div className="flex flex-col gap-3">
        <ControlsRow onRefresh={() => void query.refetch()} isRefreshing={query.isFetching} />
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface py-12 text-center">
          <WarningCircle weight="duotone" className="text-2xl text-danger" />
          <p className="text-[13px] text-text">{t("views.settingsView.systemUnreachable")}</p>
          <p className="max-w-md font-mono text-[11px] text-text-faint">{message}</p>
        </div>
      </div>
    );
  }

  const status = query.data;
  if (!status) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface py-12 text-center">
        <HardDrives weight="duotone" className="text-2xl text-text-faint" />
        <p className="text-[13px] text-text-muted">{t("views.settingsView.systemNoData")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ControlsRow onRefresh={() => void query.refetch()} isRefreshing={query.isFetching} />
      <DaemonStatusCard status={status} />
      <Section title={t("views.settingsView.systemRepos")}>
        <DaemonRepoTable status={status} />
      </Section>
    </div>
  );
}
