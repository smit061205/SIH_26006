import { useT } from "../../lib/i18n";
/** Days of stock against the buffer target, with the cargo's arrival marked. */
export function StockMeter({
  cover,
  target,
  arrival,
}: {
  cover: number;
  target: number;
  arrival?: number;
}) {
  const t = useT();
  const top = Math.max(cover, target, arrival ?? 0) * 1.1;
  const pct = (d: number) => `${(d / top) * 100}%`;
  const color =
    cover < target / 2 ? "var(--color-negative)" : cover < target ? "var(--color-caution)" : "var(--color-positive)";
  return (
    <div>
      <div className="relative h-3 rounded-[3px] bg-sunken" role="img" aria-label={t("{cover} days of cover against a {target}-day target", { cover, target })}>
        <div className="absolute inset-y-0 left-0 rounded-l-[3px] rounded-r-[3px]" style={{ width: pct(cover), background: color }} />
        <span className="absolute -top-1 -bottom-1 w-[2px] bg-ink" style={{ left: pct(target) }} />
        {arrival !== undefined && (
          <span className="absolute -top-1.5 -bottom-1.5 border-l-2 border-dashed border-signal-fill" style={{ left: pct(arrival) }} />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2.5 rounded-[1px]" style={{ background: color }} />
          {t("Stock, {n} d", { n: cover })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-[2px] bg-ink" />
          {t("Target, {n} d", { n: target })}
        </span>
        {arrival !== undefined && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 border-l-2 border-dashed border-signal-fill" />
            {t("First cargo, {n} d", { n: arrival })}
          </span>
        )}
      </div>
    </div>
  );
}
