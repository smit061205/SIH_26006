import { useT } from "../../lib/i18n";
import { metres, weekday } from "../../lib/format";

/** Daily maximum wave height as a row of small bars. */
export function WaveStrip({
  dates,
  heights,
  max,
  size = "sm",
}: {
  dates: string[];
  heights: number[];
  max: number;
  size?: "sm" | "md";
}) {
  const t = useT();
  const label = t("Max wave height: {days}", { days: dates.map((d, i) => `${weekday(d)} ${metres(heights[i])}`).join(", ") });
  if (size === "sm") {
    return (
      <span role="img" aria-label={label} className="inline-flex h-4 items-end gap-[2px] align-middle">
        {heights.map((h, i) => (
          <span
            key={dates[i]}
            className="w-[6px] rounded-t-[1.5px] bg-series-1"
            style={{ height: `${Math.max(8, (h / max) * 100)}%` }}
          />
        ))}
      </span>
    );
  }
  return (
    <div role="img" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${heights.length}, minmax(0, 1fr))` }}>
      {heights.map((h, i) => (
        <div key={dates[i]} className="flex flex-col items-center">
          <span className="text-[13px] font-semibold text-ink">{h.toFixed(1)}</span>
          <span className="mt-1 flex h-14 w-full items-end justify-center">
            <span
              className="w-5 rounded-t-[3px] bg-series-1"
              style={{ height: `${Math.max(6, (h / max) * 100)}%` }}
            />
          </span>
          <span className="mt-1.5 text-[12.5px] text-ink-3">{weekday(dates[i])}</span>
        </div>
      ))}
    </div>
  );
}
