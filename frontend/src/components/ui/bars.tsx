import { splitPercents } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { ReactNode } from "react";
import { Tooltip } from "./overlay";

/** A thin magnitude bar that sits inside a table cell. */
export function InlineBar({
  value,
  max,
  color = "var(--color-series-1)",
  width = 64,
}: {
  value: number;
  max: number;
  color?: string;
  width?: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span aria-hidden className="inline-block align-middle" style={{ width }}>
      <span
        className="block h-[6px] rounded-r-[2px]"
        style={{ width: `${pct * 100}%`, background: color, minWidth: value > 0 ? 2 : 0 }}
      />
    </span>
  );
}

export interface BarListRow {
  label: string;
  value: number;
  display: ReactNode;
  share?: string;
  /** Value of the same row in a comparison, drawn as a tick. */
  compare?: number;
  compareDisplay?: ReactNode;
}

/** Horizontal bars sorted by value, each labelled with its amount. */
export function BarList({
  rows,
  max,
  color = "var(--color-series-1)",
  compareLabel,
}: {
  rows: BarListRow[];
  max?: number;
  color?: string;
  compareLabel?: string;
}) {
  const t = useT();
  const top = max ?? Math.max(...rows.map((r) => Math.max(r.value, r.compare ?? 0)), 0);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const w = top > 0 ? (r.value / top) * 100 : 0;
        const c = r.compare !== undefined && top > 0 ? (r.compare / top) * 100 : null;
        return (
          <Tooltip
            key={r.label}
            content={
              <>
                <span className="font-semibold text-ink">{r.display}</span> {t(r.label)}
                {r.share && <>, {t("{share} of total", { share: r.share })}</>}
                {r.compareDisplay !== undefined && compareLabel && (
                  <span className="block text-ink-3">
                    {compareLabel}: {r.compareDisplay}
                  </span>
                )}
              </>
            }
          >
            <div tabIndex={0} className="grid grid-cols-[minmax(7.5rem,9rem)_1fr_auto] items-center gap-x-3 gap-y-1 outline-offset-2">
              <span className="text-[14px] text-ink-2 truncate">{t(r.label)}</span>
              <span className="relative block h-3">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[3px] transition-[width] duration-200"
                  style={{ width: `${w}%`, background: color, minWidth: r.value > 0 ? 2 : 0 }}
                />
                {c !== null && (r.compare ?? 0) > 0 && (
                  <span
                    className="absolute -top-1 -bottom-1 w-[2px] bg-ink"
                    style={{ left: `calc(${c}% - 1px)` }}
                  />
                )}
              </span>
              <span className="text-right text-[14px] text-ink whitespace-nowrap">
                {r.display}
                {r.share && <span className="ml-2 inline-block w-10 text-ink-3">{r.share}</span>}
              </span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Two-part 100% bar with a legend underneath (labels never squeeze inside). */
export function SplitBar({
  parts: raw,
}: {
  parts: [{ label: string; pct: number; color: string }, { label: string; pct: number; color: string }];
}) {
  const t = useT();
  const [a, b] = splitPercents(raw[0].pct);
  const parts = [{ ...raw[0], pct: a, label: t(raw[0].label) }, { ...raw[1], pct: b, label: t(raw[1].label) }];
  return (
    <div>
      <div className="flex h-3 gap-[2px]" role="img" aria-label={parts.map((p) => `${p.label} ${p.pct.toFixed(0)}%`).join(", ")}>
        {parts.map((p, i) =>
          p.pct > 0 ? (
            <div
              key={p.label}
              className={`transition-[width] duration-200 ${i === 0 ? "rounded-l-[4px]" : ""} ${
                i === parts.length - 1 || parts[1].pct === 0 ? "rounded-r-[4px]" : ""
              } ${i === 1 && parts[0].pct === 0 ? "rounded-l-[4px]" : ""}`}
              style={{ width: `${p.pct}%`, background: p.color }}
            />
          ) : null
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-ink-2">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />
            {p.label} <span className="font-semibold text-ink">{p.pct.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
