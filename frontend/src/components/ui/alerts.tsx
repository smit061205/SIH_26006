import { useT } from "../../lib/i18n";
import { useState } from "react";
import type { AlertThresholds } from "../../api";
import { type AlertGroup, alertSentence, groupAlerts, type Severity } from "../../lib/alerts";
import { DEFAULT_THRESHOLDS, setThresholds, useThresholds } from "../../lib/alertSettings";
import type { Alert } from "../../types";
import { Button, Segmented } from "./inputs";
import { Popover } from "./overlay";

const SEVERITY: Record<Severity, { label: string; color: string }> = {
  high: { label: "Act", color: "var(--color-negative)" },
  medium: { label: "Watch", color: "var(--color-caution)" },
  info: { label: "Note", color: "var(--color-ink-3)" },
};

/** Coloured dot plus the word, so severity never relies on colour alone. */
export function SeverityTag({ severity, className = "" }: { severity: Severity; className?: string }) {
  const t = useT();
  const s = SEVERITY[severity];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold ${className}`} style={{ color: s.color }}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.color }} />
      {t(s.label)}
    </span>
  );
}

function GroupRow({ group, expanded }: { group: AlertGroup; expanded: boolean }) {
  const t = useT();
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline gap-2">
        <SeverityTag severity={group.severity} />
        <span className="text-[14.5px] font-semibold text-ink">{group.title}</span>
      </div>
      {expanded && group.items.length > 1 ? (
        <ul className="mt-1 space-y-1">
          {group.items.map((a) => (
            <li key={a.id} className="text-[13.5px] leading-snug text-ink-2">
              <span className="font-semibold text-ink">{t(a.port ?? a.vessel_class ?? "")}</span>: {alertSentence(a, t)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{group.detail}</p>
      )}
    </li>
  );
}

/**
 * Alerts grouped by type, one line each, worst first. Shows `limit` groups;
 * "Show all" expands every group and lists each port or vessel type.
 */
export function AlertList({
  alerts,
  empty,
  limit = 3,
  forceExpanded = false,
}: {
  alerts: Alert[];
  empty: string;
  limit?: number;
  forceExpanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const expanded = open || forceExpanded;
  const groups = groupAlerts(alerts, t);
  if (groups.length === 0) return <p className="text-[14.5px] text-ink-2">{empty}</p>;
  const hidden = groups.length > limit || groups.some((g) => g.items.length > 1);
  const shown = expanded ? groups : groups.slice(0, limit);
  return (
    <div>
      <ul className="divide-y divide-rule">
        {shown.map((g) => (
          <GroupRow key={g.key} group={g} expanded={expanded} />
        ))}
      </ul>
      {hidden && !forceExpanded && (
        <Button variant="text" className="mt-2 print:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? t("Show less") : alerts.length === 1 ? t("Show 1 alert") : t("Show all {n} alerts", { n: alerts.length })}
        </Button>
      )}
    </div>
  );
}

const PRESETS: { key: keyof AlertThresholds; label: string; unit: string; options: number[] }[] = [
  { key: "wave_m", label: "Rough sea from", unit: "m waves", options: [2, 2.5, 3, 3.5] },
  { key: "wait_days", label: "Long wait from", unit: "days", options: [3, 4, 5, 7] },
  { key: "activity_pct", label: "Busy port from", unit: "% above normal", options: [20, 30, 50] },
  { key: "band_pct", label: "Uncertain rates from", unit: "% range", options: [30, 40, 50, 60] },
  { key: "move_pct", label: "Big rate move from", unit: "% change", options: [5, 10, 15, 20] },
];

/** Thresholds as a few sensible presets, in a popover beside the alerts' title. */
export function AlertSettings({
  include = PRESETS.map((p) => p.key),
  value,
  onChange,
}: {
  include?: (keyof AlertThresholds)[];
  /** Controlled mode (the component kit's sandbox): these thresholds instead of the viewer's saved ones. */
  value?: AlertThresholds;
  onChange?: (t: AlertThresholds) => void;
}) {
  const saved = useThresholds();
  const t = value ?? saved;
  const set = onChange ?? setThresholds;
  const reset = () => set(DEFAULT_THRESHOLDS);
  const tr = useT();
  const presets = PRESETS.filter((p) => include.includes(p.key));
  const changed = presets.some((p) => t[p.key] !== DEFAULT_THRESHOLDS[p.key]);
  return (
    <Popover
      title="Alert settings"
      trigger={
        <Button variant="text" className="text-[13.5px] print:hidden" aria-label={tr(changed ? "Alert settings, changed" : "Alert settings")}>
          {changed ? "Settings (changed)" : "Settings"}
        </Button>
      }
    >
      <div className="space-y-3">
        {presets.map((p) => (
          <div key={p.key}>
            <div className="mb-1 text-[13px] text-ink-2">
              {tr(p.label)} <span className="text-ink-3">({tr(p.unit)})</span>
            </div>
            <Segmented
              label={`${tr(p.label)}, ${tr(p.unit)}`}
              value={String(t[p.key])}
              onChange={(v) => set({ ...t, [p.key]: Number(v) })}
              options={p.options.map((o) => ({ value: String(o), label: String(o) }))}
            />
          </div>
        ))}
        {changed && (
          <Button variant="text" onClick={reset}>
            Reset to defaults
          </Button>
        )}
      </div>
    </Popover>
  );
}
