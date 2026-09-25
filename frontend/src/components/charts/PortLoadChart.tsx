import { useT } from "../../lib/i18n";
import { Tooltip } from "../ui/overlay";

const LABEL_COL = "7.5rem";

/** Calls per port against its berth-slot limit: one limit for every port
 *  (a dashed line), or a limit per port (a tick on each row). */
export function PortLoadChart({
  rows,
  limit,
  limits,
}: {
  rows: { port: string; calls: number }[];
  limit: number;
  limits?: Record<string, number>;
}) {
  const tr = useT();
  const limitOf = (port: string) => limits?.[port] ?? limit;
  const perPort = !!limits && rows.some((r) => limitOf(r.port) !== limit);
  const top = Math.max(limit, ...rows.map((r) => Math.max(r.calls, limitOf(r.port)))) * 1.15;
  const limitPct = (limit / top) * 100;
  return (
    <div>
      <div className="relative">
        <div className="space-y-2.5">
          {rows.map((r) => (
            <Tooltip
              key={r.port}
              content={
                <>
                  <span className="font-semibold text-ink">
                    {r.calls} {r.calls === 1 ? "call" : "calls"}
                  </span>{" "}
                  at {r.port}, limit {limitOf(r.port)}
                </>
              }
            >
              <div tabIndex={0} className="grid items-center gap-3 outline-offset-2" style={{ gridTemplateColumns: `${LABEL_COL} 1fr` }}>
                <span className="truncate text-[14px] text-ink-2">{r.port}</span>
                <span className="relative block h-4">
                  <span
                    className="absolute inset-y-0 left-0 rounded-r-[3px] transition-[width] duration-200"
                    style={{
                      width: `${(r.calls / top) * 100}%`,
                      background: r.calls > limitOf(r.port) ? "var(--color-negative)" : "var(--color-series-1)",
                    }}
                  />
                  {perPort && (
                    <span
                      aria-hidden
                      className="absolute -bottom-1 -top-1 border-l-2 border-ink-3"
                      style={{ left: `${(limitOf(r.port) / top) * 100}%` }}
                    />
                  )}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 pl-2 text-[13.5px] font-semibold text-ink"
                    style={{ left: `${(r.calls / top) * 100}%` }}
                  >
                    {r.calls}
                  </span>
                </span>
              </div>
            </Tooltip>
          ))}
        </div>
        {!perPort && (
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-1.5 -top-1.5 right-0"
            style={{ left: `calc(${LABEL_COL} + 0.75rem)` }}
          >
            <span className="absolute inset-y-0 border-l border-dashed border-ink-3" style={{ left: `${limitPct}%` }} />
          </div>
        )}
      </div>
      <p className="mt-4 text-[13px] text-ink-3" style={{ paddingLeft: `calc(${LABEL_COL} + 0.75rem)` }}>
        {perPort
          ? tr("Tick on each bar: that port's berth slots per month")
          : tr("Dashed line: {n} berth slots per port per month", { n: limit })}
      </p>
    </div>
  );
}
