import type { VerticalInfo, TemplateInfo } from "../../model/types";
import {
  CHIP,
  SECTION_LABEL,
  TEMPLATE_HEADER_GRID,
  VERSION_TAIL,
  VERTICAL_HEADER_GRID,
  shortRef,
} from "./shared";
import { LocaleBadges } from "./LocaleBadges";
import { t } from "../../i18n/index.tsx";

export function VerticalCard({ v }: { v: VerticalInfo }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className={VERTICAL_HEADER_GRID}>
        <span className="min-w-0 truncate font-mono text-[13px] font-semibold">
          {v.title}
        </span>
        <span className="min-w-0 truncate text-[11px] text-text-muted">{v.id}</span>
        <span className={VERSION_TAIL}>v{v.version}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={SECTION_LABEL}>
          {t("components.verticalAndTemplateCards.entityKinds")}
        </span>
        {v.entityKinds.map((k) => (
          <span
            key={k.id}
            className={CHIP}
            title={`${k.kind}${k.contractEntity ? t("components.verticalAndTemplateCards.loadBearing") : ""}`}
          >
            {k.id}
            <span className="ml-1 text-text-faint">
              ·{k.kind}
              {k.contractEntity
                ? t("components.verticalAndTemplateCards.loadBearing2")
                : ""}
            </span>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {v.templateSlots.map((slot) => (
          <span key={slot} className={CHIP}>
            {slot}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-text-faint">
        {t(
          "components.verticalAndTemplateCards.verticalDoesNotDefineStatusMappingAddingVertical",
        )}
      </p>
    </div>
  );
}

export function TemplateCard({
  t: template,
  onJumpToPreset,
}: {
  t: TemplateInfo;
  onJumpToPreset: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className={TEMPLATE_HEADER_GRID}>
        <span
          className="min-w-0 truncate font-mono text-[12px] font-semibold"
          title={template.ref}
        >
          {shortRef(template.ref)}
        </span>
        <span className={`min-w-0 truncate ${CHIP}`}>{template.documentKind}</span>
        <LocaleBadges locales={template.locales} warnMissingZh />
        <span className={VERSION_TAIL}>v{template.version}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={SECTION_LABEL}>
          {t("components.verticalAndTemplateCards.usedBy")}
        </span>
        {template.usedByPresetIds.map((id) => (
          <button
            key={id}
            onClick={() => onJumpToPreset(id)}
            className={`${CHIP} hover:bg-surface-raised hover:text-text`}
          >
            {id}
          </button>
        ))}
        {template.usedByPresetIds.length === 0 && (
          <span className="text-[11px] text-text-faint">
            {t(
              "components.verticalAndTemplateCards.notDirectlySelectedByCurrentlyParsedPreset",
            )}
          </span>
        )}
      </div>
    </div>
  );
}
