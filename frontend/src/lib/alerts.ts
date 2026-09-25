import type { Alert, AlertKind } from "../types";
import { num, shortDate } from "./format";
import { type T, en } from "./i18n";

export type Severity = Alert["severity"];

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };
const KIND_ORDER: AlertKind[] = ["notice", "rough_sea", "busy", "long_wait", "rate_move", "rate_range", "weather_unavailable"];

export interface AlertGroup {
  key: string;
  kind: AlertKind;
  severity: Severity;
  title: string;
  /** One line under the title; lists the worst items first. */
  detail: string;
  items: Alert[];
}

function worst(items: Alert[]): Severity {
  return items.reduce<Severity>((s, a) => (SEVERITY_RANK[a.severity] < SEVERITY_RANK[s] ? a.severity : s), "info");
}

function where(a: Alert) {
  return a.port ?? a.vessel_class ?? "";
}

/** The short fact for one alert inside a group: "Paradip 4.1 m". */
function itemFact(a: Alert, t: T): string {
  switch (a.kind) {
    case "rough_sea":
      return `${where(a)} ${num(a.value ?? 0, 1)} m`;
    case "long_wait":
      return `${where(a)} ${num(a.wait_min_days ?? 0)}–${num(a.wait_max_days ?? 0)} d`;
    case "busy":
      return `${where(a)} +${num(a.value ?? 0)}%`;
    case "rate_move":
      return `${where(a)} ${a.direction === "down" ? "−" : "+"}${num(Math.abs(a.value ?? 0))}%`;
    case "rate_range":
      return `${where(a)} ±${num((a.value ?? 0) / 2)}%`;
    case "notice":
      return `${where(a)}: ${a.title}`;
    default:
      return t(where(a));
  }
}

/** The full sentence when a group has a single alert. */
function singleDetail(a: Alert, t: T): string {
  switch (a.kind) {
    case "rough_sea":
      return t("Waves up to {h} m on {date}; {over} of the next {days} days at or above {limit} m.", {
        h: num(a.value ?? 0, 1),
        date: shortDate(a.peak_date ?? a.date ?? ""),
        over: a.days_over ?? 0,
        days: a.days_total ?? 0,
        limit: num(a.threshold ?? 0, 1),
      });
    case "long_wait":
      return t("Ships typically wait {min}–{max} days for a berth.", { min: num(a.wait_min_days ?? 0), max: num(a.wait_max_days ?? 0) });
    case "busy":
      return t("{calls} dry-bulk calls a day over the last four weeks, {pct}% above the year before.", {
        calls: num(a.recent_calls_per_day ?? 0, 2),
        pct: num(a.value ?? 0),
      });
    case "rate_move":
      return t(a.direction === "down" ? "Forecast to fall {pct}% by the week of {date}." : "Forecast to rise {pct}% by the week of {date}.", {
        pct: num(Math.abs(a.value ?? 0)),
        date: shortDate(a.date ?? ""),
      });
    case "rate_range":
      return t("The likely range in {weeks} weeks spans {pct}% of today's rate.", { weeks: a.days_total ?? 0, pct: num(a.value ?? 0) });
    case "notice":
      return a.peak_date
        ? t("{title}, {from} to {to}.", { title: a.title, from: shortDate(a.date ?? ""), to: shortDate(a.peak_date) })
        : t("{title}, {from} onwards.", { title: a.title, from: shortDate(a.date ?? "") });
    case "weather_unavailable":
      return t("The marine weather service didn't respond; sea-state alerts will return when it does.");
    default:
      return a.message;
  }
}

function groupTitle(kind: AlertKind, items: Alert[], t: T): string {
  const n = items.length;
  const one = items[0];
  const port = t(where(one));
  switch (kind) {
    case "rough_sea":
      return n === 1 ? t("Rough sea at {port}", { port }) : t("Rough sea at {n} ports", { n });
    case "long_wait":
      return n === 1 ? t("Long waits at {port}", { port }) : t("Long waits at {n} ports", { n });
    case "busy":
      if (n > 1) return t("{n} ports busier than usual", { n });
      return one.scope === "load" ? t("Busier than usual at {port} (loading)", { port }) : t("Busier than usual at {port}", { port });
    case "notice":
      return n === 1 ? t("Notice at {port}", { port }) : t("Notices at {n} ports", { n });
    case "rate_move": {
      if (n === 1) return t(one.direction === "down" ? "{cls} rates expected to fall" : "{cls} rates expected to rise", { cls: port });
      return t("Rates expected to move");
    }
    case "rate_range":
      return n === 1 ? t("{cls} rates uncertain", { cls: port }) : t("Rates uncertain for {n} vessel types", { n });
    default:
      return t("Sea-state forecast unavailable");
  }
}

const SHOWN_FACTS = 2;

/** Alerts grouped by what they're about, worst first; one line each. */
export function groupAlerts(alerts: Alert[], t: T = en): AlertGroup[] {
  const byKind = new Map<AlertKind, Alert[]>();
  for (const a of alerts) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  const groups: AlertGroup[] = [];
  for (const [kind, raw] of byKind) {
    const items = [...raw].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
    const facts = items.map((a) => itemFact(a, t));
    const more = facts.length - SHOWN_FACTS;
    const detail =
      items.length === 1
        ? singleDetail(items[0], t)
        : facts.slice(0, SHOWN_FACTS).join(" · ") + (more > 0 ? ` · ${t("+{n} more", { n: more })}` : "");
    groups.push({ key: kind, kind, severity: worst(items), title: groupTitle(kind, items, t), detail, items });
  }
  return groups.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  );
}

/** Full sentence for one alert, used when a group is expanded. */
export function alertSentence(a: Alert, t: T = en): string {
  return singleDetail(a, t);
}

/** Alerts that need attention (not notes), for counts. */
export function actionable(alerts: Alert[]) {
  return alerts.filter((a) => a.severity !== "info");
}

/** Short flags for one port's row in a table: "Rough sea 4.1 m". */
export function portFlags(alerts: Alert[], port: string, t: T = en): { label: string; severity: Severity }[] {
  return alerts
    .filter((a) => a.port === port && a.severity !== "info")
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((a) => ({
      severity: a.severity,
      label:
        a.kind === "rough_sea"
          ? t("Rough sea {h} m", { h: num(a.value ?? 0, 1) })
          : a.kind === "busy"
            ? t("Busy +{pct}%", { pct: num(a.value ?? 0) })
            : a.kind === "long_wait"
              ? t("Long wait")
              : a.title,
    }));
}

/** "Rough sea at 6 ports · 2 ports busier than usual" */
export function alertSummary(alerts: Alert[], t: T = en): string {
  return groupAlerts(actionable(alerts), t)
    .map((g) => g.title)
    .join(" · ");
}
