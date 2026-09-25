import type { RankedRow } from "../types";

/** Smallest to largest; the API's reference list is the source of truth. */
export const VESSEL_CLASSES = ["Handysize", "Supramax", "Panamax", "Post-Panamax", "Capesize"] as const;

export const VESSEL_ABBR: Record<string, string> = {
  Handysize: "HSZ",
  Supramax: "SMX",
  Panamax: "PMX",
  "Post-Panamax": "PPMX",
  Capesize: "CAPE",
};

/** "Australia (Hay Point/Dalrymple Bay)" -> place "Hay Point / Dalrymple Bay", country "Australia" */
export function originParts(origin: string) {
  const m = origin.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!m) return { place: origin, country: "", short: origin, label: origin };
  const country = m[1];
  const places = m[2].split("/").map((s) => s.trim());
  return {
    place: places.join(" / "),
    country,
    short: places[0],
    label: `${places.join(" / ")}, ${country}`,
  };
}

export function plantShort(plant: string) {
  return plant.replace(/\s*Steel Plant$/i, "").replace(/^IISCO\s+/i, "");
}

export const MODEL_NAMES: Record<string, string> = {
  arima: "ARIMA",
  naive: "Naive (last value)",
  seasonal_naive: "Seasonal naive",
  gbrt: "Gradient-boosted trees",
  gbrt_drivers: "Trees with coal, oil and rupee",
};

export const COST_COMPONENTS: { key: keyof RankedRow; label: string }[] = [
  { key: "rail_cost_usd", label: "Rail to plant" },
  { key: "hire_cost_usd", label: "Ocean hire" },
  { key: "bunker_cost_usd", label: "Bunker fuel" },
  { key: "transfer_cost_usd", label: "Cargo handling" },
  { key: "port_charges_usd", label: "Port charges" },
  { key: "transshipment_cost_usd", label: "Transshipment" },
  { key: "waiting_hire_usd", label: "Waiting time (hire)" },
];

/** Short codes for why a vessel class can't use a port, from the backend's reason text. */
export function rejectionCodes(reasons: string): string[] {
  const codes: string[] = [];
  const r = reasons.toLowerCase();
  if (r.includes("load port")) codes.push("Load port");
  const discharge = r.replace(/load port[^;]*/g, "");
  if (discharge.includes("draft")) codes.push("Draft");
  if (/\bloa\b/.test(discharge)) codes.push("LOA");
  if (discharge.includes("beam")) codes.push("Beam");
  if (discharge.includes("not an accepted class")) codes.push("Class");
  if (discharge.includes("suspended")) codes.push("Season");
  return codes;
}

type Tr = (text: string, vars?: Record<string, string | number>) => string;
const plain: Tr = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text);

/**
 * The backend's reasons a vessel can't use a port, as sentences in the
 * viewer's language (English when no translator is given):
 * "draft 18.0m exceeds seasonal limit 17.7m; Capesize not an accepted class at this port"
 *  -> ["Draft 18.0 m exceeds the seasonal limit of 17.7 m", "Capesize is not accepted at this port"]
 */
export function rejectionSentences(reasons: string, tr: Tr = plain): string[] {
  const m = (v: string) => `${v} m`;
  return reasons
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const load = /^load port ([^:]+): (.*)$/.exec(raw);
      const s = load ? load[2] : raw;
      const where = load ? tr("At the load port ({port}): ", { port: tr(load[1]) }) : "";
      let x = /^(draft|LOA|beam) ([\d.]+)m exceeds (seasonal|port|load-port) limit ([\d.]+)m(, even part-loaded)?$/i.exec(s);
      if (x) {
        const what = { draft: "Draft", loa: "LOA", beam: "Beam" }[x[1].toLowerCase()] ?? x[1];
        const limit = { seasonal: "the seasonal limit", port: "the port limit", "load-port": "the load-port limit" }[x[3]] ?? x[3];
        const text = x[5]
          ? "{what} {value} exceeds {limit} of {max}, even part-loaded to half a cargo"
          : "{what} {value} exceeds {limit} of {max}";
        return where + tr(text, { what: tr(what), value: m(x[2]), limit: tr(limit), max: m(x[4]) });
      }
      x = /^(.+) is larger than the terminal's ([\d,]+) DWT limit$/.exec(s);
      if (x) return where + tr("{cls} is larger than the terminal's {dwt} DWT limit", { cls: tr(x[1]), dwt: x[2] });
      x = /^(.+) not an accepted class at this port$/.exec(s);
      if (x) return tr("{cls} is not accepted at this port", { cls: tr(x[1]) });
      if (/operations suspended in the monsoon months/.test(s)) return tr("Closed in the monsoon months");
      return where + tr(s.replace(/^./, (c) => c.toUpperCase()));
    });
}

/**
 * The backend's plan notes in the viewer's language. The API writes them in
 * English; each known sentence is matched and re-said through the translator
 * (anything unknown passes through as it came).
 */
export function planNote(note: string, tr: (text: string, vars?: Record<string, string | number>) => string): string {
  return note
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      let m = /^A (.+) can't take every month of this contract, so the plan uses a (.+)\.$/.exec(part);
      if (m) return tr("A {cls} can't take every month of this contract, so the plan uses a {chosen}.", { cls: tr(m[1]), chosen: tr(m[2]) });
      m = /^A (.+) can't take this cargo in (\w+), so the plan uses the cheapest option\.$/.exec(part);
      if (m) return tr("A {cls} can't take this cargo in {month}, so the plan uses the cheapest option.", { cls: tr(m[1]), month: tr(m[2]) });
      m = /^Port changes from (.+)$/.exec(part);
      if (m) return tr("Port changes from {port}", { port: tr(m[1]) });
      return tr(part);
    })
    .join("; ");
}
