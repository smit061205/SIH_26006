import { ErrorState } from "../ui/feedback";
import { useT } from "../../lib/i18n";
import { Download, Printer, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCurrency, useMoney } from "../../lib/currency";
import { days, durationLabel, longDate, monthLong, perTonne, perTonneUnit, splitPercents, tonnes, total } from "../../lib/format";
import { originParts, plantShort } from "../../lib/labels";
import { useCharterPlan } from "../../lib/queries";
import { navigate } from "../../lib/router";
import { deletePlan, savePlan, useSavedPlans } from "../../lib/savedPlans";
import { type Shipment, parseShipment, shipmentQuery, useShipment } from "../../lib/shipment";
import type { CharterPlanResponse } from "../../types";
import { Button, Field, Select } from "../ui/inputs";
import { Section } from "../ui/layout";
import { Popover } from "../ui/overlay";
import { Table, Td, Th, Tr } from "../ui/table";

function defaultPlanName(s: Shipment) {
  return `${plantShort(s.plant)} · ${originParts(s.origin).short} · ${monthLong(s.month).slice(0, 3)} · ${
    s.duration ? `${s.duration} mo` : "spot"
  }`;
}

/** A CSV cell: quoted when it holds a comma, quote or line break. */
function cell(v: string | number | null | undefined) {
  const text = v == null ? "" : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The plan as a CSV a desk can file or paste into a spreadsheet: the recommendation, then the schedule. */
function planCsv(shipment: Shipment, plan: CharterPlanResponse): string {
  const rec = plan.recommendation!;
  const top = rec.top;
  const lines: (string | number | null | undefined)[][] = [
    ["Freightwise charter plan"],
    ["Plant", shipment.plant],
    ["Load port", shipment.origin],
    ["Cargo per month (t)", shipment.cargoTonnes],
    ["Starting month", monthLong(shipment.month)],
    ["Contract", shipment.duration ? `${shipment.duration} months` : "Single spot voyage"],
    ["Laycan", `${plan.laycan.start} to ${plan.laycan.end}`],
    [],
    ["Recommendation", `${top.vessel_class} into ${top.port}`],
    ["Landed cost (USD/t)", rec.usd_per_tonne_over_contract],
    ["Total (USD)", Math.round(rec.total_usd_over_contract)],
    ["Voyages", rec.total_voyages],
    ["At the plant in (days)", top.total_lead_days],
  ];
  if (plan.timing) {
    lines.push(["When to fix", plan.timing.signal.replace("_", " ")], ["Best fixing week", plan.timing.best_fix.date]);
    if (shipment.duration) lines.push(["On contract (%)", plan.timing.contract.contract_pct]);
  }
  if (plan.schedule) {
    lines.push([], ["Month", "Port", "Vessel", "Voyages", "USD/t", "Total USD", "Spot total USD", "Wait (days)", "Monsoon"]);
    for (const m of plan.schedule.months) {
      lines.push([
        m.month_label,
        m.port,
        m.vessel_class,
        m.n_voyages,
        m.usd_per_tonne,
        m.total_usd == null ? null : Math.round(m.total_usd),
        m.spot_total_usd == null ? null : Math.round(m.spot_total_usd),
        m.expected_wait_days,
        m.monsoon ? "yes" : "",
      ]);
    }
  }
  return lines.map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print, and save or reopen plans kept in this browser. */
export function PlanActions() {
  const { shipment } = useShipment();
  // The page's own plan query: already loaded, so the CSV needs no extra request.
  const plan = useCharterPlan(shipment);
  const saved = useSavedPlans();
  const [name, setName] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const tr = useT();
  if (!shipment) return null;
  const query = shipmentQuery(shipment);
  const isSaved = saved.some((p) => p.query === query);
  const csvName = `freightwise-plan-${defaultPlanName(shipment).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.csv`;
  return (
    <>
      <Button onClick={() => window.print()}>
        <Printer size={15} strokeWidth={1.75} aria-hidden />
        {tr("Print or save PDF")}
      </Button>
      {plan.data?.recommendation && (
        <Button onClick={() => downloadCsv(csvName, planCsv(shipment, plan.data!))}>
          <Download size={15} strokeWidth={1.75} aria-hidden />
          {tr("Download CSV")}
        </Button>
      )}
      <Popover
        title="Saved plans"
        trigger={<Button>{tr(isSaved ? "Saved" : "Save")}</Button>}
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            savePlan(name || defaultPlanName(shipment), query);
            setName("");
            setJustSaved(true);
          }}
        >
          <label className="sr-only" htmlFor="plan-name">
            {tr("Name for this plan")}
          </label>
          <input
            id="plan-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
            placeholder={defaultPlanName(shipment)}
            className="h-[34px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-2.5 text-[14px] text-ink placeholder:text-ink-3"
          />
          <Button type="submit">Save</Button>
        </form>
        {justSaved && <p className="mt-2 text-[13px] text-positive">{tr("Saved in this browser.")}</p>}
        {saved.length > 0 && (
          <ul className="mt-4 max-h-[240px] divide-y divide-rule overflow-y-auto border-y border-rule">
            {saved.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-[14px] text-accent hover:underline"
                  onClick={() => navigate(`/plan?${p.query}`)}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="p-1 text-ink-3 hover:text-negative"
                  aria-label={tr("Delete {name}", { name: p.name })}
                  onClick={() => deletePlan(p.id)}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </>
  );
}

/** Shown only on paper: what the plan is for, when it was printed, and the rate used. */
export function PrintHeader() {
  const { shipment } = useShipment();
  const { money, rateDate } = useCurrency();
  const tr = useT();
  if (!shipment) return null;
  // Today in the viewer's own time zone (toISOString would give the UTC date).
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return (
    <div className="hidden print:mb-6 print:block print:border-b print:border-ink print:pb-3 text-[12px] text-ink-2">
      <p className="serif text-[16px] font-semibold text-ink">{tr("Freightwise charter plan, {date}", { date: longDate(today) })}</p>
      <p>
        {shipment.plant} · {originParts(shipment.origin).label} · {tonnes(shipment.cargoTonnes)}
        {shipment.duration ? tr(" a month") : ""} · {tr("from {month}", { month: monthLong(shipment.month) })} ·{" "}
        {durationLabel(shipment.duration)}
      </p>
      <p>
        {money.currency === "USD"
          ? tr("Figures in US dollars.")
          : tr("Figures in rupees at ₹{rate} per $ (ECB, {date}).", { rate: money.rate.toFixed(2), date: rateDate ? longDate(rateDate) : "–" })}
      </p>
    </div>
  );
}

type Row = { label: string; value: (p: CharterPlanResponse, s: Shipment) => string };

/** Current plan against a saved one, line by line. */
export function ComparePlans() {
  const { shipment, reference } = useShipment();
  const money = useMoney();
  const saved = useSavedPlans();
  const [pick, setPick] = useState<string | null>(null);
  const current = shipment ? shipmentQuery(shipment) : "";
  const others = saved.filter((p) => p.query !== current);
  const chosen = others.find((p) => p.id === pick) ?? others[0];
  const other = chosen && reference ? parseShipment(new URLSearchParams(chosen.query), reference) : null;
  const a = useCharterPlan(shipment);
  const b = useCharterPlan(other);
  const tr = useT();
  if (!shipment || others.length === 0) return null;

  const rows: Row[] = [
    { label: "Plant", value: (_, s) => plantShort(s.plant) },
    { label: "Load port", value: (_, s) => originParts(s.origin).label },
    { label: "Cargo", value: (_, s) => `${tonnes(s.cargoTonnes)}${s.duration ? tr(" a month") : ""}` },
    { label: "Starting", value: (_, s) => monthLong(s.month) },
    { label: "Contract", value: (_, s) => durationLabel(s.duration) },
    {
      label: "Vessel and port",
      value: (p) =>
        p.recommendation
          ? tr("{cls} into {port}", { cls: tr(p.recommendation.top.vessel_class), port: tr(p.recommendation.top.port) })
          : tr("No option fits"),
    },
    {
      label: "Landed cost",
      value: (p) => (p.recommendation ? `${perTonne(p.recommendation.usd_per_tonne_over_contract, money)}${perTonneUnit()}` : "–"),
    },
    { label: "Total", value: (p) => (p.recommendation ? total(p.recommendation.total_usd_over_contract, money) : "–") },
    { label: "Voyages", value: (p) => (p.recommendation ? String(p.recommendation.total_voyages) : "–") },
    {
      label: "When to fix",
      value: (p) =>
        !p.timing ? "–" : tr(p.timing.signal === "fix_now" ? "Now" : p.timing.signal === "wait" ? "Wait" : "Part now, part later"),
    },
    {
      label: "On contract",
      value: (p, s) => (p.timing && s.duration ? `${splitPercents(p.timing.contract.contract_pct)[0]}%` : "–"),
    },
    {
      label: "At the plant in",
      value: (p) => (p.recommendation ? days(p.recommendation.top.total_lead_days) : "–"),
    },
    {
      label: "Stock",
      value: (p) =>
        !p.plant
          ? "–"
          : p.plant.stockout_before_arrival
            ? tr("Runs out {d} before arrival", { d: days(p.plant.days_short ?? 0) })
            : tr("Lasts"),
    },
  ];

  return (
    <Section
      title="Compare with a saved plan"
      description="This plan beside one you saved, line by line."
      actions={
        <Field label="Saved plan" layout="inline">
          <Select
            label="Saved plan to compare"
            value={chosen?.id ?? ""}
            onChange={setPick}
            options={others.map((p) => ({ value: p.id, label: p.name }))}
            className="w-[220px]"
          />
        </Field>
      }
    >
      <div className="max-w-3xl">
        {(a.isError || b.isError) && (
          <div className="mb-4">
            <ErrorState
              message="Couldn't calculate one of the plans to compare."
              onRetry={() => {
                if (a.isError) void a.refetch();
                if (b.isError) void b.refetch();
              }}
            />
          </div>
        )}
        <Table>
          <thead>
            <tr>
              <Th> </Th>
              <Th>This plan</Th>
              <Th>{chosen?.name}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const left = a.data ? r.value(a.data, shipment) : a.isError ? "–" : "…";
              const right = b.data && other ? r.value(b.data, other) : b.isError ? "–" : "…";
              return (
                <Tr key={r.label}>
                  <Td className="text-ink-3">{tr(r.label)}</Td>
                  <Td className="font-semibold">{left}</Td>
                  <Td className={right !== left ? "font-semibold text-accent" : "text-ink-2"}>{right}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </Section>
  );
}
