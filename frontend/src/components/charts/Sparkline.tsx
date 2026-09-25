import { useT } from "../../lib/i18n";
/** Today's rate followed by the weekly forecast, with the best week marked. */
export function ForecastSparkline({
  current,
  points,
  bestIndex,
  width = 220,
  height = 48,
}: {
  current: number;
  points: number[];
  /** 0 = now, n = forecast week n; null = no week worth marking */
  bestIndex: number | null;
  width?: number;
  height?: number;
}) {
  const t = useT();
  const values = [current, ...points];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 5;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("Forecast for the coming weeks")}>
      <line x1={pad} x2={width - pad} y1={y(current)} y2={y(current)} stroke="var(--color-grid)" strokeWidth={1} />
      <path d={path} fill="none" stroke="var(--color-series-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(0)} cy={y(current)} r={3.5} fill="var(--color-series-1)" stroke="var(--color-surface)" strokeWidth={2} />
      {bestIndex !== null && (
        <circle
          cx={x(bestIndex)}
          cy={y(values[bestIndex])}
          r={5}
          fill="var(--color-surface)"
          stroke="var(--color-signal-fill)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}
