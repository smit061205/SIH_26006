import { useT } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { axisDate, longDate, num } from "../../lib/format";

function niceMax(v: number) {
  if (v <= 5) return 5;
  const step = v <= 20 ? 5 : v <= 50 ? 10 : 20;
  return Math.ceil(v / step) * step;
}

/** Weekly dry-bulk calls at one port: a line with a crosshair tooltip. */
export function CallsHistory({ weeks, height = 200 }: { weeks: { date: string; calls: number }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
    // The chart (and its measured box) only exists once there are two weeks to draw.
  }, [weeks.length >= 2]); // eslint-disable-line react-hooks/exhaustive-deps

  if (weeks.length < 2) return null;
  const pad = { l: 32, r: 8, t: 8, b: 22 };
  const w = Math.max(200, width);
  const max = niceMax(Math.max(...weeks.map((d) => d.calls)));
  const x = (i: number) => pad.l + (i / (weeks.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const path = weeks.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.calls).toFixed(1)}`).join(" ");
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.round(weeks.length / Math.max(2, Math.floor(w / 90))));
  const labels = weeks.map((d, i) => ({ i, d })).filter(({ i }) => i % every === 0);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round(((px - pad.l) / (w - pad.l - pad.r)) * (weeks.length - 1));
    setHover(Math.min(weeks.length - 1, Math.max(0, i)));
  };
  const h = hover !== null ? weeks[hover] : null;

  return (
    <div ref={ref} className="relative">
      <svg
        width={w}
        height={height}
        role="img"
        aria-label={t("Weekly dry-bulk calls from {from} to {to}", { from: longDate(weeks[0].date), to: longDate(weeks[weeks.length - 1].date) })}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--color-ink-3)">
              {num(t)}
            </text>
          </g>
        ))}
        {labels.map(({ i, d }) => (
          <text key={d.date} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
            {axisDate(d.date)}
          </text>
        ))}
        <path d={path} fill="none" stroke="var(--color-series-1)" strokeWidth={2} strokeLinejoin="round" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--color-ink-3)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.calls)} r={4} fill="var(--color-series-1)" stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-[var(--radius-surface)] border border-overlay-border bg-surface px-2.5 py-1.5 text-[13px] shadow-[var(--shadow-overlay)]"
          style={{ left: Math.min(Math.max(0, x(hover) - 70), w - 150) }}
        >
          <div className="text-ink-3">{t("Week to {date}", { date: longDate(h.date) })}</div>
          <div className="font-semibold text-ink">
            {h.calls} {h.calls === 1 ? "call" : "calls"}
          </div>
        </div>
      )}
    </div>
  );
}
