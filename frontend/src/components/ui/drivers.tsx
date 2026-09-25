import { useT } from "../../lib/i18n";
import { MiniLine } from "../charts/MiniLine";
import { useMoney } from "../../lib/currency";
import { driverValue } from "../../lib/drivers";
import { longDate, pct } from "../../lib/format";
import type { DriverSeries } from "../../types";

function Change({ value, label }: { value: number | null; label: string }) {
  const t = useT();
  if (value === null) return null;
  return (
    <span className="text-[13px] text-ink-3">
      <span className={Math.abs(value) < 1 ? "text-ink-2" : value > 0 ? "text-negative" : "text-positive"}>{pct(value, 1, true)}</span> {t(label)}
    </span>
  );
}

/** Coal, oil and the rupee: latest value, recent change and a two-year line. */
export function DriverCards({ drivers }: { drivers: DriverSeries[] }) {
  const money = useMoney();
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {drivers.map((d) => (
        <div key={d.key} className="rounded-[var(--radius-surface)] border border-rule bg-surface p-4">
          <div className="text-[13px] font-semibold text-ink-3">{t(d.label)}</div>
          <div className="mt-1 text-[20px] font-semibold text-ink tabular-nums">{driverValue(d, money)}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3">
            <Change value={d.change_3m_pct} label="3 mo" />
            <Change value={d.change_12m_pct} label="1 yr" />
          </div>
          <div className="mt-3">
            <MiniLine values={d.history.map((h) => h.value)} label={`${d.label}, last two years`} />
          </div>
          <div className="mt-1 text-[12.5px] text-ink-3">
            {t(d.frequency === "monthly" ? "Monthly average, latest {date}" : "Weekly average, latest {date}", { date: longDate(d.latest.date) })}
          </div>
        </div>
      ))}
    </div>
  );
}
