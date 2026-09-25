import type { DriverSeries } from "../types";
import { type Money, num, pct } from "./format";
import { type T, en } from "./i18n";

/** A driver's price in the chosen currency (the rupee rate stays as it is). */
export function driverValue(d: DriverSeries, m: Money): string {
  if (d.key === "usd_inr") return `₹${num(d.latest.value, 2)} per $`;
  const unit = d.key === "brent" ? "bbl" : "t";
  return m.currency === "USD" ? `$${num(d.latest.value, 2)}/${unit}` : `₹${num(d.latest.value * m.rate, 0)}/${unit}`;
}

const EFFECT: Record<DriverSeries["key"], { up: string; down: string }> = {
  brent: { up: "raising bunker costs and freight", down: "easing bunker costs" },
  coal_au: { up: "a firmer coal market that tends to lift demand for ships", down: "a softer coal market" },
  usd_inr: { up: "making dollar freight dearer in rupees", down: "making dollar freight cheaper in rupees" },
};

/** "Brent is up 12% in three months, raising bunker costs and freight." or null when nothing moved much. */
export function driversSentence(drivers: DriverSeries[], threshold = 5, tr: T = en): string | null {
  const moves = drivers
    .filter((d) => d.change_3m_pct !== null && Math.abs(d.change_3m_pct) >= threshold)
    .sort((a, b) => Math.abs(b.change_3m_pct!) - Math.abs(a.change_3m_pct!));
  if (!moves.length) return null;
  return moves
    .map((d) => {
      const up = d.change_3m_pct! > 0;
      const name = tr(d.key === "usd_inr" ? "The dollar" : d.label);
      return tr(up ? "{name} is up {pct} in three months, {effect}." : "{name} is down {pct} in three months, {effect}.", {
        name,
        pct: pct(Math.abs(d.change_3m_pct!), 0),
        effect: tr(up ? EFFECT[d.key].up : EFFECT[d.key].down),
      });
    })
    .join(" ");
}
