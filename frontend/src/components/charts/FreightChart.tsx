import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type Money, axisDate, axisMoney, dayRate, longDate, perDayUnit, perTonne, perTonneUnit } from "../../lib/format";
import { type T, useT } from "../../lib/i18n";
import type { ForecastResponse } from "../../types";
import { axisStroke, axisTick, gridStroke } from "./chartTheme";

export type HistoryRange = "6m" | "1y" | "2y";
/** What the chart plots: time-charter hire per day, or sea freight per tonne. */
export type ChartUnit = "day" | "tonne";

function fmt(v: number, money: Money, unit: ChartUnit) {
  return unit === "tonne" ? perTonne(v, money) : dayRate(v, money);
}

function unitSuffix(unit: ChartUnit) {
  return unit === "tonne" ? perTonneUnit() : perDayUnit();
}

function axisTickLabel(v: number, money: Money, unit: ChartUnit) {
  if (unit === "day") return axisMoney(v, money);
  if (money.currency === "USD") return `$${Math.round(v)}`;
  return `₹${Math.round(v * money.rate).toLocaleString("en-IN")}`;
}
const RANGE_MONTHS: Record<HistoryRange, number> = { "6m": 6, "1y": 12, "2y": 24 };

interface Point {
  date: string;
  actual?: number;
  forecast?: number;
  band?: [number, number];
}

function buildFreightSeries(data: Pick<ForecastResponse, "history" | "forecast">, range: HistoryRange): Point[] {
  const last = data.history[data.history.length - 1];
  let history = data.history;
  if (last) {
    const cutoff = new Date(`${last.date}T00:00:00Z`);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - RANGE_MONTHS[range]);
    const iso = cutoff.toISOString().slice(0, 10);
    history = history.filter((h) => h.date > iso);
  }
  const points: Point[] = history.map((h) => ({ date: h.date, actual: h.actual }));
  // Join the forecast to the last actual so the two lines meet at "today".
  if (points.length && last) {
    const tail = points[points.length - 1];
    tail.forecast = last.actual;
    tail.band = [last.actual, last.actual];
  }
  for (const f of data.forecast) points.push({ date: f.date, forecast: f.forecast, band: [f.lower, f.upper] });
  return points;
}

type LabelProps = { x?: number | string; y?: number | string; index?: number };

function EndLabel({ x, y, index, lastIndex, text }: LabelProps & { lastIndex: number; text: string }) {
  if (index !== lastIndex || x === undefined || y === undefined) return <g />;
  return (
    <text x={Number(x) + 8} y={Number(y)} dy={4} fill="var(--color-ink)" fontSize={13} fontWeight={600} fontFamily="var(--font-sans)">
      {text}
    </text>
  );
}

function FreightTooltip({
  active,
  payload,
  label,
  money,
  unit,
  t,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  label?: string;
  money: Money;
  unit: ChartUnit;
  t: T;
}) {
  if (!active || !payload?.length || !label) return null;
  const p = payload[0].payload;
  const rows: { key: string; stroke: string; dashed?: boolean; name: string; value: string }[] = [];
  if (p.actual !== undefined) rows.push({ key: "a", stroke: "var(--color-series-1)", name: t("Actual"), value: fmt(p.actual, money, unit) });
  if (p.forecast !== undefined && p.actual === undefined)
    rows.push({ key: "f", stroke: "var(--color-series-2)", dashed: true, name: t("Forecast"), value: fmt(p.forecast, money, unit) });
  if (p.band && p.actual === undefined)
    rows.push({
      key: "b",
      stroke: "transparent",
      name: t("80% range"),
      value: `${fmt(p.band[0], money, unit)} – ${fmt(p.band[1], money, unit)}`,
    });
  return (
    <div className="rounded-[var(--radius-surface)] border border-overlay-border bg-surface px-3 py-2.5 shadow-[var(--shadow-overlay)]">
      <div className="text-[12.5px] text-ink-3 mb-1.5">{t("Week of {date}", { date: longDate(label) })}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2.5 text-[13.5px]">
          <svg width="14" height="6" aria-hidden>
            <line x1="0" y1="3" x2="14" y2="3" stroke={r.stroke} strokeWidth="2" strokeDasharray={r.dashed ? "3 2" : undefined} />
          </svg>
          <span className="font-semibold text-ink">
            {r.value}
            {r.key !== "b" && <span className="font-normal text-ink-3">{unitSuffix(unit)}</span>}
          </span>
          <span className="text-ink-3">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

export function FreightChart({
  data,
  range,
  money,
  height = 360,
  bestWeek,
  unit = "day",
}: {
  data: Pick<ForecastResponse, "history" | "forecast">;
  range: HistoryRange;
  money: Money;
  height?: number;
  /** Week to fix, ringed on the forecast line. */
  bestWeek?: { date: string; rate: number };
  unit?: ChartUnit;
}) {
  const t = useT();
  // Phone-sized charts drop the end label, which needs a wide right margin.
  const narrow = height < 300;
  const points = buildFreightSeries(data, range);
  const lastIndex = points.length - 1;
  const todayIndex = points.findIndex((p) => p.actual !== undefined && p.forecast !== undefined);
  const today = todayIndex >= 0 ? points[todayIndex].date : undefined;
  const lastForecast = data.forecast[data.forecast.length - 1];
  const peak = Math.max(...points.map((p) => Math.max(p.actual ?? 0, p.forecast ?? 0, p.band?.[1] ?? 0)));
  const steps = unit === "tonne" ? [1, 2, 5, 10, 20, 25, 50, 100] : [5_000, 10_000, 20_000, 25_000, 50_000, 100_000];
  const step = steps.find((s) => peak / s <= 5) ?? steps[steps.length - 1];
  const ticks = Array.from({ length: Math.ceil(peak / step) + 1 }, (_, i) => i * step);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px] text-ink-2">
        <span className="inline-flex items-center gap-2">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke="var(--color-series-1)" strokeWidth="2" />
          </svg>
          {t("Actual")}
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke="var(--color-series-2)" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          {t("Forecast")}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-[18px] rounded-[2px]" style={{ background: "var(--color-band)" }} />
          {t("80% range")}
        </span>
        {bestWeek && (
          <span className="inline-flex items-center gap-2">
            <svg width="12" height="12" aria-hidden>
              <circle cx="6" cy="6" r="4.5" fill="var(--color-surface)" stroke="var(--color-signal-fill)" strokeWidth="2" />
            </svg>
            {t("Best week to fix")}
          </span>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 12, right: narrow ? 12 : 92, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={gridStroke} />
            <XAxis
              dataKey="date"
              tick={axisTick}
              tickFormatter={(v: string) => axisDate(v)}
              minTickGap={56}
              tickLine={false}
              axisLine={{ stroke: axisStroke }}
              dy={6}
            />
            <YAxis
              tick={axisTick}
              tickFormatter={(v) => axisTickLabel(v, money, unit)}
              tickLine={false}
              axisLine={false}
              width={unit === "tonne" && money.currency === "INR" ? 64 : 60}
              domain={[0, ticks[ticks.length - 1]]}
              ticks={ticks}
            />
            <Tooltip
              content={<FreightTooltip money={money} unit={unit} t={t} />}
              cursor={{ stroke: "var(--color-ink-3)", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <Area
              dataKey="band"
              stroke="none"
              fill="var(--color-band)"
              fillOpacity={1}
              isAnimationActive={false}
              activeDot={false}
            />
            {today && (
              <ReferenceLine
                x={today}
                stroke="var(--color-rule-strong)"
                label={{ value: t("Today"), position: "insideTopLeft", fill: "var(--color-ink-3)", fontSize: 12.5, dy: -10 }}
              />
            )}
            <Line
              dataKey="actual"
              stroke="var(--color-series-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="forecast"
              stroke="var(--color-series-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, stroke: "var(--color-surface)", strokeWidth: 2 }}
              isAnimationActive={false}
              label={(p: LabelProps) => (
                <EndLabel
                  {...p}
                  lastIndex={narrow ? -1 : lastIndex}
                  text={lastForecast ? t("{value} forecast", { value: fmt(lastForecast.forecast, money, unit) }) : ""}
                />
              )}
            />
            {bestWeek && (
              <ReferenceDot
                x={bestWeek.date}
                y={bestWeek.rate}
                r={6}
                fill="var(--color-surface)"
                stroke="var(--color-signal-fill)"
                strokeWidth={2}
                label={{ value: t("Best week"), position: "bottom", fill: "var(--color-ink)", fontSize: 12.5, offset: 10 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
