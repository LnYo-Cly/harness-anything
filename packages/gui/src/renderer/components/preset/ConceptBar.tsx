import { ArrowRight } from "@phosphor-icons/react";
import { flowSteps } from "./shared";
import { t } from "../../i18n/index.tsx";

export function ConceptBar() {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {flowSteps().map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRight className="text-[11px] text-text-faint" />}
            <span className="rounded border border-border bg-surface-raised px-1.5 py-px font-mono text-[10px] text-text-muted">
              {step}
            </span>
          </span>
        ))}
        <span className="ml-1 text-[10px] text-text-faint">{t("components.conceptBar.materializedFlow")}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className="truncate text-[11px] text-text-muted"
          title={t("components.conceptBar.verticalSaysWhichOneUseDecisionMaking")}
        >
          {t("components.conceptBar.verticalSaysWhichOneUseDecisionMaking")}
        </span>
        <span
          className="truncate text-[10px] text-text-faint"
          title={t("components.conceptBar.statusMappingBelongsEngineNotPage")}
        >
          {t("components.conceptBar.statusMappingBelongsEngineNotPage")}
        </span>
      </div>
    </div>
  );
}
