import type { CSSProperties } from "react";
import type { ScheduleMonth } from "../../types";
import { monthLong, monthShort } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { planNote } from "../../lib/labels";
import { Tooltip } from "../ui/overlay";

/** One cell per contract month: the port used and the number of voyages. */
export function ScheduleStrip({ months }: { months: ScheduleMonth[] }) {
  const tr = useT();
  const voyages = (n: number) => (n === 1 ? tr("1 voyage") : tr("{n} voyages", { n }));
  // As many columns as months (up to six), so a short contract leaves no empty cells.
  const style = { "--cols": Math.min(6, months.length), "--cols-sm": Math.min(3, months.length) } as CSSProperties;
  return (
    <ol
      style={style}
      className="grid grid-cols-[repeat(var(--cols-sm),minmax(0,1fr))] gap-px overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-rule sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
    >
      {months.map((m, i) => {
        const changed = i > 0 && m.port && months[i - 1].port && m.port !== months[i - 1].port;
        return (
          <li key={`${m.month}-${i}`} className="bg-surface">
            <Tooltip
              content={
                m.port ? (
                  <>
                    <span className="font-semibold text-ink">
                      {monthLong(m.month)}: {tr(m.port)}
                    </span>
                    , {tr("{voyages} of {cls}", { voyages: voyages(m.n_voyages ?? 1), cls: tr(m.vessel_class ?? "") })}
                    {m.note && <span className="block text-ink-3">{planNote(m.note, tr)}.</span>}
                  </>
                ) : (
                  planNote(m.note ?? "", tr)
                )
              }
            >
              <div tabIndex={0} className="px-2.5 py-2 outline-offset-[-2px]">
                <div className="flex items-center justify-between text-[12.5px] text-ink-3">
                  <span>{monthShort(m.month)}</span>
                  {m.monsoon && <span title={tr("Monsoon month at this port")}>{tr("Monsoon")}</span>}
                </div>
                <div className={`mt-0.5 truncate text-[14px] ${!m.port ? "text-negative" : changed ? "font-semibold text-signal" : "text-ink"}`}>
                  {m.port ? tr(m.port) : tr("No option")}
                </div>
                {m.n_voyages !== undefined && (
                  <div className="text-[12.5px] text-ink-3">
                    {voyages(m.n_voyages)}
                  </div>
                )}
              </div>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}
