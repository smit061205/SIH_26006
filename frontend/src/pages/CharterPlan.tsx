import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { putPlantStock } from "../api";
import { Button, NumberField, Segmented, Select, Slider } from "../components/ui/inputs";
import { ScheduleStrip } from "../components/charts/ScheduleStrip";
import { ForecastSparkline } from "../components/charts/Sparkline";
import { StockMeter } from "../components/charts/StockMeter";
import { AlertList, AlertSettings } from "../components/ui/alerts";
import { SplitBar } from "../components/ui/bars";
import { EmptyState, ErrorState, PageSkeleton, Refreshing, Skeleton } from "../components/ui/feedback";
import { Delta, Figure, FigureRow, Verdict } from "../components/ui/figures";
import { PageHeader } from "../components/ui/layout";
import { ComparePlans, PlanActions, PrintHeader } from "../components/plan/PlanTools";
import { toSpec } from "../components/ship3d/hull";
import { ShipView } from "../components/ship3d/ShipView";
import { ShipAtPort } from "../components/ship3d/WillItFit";
import { VoyageView } from "../components/ship3d/VoyageView";
import { useThresholds } from "../lib/alertSettings";
import { type T, useT, useTx } from "../lib/i18n";
import { useMoney } from "../lib/currency";
import { actionable } from "../lib/alerts";
import { dayRate, days, longDate, metres, monthLong, monthShort, num, perDayUnit, perTonne, perTonneUnit, pct, shortDate, splitPercents, tonnes, total } from "../lib/format";
import { planNote, plantShort } from "../lib/labels";
import { useAlerts, useCharterPlan, useDrivers, usePlants, usePorts, useSavings, useStress } from "../lib/queries";
import { driversSentence } from "../lib/drivers";
import { signalReason } from "../lib/timing";
import { Link, useSearchParam } from "../lib/router";
import { useShipment } from "../lib/shipment";
import type { CharterPlanResponse, RankedRow, ScheduleResponse, TimingResponse } from "../types";

function PlanCard({
  n,
  title,
  children,
  link,
}: {
  /** The decision's number; left out for supporting cards. */
  n?: number;
  title: string;
  children: ReactNode;
  link?: { to: string; label: string };
}) {
  const tr = useT();
  return (
    <section className="bg-surface border border-rule rounded-[var(--radius-surface)] p-4 md:p-5 break-inside-avoid">
      <h2 className="flex items-baseline gap-3 mb-4">
        {n != null && <span className="text-[13px] font-semibold text-ink-3 tabular-nums">{n}</span>}
        <span className="serif text-[19px] font-semibold text-ink">{tr(title)}</span>
      </h2>
      {children}
      {link && (
        <div className="mt-4 border-t border-rule pt-3 print:hidden">
          <Link to={link.to} className="text-[14px] text-accent underline-offset-4 hover:underline">
            {tr(link.label)} →
          </Link>
        </div>
      )}
    </section>
  );
}

function SideBlock({ title, id, children }: { title: ReactNode; id?: string; children: ReactNode }) {
  const tx = useTx();
  return (
    <section id={id} className="border-t border-ink pt-3">
      <h2 className="serif mb-3 text-[19px] font-semibold text-ink">{tx(title)}</h2>
      {children}
    </section>
  );
}

function timingHeadline(t: TimingResponse, tr: T) {
  if (t.signal === "wait") return tr("Wait until the week of {date}", { date: shortDate(t.best_fix.date) });
  if (t.signal === "stagger") return tr("Fix part now, the rest by {date}", { date: shortDate(t.best_fix.date) });
  return tr("Fix now");
}

function portSwitch(schedule: ScheduleResponse | null, firstPort: string, tr: T) {
  if (!schedule) return "";
  const others = schedule.months.filter((m) => m.port && m.port !== firstPort);
  if (!others.length) return "";
  // Month positions in the contract, so a run like Jan, Feb, Mar reads "Jan–Mar"
  // but Jan, Mar, May stays a list.
  const byPort = new Map<string, { idx: number; month: number }[]>();
  schedule.months.forEach((m, idx) => {
    if (m.port && m.port !== firstPort) byPort.set(m.port, [...(byPort.get(m.port) ?? []), { idx, month: m.month }]);
  });
  const monthsText = (ms: { idx: number; month: number }[]) => {
    const consecutive = ms.every((m, i) => i === 0 || m.idx === ms[i - 1].idx + 1);
    const names = ms.map((m) => tr(monthShort(m.month)));
    if (ms.length > 2 && consecutive) return `${names[0]}–${names[names.length - 1]}`;
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${tr("and")} ${names[names.length - 1]}` : names[0];
  };
  const parts = [...byPort.entries()].map(([p, ms]) => tr("{port} in {months}", { port: tr(p), months: monthsText(ms) }));
  return tr(", switching to {ports}", { ports: parts.join(tr(" and ")) });
}

function verdictFor(plan: CharterPlanResponse, duration: number, tr: T) {
  const top = plan.recommendation!.top;
  const t = plan.timing!;
  const cls = tr(top.vessel_class);
  const port = tr(top.port);
  const main =
    duration > 0
      ? tr("Book {n} months of {cls} voyages into {port}{switch}.", { n: duration, cls, port, switch: portSwitch(plan.schedule, top.port, tr) })
      : top.n_voyages > 1
        ? tr("Use {n} {cls} voyages into {port}.", { n: top.n_voyages, cls, port })
        : tr("Use a {cls} into {port}.", { cls, port });
  const date = shortDate(t.best_fix.date);
  const when =
    t.signal === "fix_now" ? tr("Fix now") : t.signal === "wait" ? tr("Wait until the week of {date} to fix", { date }) : tr("Fix part now and the rest by {date}", { date });
  const [contractPct, spotPct] = splitPercents(t.contract.contract_pct);
  const split = duration > 0 ? tr(", with {c}% on contract and {s}% on the spot market", { c: contractPct, s: spotPct }) : "";
  return { main, support: `${when}${split}.` };
}

export default function CharterPlan() {
  const { shipment, referenceError, retryReference } = useShipment();
  const plan = useCharterPlan(shipment);
  const tr = useT();

  const header = (
    <>
      <PrintHeader />
      <PageHeader
        meta="SAIL coking-coal imports"
        title="Charter plan"
        description="What to book, when to fix it, how much to put on contract, and what could get in the way."
        actions={<PlanActions />}
      />
    </>
  );

  if (referenceError) {
    return (
      <>
        {header}
        <ErrorState message="Couldn't load the list of ports, plants and load ports." onRetry={retryReference} />
      </>
    );
  }
  if (!plan.data || !shipment) {
    if (plan.isError) {
      return (
        <>
          {header}
          <ErrorState message="Couldn't build the charter plan." onRetry={() => void plan.refetch()} />
        </>
      );
    }
    return <PageSkeleton />;
  }

  const data = plan.data;
  if (!data.recommendation || !data.timing) {
    return (
      <>
        {header}
        <EmptyState>
          {tr("No port can take this cargo in {month}. Try another month, load port or cargo size.", { month: monthLong(shipment.month) })}
        </EmptyState>
      </>
    );
  }

  const rec = data.recommendation;
  const top = rec.top;
  const t = data.timing;
  const verdict = verdictFor(data, shipment.duration, tr);

  return (
    <>
      {header}
      <Refreshing active={plan.isPlaceholderData}>
        <Verdict support={verdict.support}>{verdict.main}</Verdict>
        <SavingsCard plan={data} duration={shipment.duration} />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:grid-rows-[auto_1fr] lg:gap-x-10">
          <div className="lg:col-start-1 lg:row-start-1">
            <WhatToCharter plan={data} duration={shipment.duration} month={shipment.month} />
          </div>

          <div className="lg:col-start-2 lg:row-start-1">
            <WatchOut top={top} origin={shipment.origin} />
          </div>

          <div className="space-y-5 lg:col-start-1 lg:row-start-2">
            <WhenToFix t={t} />

            {shipment.duration > 0 ? (
              <ContractCard t={t} voyages={rec.total_voyages} />
            ) : (
              <PlanCard n={3} title="Contract or spot">
                <p className="text-[14.5px] text-ink-2">
                  {tr("This is a single spot voyage. To plan several voyages on a short- or mid-term contract, choose a 3, 6 or 12-month contract in the bar above.")}
                </p>
              </PlanCard>
            )}

            <StressTest plan={data} />

            {data.schedule && <ScheduleCard schedule={data.schedule} />}
          </div>

          <div className="lg:col-start-2 lg:row-start-2">
            <PlantStock plan={data} />
          </div>
        </div>
        <div className="mt-8">
          <PlanCard title="The voyage">
            <VoyageView key={`${shipment.origin}:${top.port}`} origin={shipment.origin} port={top.port} />
          </PlanCard>
        </div>
      </Refreshing>
      <div className="print:hidden">
        <ComparePlans />
      </div>
    </>
  );
}

/** A value that settles `ms` after its last change: sliders don't fire a request per step. */
function useSettled<T>(value: T, ms = 350) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * What if the market or a port turns against the plan: a freight or fuel move,
 * longer berth queues, a port shut. Shows what the recommended option would
 * cost and whether a different vessel or port becomes the better choice.
 */
function StressTest({ plan }: { plan: CharterPlanResponse }) {
  const tr = useT();
  const money = useMoney();
  const { request, shipment } = useShipment();
  const ports = usePorts();
  const [shock, setShock] = useState({ freight_change_pct: 0, bunker_change_pct: 0, extra_wait_days: 0, closed_port: null as string | null });
  const settled = useSettled(shock);
  const q = useStress(
    request && shipment ? { ...request, ...settled, port: shipment.fixedPort ?? null, vessel_class: shipment.fixedClass ?? null } : null
  );
  const top = plan.recommendation!.top;
  const d = q.data;
  const quiet = !shock.freight_change_pct && !shock.bunker_change_pct && !shock.extra_wait_days && !shock.closed_port;
  const set = (patch: Partial<typeof shock>) => setShock((s) => ({ ...s, ...patch }));
  const signed = (v: number) => (v > 0 ? `+${v}%` : `${v}%`);
  return (
    <PlanCard title="Stress test" link={{ to: "/scenarios", label: "More scenarios" }}>
      <p className="mb-4 text-[14.5px] text-ink-2">{tr("Move the market or shut a port and see whether the plan still holds.")}</p>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Slider label="Freight market" value={shock.freight_change_pct} min={-40} max={60} step={5} onChange={(v) => set({ freight_change_pct: v })} format={signed} />
        <Slider label="Bunker fuel price" value={shock.bunker_change_pct} min={-40} max={60} step={5} onChange={(v) => set({ bunker_change_pct: v })} format={signed} />
        <Slider
          label="Extra wait at the discharge port"
          value={shock.extra_wait_days}
          min={0}
          max={15}
          step={1}
          onChange={(v) => set({ extra_wait_days: v })}
          format={(v) => tr("{n} days", { n: v })}
        />
        <div>
          <p className="mb-2 text-[14px] text-ink-2">{tr("Port closed")}</p>
          <Select
            label={tr("Port closed")}
            value={shock.closed_port ?? ""}
            onChange={(v) => set({ closed_port: v || null })}
            options={[{ value: "", label: tr("None") }, ...(ports.data?.ports ?? []).map((p) => ({ value: p.name, label: tr(p.name) }))]}
          />
        </div>
      </div>
      <div className="mt-5 border-t border-rule pt-4" aria-live="polite">
        {q.isError ? (
          <p className="text-[14px] text-negative">{tr("Couldn't run the stress test. Try again in a moment.")}</p>
        ) : !d ? (
          <Skeleton className="h-16 w-full" />
        ) : quiet ? (
          <p className="text-[14px] text-ink-3">{tr("Move a slider to test the plan.")}</p>
        ) : (
          <Refreshing active={q.isPlaceholderData || settled !== shock}>
            <FigureRow>
              {d.same_option ? (
                <Figure
                  label={tr("{cls} into {port}", { cls: tr(top.vessel_class), port: tr(top.port) })}
                  value={perTonne(d.same_option.usd_per_tonne, money)}
                  unit={perTonneUnit()}
                  note={
                    <Delta value={d.same_option.usd_per_tonne - top.usd_per_tonne}>
                      {perTonne(d.same_option.usd_per_tonne - top.usd_per_tonne, money, true)}
                      {perTonneUnit()} {tr("vs the plan")}
                    </Delta>
                  }
                />
              ) : (
                <Figure label={tr("{cls} into {port}", { cls: tr(top.vessel_class), port: tr(top.port) })} value={tr("Port closed")} />
              )}
            </FigureRow>
            {d.best && (
              <div className={`mt-4 rounded-[var(--radius-control)] border px-3 py-2.5 ${d.changed ? "border-caution/40 bg-caution/10" : "border-rule bg-sunken/50"}`}>
                <p className="text-[13px] font-semibold text-ink-3">{tr(d.changed ? "Better choice under this stress" : "Still the best choice")}</p>
                <p className="serif mt-0.5 text-[18px] text-ink">
                  {tr("{cls} into {port}", { cls: tr(d.best.vessel_class), port: tr(d.best.port) })}
                  <span className="ml-2 font-sans text-[14px] tabular-nums text-ink-2">
                    {perTonne(d.best.usd_per_tonne, money)}
                    {perTonneUnit()}
                  </span>
                </p>
              </div>
            )}
            <p className={`mt-3 text-[14px] ${d.changed ? "text-caution" : "text-ink-2"}`}>
              {!d.best
                ? tr("No port can take this cargo under this stress.")
                : d.changed
                  ? tr("Under this stress the plan should switch to {cls} into {port}.", { cls: tr(d.best.vessel_class), port: tr(d.best.port) })
                  : tr("The plan holds: {cls} into {port} is still the cheapest way to the plant.", { cls: tr(top.vessel_class), port: tr(top.port) })}
            </p>
          </Refreshing>
        )}
      </div>
    </PlanCard>
  );
}

/** "8% more to 9% less": a saving range in words, so the sign can't be misread. */
function savingRange(worst: number, best: number, tr: T) {
  const side = (v: number) => (v < 0 ? tr("{p}% more", { p: num(-v, 0) }) : tr("{p}% less", { p: num(v, 0) }));
  return tr("{a} to {b}", { a: side(worst), b: side(best) });
}

/**
 * The plan's answer to SIH26006's goal: what planning this way (the forecast's
 * fixing signal and contract split) has cost against fixing every voyage on
 * the spot market as it comes up, replayed on the freight history.
 */
function SavingsCard({ plan, duration }: { plan: CharterPlanResponse; duration: number }) {
  const tr = useT();
  const money = useMoney();
  const top = plan.recommendation!.top;
  const months = duration > 0 ? duration : 6;
  const q = useSavings(top.vessel_class, months);
  if (q.isError) return null;
  const s = q.data;
  if (!s) return <Skeleton className="mb-8 h-[132px] w-full" />;
  const median = s.median_saving_pct;
  // Hire is the part the timing and contract advice changes.
  const onThisPlan = duration > 0 ? (median / 100) * top.hire_cost_usd * duration : null;
  const since = monthShort(Number(s.first_start.slice(5, 7))) + " " + s.first_start.slice(0, 4);
  const maxAbs = Math.max(1, ...s.windows.map((w) => Math.abs(w.saving_pct)));
  return (
    <section className="mb-8 grid gap-6 rounded-[var(--radius-surface)] border border-rule bg-surface p-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:p-5">
      <div>
        <p className="text-[13px] font-semibold text-ink-3">
          {duration > 0 ? tr("Against fixing every voyage on spot") : tr("A {n}-month contract, planned this way", { n: s.duration_months })}
        </p>
        <p className="serif mt-1 text-[34px] font-semibold leading-none tabular-nums text-ink">
          {median >= 0 ? tr("{p}% lower", { p: num(Math.abs(median), 1) }) : tr("{p}% higher", { p: num(Math.abs(median), 1) })}
        </p>
        <p className="mt-2 text-[14px] text-ink-2">
          {tr("median hire cost for {cls}, {n}-month programmes started since {since}", { cls: tr(top.vessel_class), n: s.duration_months, since })}
        </p>
      </div>
      <div className="min-w-0">
        <FigureRow>
          <Figure label="Cheaper than spot" value={`${num(s.cheaper_share_pct, 0)}%`} note={tr("of {n} start months", { n: s.n_windows })} />
          <Figure label="Range" value={savingRange(s.worst_saving_pct, s.best_saving_pct, tr)} note="worst to best start month" />
          {onThisPlan != null && <Figure label="On this plan, at the median" value={total(onThisPlan, money)} note="less hire than spot" />}
        </FigureRow>
        <div className="mt-4 flex h-10 items-center gap-[2px]" role="img" aria-label={tr("Saving for each start month, from {from} to {to}", { from: shortDate(s.first_start), to: shortDate(s.last_start) })}>
          {s.windows.map((w) => {
            const h = Math.max(2, (Math.abs(w.saving_pct) / maxAbs) * 20);
            return (
              <span key={w.start} className="flex h-full flex-1 flex-col justify-center" title={`${shortDate(w.start)}: ${pct(w.saving_pct, 1, true)}`}>
                <span className="block w-full" style={{ height: 20 }}>
                  {w.saving_pct > 0 && <span className="block w-full rounded-t-[2px] bg-positive" style={{ height: h, marginTop: 20 - h }} />}
                </span>
                <span className="block w-full" style={{ height: 20 }}>
                  {w.saving_pct < 0 && <span className="block w-full rounded-b-[2px] bg-signal-fill/80" style={{ height: h }} />}
                </span>
              </span>
            );
          })}
        </div>
        <p className="mt-1.5 flex justify-between text-[12px] text-ink-3">
          <span>{shortDate(s.first_start)}</span>
          <span>{tr("above the line: cheaper than spot")}</span>
          <span>{shortDate(s.last_start)}</span>
        </p>
      </div>
    </section>
  );
}

/** The fixture terms the plan was built on: grade, laycan, tolerance, the planner's fixed choices. */
function FixtureLine({ plan, top }: { plan: CharterPlanResponse; top: RankedRow }) {
  const tr = useT();
  const { shipment, reference } = useShipment();
  if (!shipment) return null;
  const parts: string[] = [];
  if (shipment.grade) parts.push(tr(reference?.coal_grades.find((g) => g.value === shipment.grade)?.label ?? ""));
  parts.push(tr("laycan {from} to {to}", { from: shortDate(plan.laycan.start), to: shortDate(plan.laycan.end) }));
  if (shipment.tolerancePct) {
    const short = top.n_voyages * top.payload_tonnes < shipment.cargoTonnes;
    parts.push(
      short
        ? tr("±{p}%: ships {t} to save a voyage", { p: shipment.tolerancePct, t: tonnes(top.cargo_shipped_tonnes) })
        : tr("±{p}% more or less", { p: shipment.tolerancePct })
    );
  }
  if (shipment.fixedClass) parts.push(tr("vessel type fixed by you"));
  if (shipment.fixedPort) parts.push(tr("port fixed by you"));
  return <p className="mt-1 text-[13.5px] text-ink-3">{parts.join(" · ")}</p>;
}

function WhatToCharter({ plan, duration, month }: { plan: CharterPlanResponse; duration: number; month: number }) {
  const money = useMoney();
  const rec = plan.recommendation!;
  const top = rec.top;
  const next = rec.alternatives[0];
  const perTonneOver = rec.usd_per_tonne_over_contract;
  const cheapest = rec.cheapest_single;
  const tr = useT();
  const { reference } = useShipment();
  const vessel = reference?.vessel_classes.find((v) => v.name === top.vessel_class);
  // A part-loaded ship floats higher: the draft that leaves its cargo shortfall behind.
  const ports = usePorts();
  const port = ports.data?.ports.find((p) => p.name === top.port);
  // The port's charted depth, less its monsoon reduction in a monsoon month.
  const usable = port ? port.max_draft_m - (port.monsoon_months.includes(month) ? port.monsoon_draft_reduction_m : 0) : undefined;
  const [view, setView] = useSearchParam("view");
  const atBerth = view === "berth";
  const loadedDraft =
    vessel && top.part_loaded && vessel.tpc_t_per_cm
      ? vessel.draft_laden_m - (vessel.payload_tonnes - top.payload_tonnes) / (vessel.tpc_t_per_cm * 100)
      : null;
  return (
    <PlanCard n={1} title="What to charter" link={{ to: "/vessel-port", label: "Compare every vessel and port" }}>
      <p className="serif text-[21px] text-ink">
        {tr("{cls} into {port}", { cls: tr(top.vessel_class), port: tr(top.port) })}
      </p>
      <p className="mt-0.5 text-[14px] text-ink-3">
        {top.n_voyages > 1
          ? tr("{n} voyages of up to {t} t per shipment", { n: top.n_voyages, t: num(top.payload_tonnes) })
          : tr("One voyage per shipment, ship {pct}% full", { pct: num(top.vessel_fill_pct, 0) })}
        {top.part_loaded && tr(", part-loaded for the draft")}
      </p>
      <FixtureLine plan={plan} top={top} />
      <div className="mt-5">
        <FigureRow>
          <Figure
            label={duration > 0 ? "Landed cost, contract average" : "Landed cost"}
            value={perTonne(perTonneOver, money)}
            unit={perTonneUnit()}
          />
          <Figure
            label={duration > 0 ? tr("Over {n} months", { n: duration }) : "Shipment total"}
            value={total(rec.total_usd_over_contract, money)}
            note={duration > 0 ? tr("{n} voyages", { n: rec.total_voyages }) : undefined}
          />
          <Figure label="At the plant in" value={days(top.total_lead_days)} note="from loading" />
        </FigureRow>
      </div>
      {next && (
        <p className="mt-5 text-[14px] text-ink-2">
          {rec.basis === "contract"
            ? tr("Next best for the whole contract: {cls},", { cls: tr(next.vessel_class) })
            : tr("Next best: {cls}, {port},", { cls: tr(next.vessel_class), port: tr(next.port) })}{" "}
          <Delta value={next.usd_per_tonne_over_contract - perTonneOver}>
            {perTonne(next.usd_per_tonne_over_contract - perTonneOver, money, true)}
            {perTonneUnit()}
          </Delta>
        </p>
      )}
      {cheapest && rec.basis === "contract" && (
        <p className="mt-2 text-[14px] text-ink-2">
          {tr("For {month} alone a {cls} into {port} is {diff} cheaper, but it can't be held for every month of the contract as cheaply.", {
            month: monthLong(month),
            cls: tr(cheapest.vessel_class),
            port: tr(cheapest.port),
            diff: perTonne(top.usd_per_tonne - cheapest.usd_per_tonne, money) + perTonneUnit(),
          })}
        </p>
      )}
      {rec.note && <p className="mt-2 text-[14px] text-caution">{planNote(rec.note, tr)}</p>}
      {vessel && (
        <div className="mt-5 overflow-hidden rounded-[var(--radius-control)] bg-sunken">
          {port && (
            <div className="flex items-center justify-end border-b border-rule bg-surface px-2 py-1.5 print:hidden">
              <Segmented
                label={tr("Where to see it")}
                value={atBerth ? "berth" : "sea"}
                onChange={(v) => setView(v === "berth" ? "berth" : null)}
                options={[
                  { value: "sea", label: tr("At sea") },
                  { value: "berth", label: tr("At {port}", { port: tr(top.port) }) },
                ]}
              />
            </div>
          )}
          {atBerth && port ? (
            <ShipAtPort
              port={port}
              spec={toSpec(vessel)}
              draft={loadedDraft ?? vessel.draft_laden_m}
              usable={usable ?? port.max_draft_m}
              label={tr("{cls} at the berth at {port}, drawing {draft}", {
                cls: vessel.name,
                port: tr(top.port),
                draft: metres(loadedDraft ?? vessel.draft_laden_m),
              })}
              height={280}
            />
          ) : (
            <ShipView
              spec={toSpec(vessel)}
              limit={loadedDraft}
              label={tr("{cls}: {loa} long, {beam} wide, {draft} laden draft", {
                cls: vessel.name,
                loa: metres(vessel.loa_m),
                beam: metres(vessel.beam_m),
                draft: metres(loadedDraft ?? vessel.draft_laden_m),
              })}
              height={200}
            />
          )}
        </div>
      )}
    </PlanCard>
  );
}

function WhenToFix({ t }: { t: TimingResponse }) {
  const money = useMoney();
  const drivers = useDrivers();
  const tr = useT();
  // Only big moves in coal or oil are worth a line here.
  const market = driversSentence((drivers.data?.drivers ?? []).filter((d) => d.key !== "usd_inr"), 10, tr);
  // "Fix now" means no week is worth waiting for, so no week is marked.
  const marked = t.signal !== "fix_now" && t.best_fix.week_index > 0;
  return (
    <PlanCard n={2} title={tr("When to fix {cls}", { cls: tr(t.vessel_class) })} link={{ to: "/freight-outlook", label: "Freight outlook" }}>
      <p className="text-[17px] font-semibold text-ink">{timingHeadline(t, tr)}</p>
      <p className="mt-1 text-[14px] text-ink-2">{signalReason(t, tr)}</p>
      {market && <p className="mt-1 text-[14px] text-ink-2">{market}</p>}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-[14px]">
          <dt className="text-ink-3">{tr("Today")}</dt>
          <dd className="text-right text-ink">
            {dayRate(t.current_rate, money)}
            <span className="text-ink-3">{perDayUnit()}</span>
          </dd>
          {marked ? (
            <>
              <dt className="text-ink-3">{tr("Week of {date}", { date: shortDate(t.best_fix.date) })}</dt>
              <dd className="text-right text-ink">
                {dayRate(t.best_fix.expected_rate, money)}
                <span className="text-ink-3">{perDayUnit()}</span>
              </dd>
              <dt className="text-ink-3">{tr("Expected saving")}</dt>
              <dd className="text-right text-ink">{pct(t.best_fix.saving_vs_now_pct, 1)}</dd>
            </>
          ) : (
            <>
              <dt className="text-ink-3">{tr("In {n} weeks", { n: t.window_weeks })}</dt>
              <dd className="text-right text-ink">
                {dayRate(t.forecast[Math.min(t.window_weeks, t.forecast.length) - 1].forecast, money)}
                <span className="text-ink-3">{perDayUnit()}</span>
              </dd>
            </>
          )}
        </dl>
        <div>
          <ForecastSparkline
            current={t.current_rate}
            points={t.forecast.slice(0, t.window_weeks).map((p) => p.forecast)}
            bestIndex={marked ? t.best_fix.week_index : null}
          />
          <p className="mt-1 text-[12.5px] text-ink-3">
            {tr("Next {n} weeks", { n: t.window_weeks })}
            {marked && ` · ${tr("ringed: best week")}`}
          </p>
        </div>
      </div>
    </PlanCard>
  );
}

function ContractCard({ t, voyages }: { t: TimingResponse; voyages: number }) {
  const [contractPct, spotPct] = splitPercents(t.contract.contract_pct);
  const tr = useT();
  return (
    <PlanCard n={3} title="Contract or spot" link={{ to: "/freight-outlook#contract", label: "How the split is worked out" }}>
      <p className="mb-3 text-[15px] text-ink">
        {tr("Fix {c}% of the {n} voyages on contract at today's rate and leave {s}% for the spot market.", { c: contractPct, n: voyages, s: spotPct })}
      </p>
      <SplitBar
        parts={[
          { label: "Contract", pct: t.contract.contract_pct, color: "var(--color-series-1)" },
          { label: "Spot", pct: t.contract.spot_pct, color: "var(--color-series-2)" },
        ]}
      />
      <HireComparison t={t} />
    </PlanCard>
  );
}

function ScheduleCard({ schedule }: { schedule: ScheduleResponse }) {
  const money = useMoney();
  const tr = useT();
  const missing = schedule.months.filter((m) => !m.port);
  return (
    <PlanCard n={4} title="Voyage schedule" link={{ to: "/scenarios", label: "Test what could change" }}>
      <ScheduleStrip months={schedule.months} />
      {schedule.note && <p className="mt-3 text-[14px] text-caution">{planNote(schedule.note, tr)}</p>}
      <p className="mt-3 text-[14px] text-ink-2">
        {tr("{n} voyages carrying {t} for {total} landed.", {
          n: schedule.totals.voyages,
          t: tonnes(schedule.totals.cargo_tonnes),
          total: total(schedule.totals.contract_total_usd, money),
        })}{" "}
        {schedule.totals.flexibility_cost_usd > 1
          ? tr("Keeping one vessel class for the whole contract costs {x} more than choosing freely each month.", {
              x: total(schedule.totals.flexibility_cost_usd, money),
            })
          : tr("Keeping one vessel class for the whole contract costs nothing extra.")}
      </p>
      {schedule.totals.spot_total_usd !== null && (
        <SpotVsFixed fixed={schedule.totals.contract_total_usd} spot={schedule.totals.spot_total_usd} />
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-[14px] text-negative">
          {tr("No port and vessel type can take the cargo in {months}; those months are left out of the totals.", {
            months: missing.map((m) => monthLong(m.month)).join(", "),
          })}
        </p>
      )}
    </PlanCard>
  );
}

/** Fixing the whole contract now at today's rate, against fixing each month on
 *  the spot market at that month's forecast rate. */
function SpotVsFixed({ fixed, spot }: { fixed: number; spot: number }) {
  const money = useMoney();
  const tr = useT();
  const diff = spot - fixed;
  const share = fixed > 0 ? Math.abs(diff) / fixed : 0;
  return (
    <p className="mt-2 text-[14px] text-ink-2">
      {share < 0.005
        ? tr("Fixed now or bought month by month on the spot market at the forecast rates, the contract costs about the same.")
        : diff > 0
          ? tr("Month by month on the spot market it would cost about {x} more at the forecast rates ({p}), which favours fixing now.", {
              x: total(diff, money),
              p: pct(share * 100, 1),
            })
          : tr("Month by month on the spot market it would cost about {x} less at the forecast rates ({p}), which favours keeping part on spot.", {
              x: total(-diff, money),
              p: pct(share * 100, 1),
            })}
    </p>
  );
}

function HireComparison({ t }: { t: TimingResponse }) {
  const money = useMoney();
  const tr = useT();
  const label = (s: string) =>
    /^Recommended/i.test(s) ? "Recommended split" : /^100% spot/i.test(s) ? "All spot" : "All contract";
  return (
    <dl className="mt-4 divide-y divide-rule border-y border-rule text-[14px]">
      {t.contract.cost_comparison.map((c) => (
        <div key={c.strategy} className="flex justify-between gap-4 py-2">
          <dt className={/^Recommended/i.test(c.strategy) ? "font-semibold text-ink" : "text-ink-2"}>{tr(label(c.strategy))}</dt>
          <dd className="text-ink">{tr("{x} hire", { x: total(c.estimated_hire_cost_usd, money) })}</dd>
        </div>
      ))}
    </dl>
  );
}

function WatchOut({ top, origin }: { top: RankedRow; origin: string }) {
  const thresholds = useThresholds();
  const alerts = useAlerts({ port: top.port, vesselClass: top.vessel_class, origin }, thresholds);
  const list = alerts.data?.alerts ?? [];
  const count = actionable(list).length;
  const tr = useT();
  const empty = tr("Nothing to flag for {port}, the loading port or {cls} rates.", { port: tr(top.port), cls: tr(top.vessel_class) });
  return (
    <SideBlock
      id="watch-out"
      title={
        <span className="flex items-baseline justify-between gap-3">
          <span>{tr("Watch out")}</span>
          <span className="flex items-baseline gap-3 text-[13px] font-normal text-ink-3">
            {alerts.data && (count === 1 ? tr("{n} alert", { n: 1 }) : tr("{n} alerts", { n: count }))}
            <AlertSettings />
          </span>
        </span>
      }
    >
      {!alerts.data ? (
        alerts.isError ? (
          <ErrorState message="Couldn't check for alerts." onRetry={() => void alerts.refetch()} />
        ) : (
          <Skeleton className="h-16 w-full" />
        )
      ) : (
        <Refreshing active={alerts.isPlaceholderData}>
          <div className="print:hidden">
            <AlertList alerts={list} limit={3} empty={empty} />
          </div>
          <div className="hidden print:block">
            <AlertList alerts={list} forceExpanded empty={empty} />
          </div>
        </Refreshing>
      )}
      <div className="mt-3 print:hidden">
        <Link to="/ports" className="text-[14px] text-accent underline-offset-4 hover:underline">
          {tr("Conditions at every port")} →
        </Link>
      </div>
    </SideBlock>
  );
}

const STATUS_LABEL = { ok: "On target", below_buffer: "Below target", critical: "Critical" } as const;

/** The plant's stock figure in use, and a way to enter the real one (saved for this planner). */
function StockFigure({ cover }: { cover: NonNullable<CharterPlanResponse["plant"]> }) {
  const tr = useT();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cover.current_inventory_tonnes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (tonnesValue: number | null) => {
    setBusy(true);
    setError(null);
    try {
      await putPlantStock(cover.name, tonnesValue);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["charter-plan"] }),
        qc.invalidateQueries({ queryKey: ["plants"] }),
        qc.invalidateQueries({ queryKey: ["employment"] }),
      ]);
      setEditing(false);
    } catch {
      setError(tr("Couldn't save. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };
  const mine = cover.stock_source === "yours";
  return (
    <div className="mt-4 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-[13.5px]">
      {editing ? (
        <div className="space-y-2">
          <NumberField label="Coking coal in stock" value={value} onCommit={setValue} min={0} max={5_000_000} step={5000} unit="t" />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => save(value)} disabled={busy}>
              {tr("Save")}
            </Button>
            {mine && (
              <Button variant="text" onClick={() => save(null)} disabled={busy}>
                {tr("Use the reference figure")}
              </Button>
            )}
            <Button variant="text" onClick={() => setEditing(false)}>
              {tr("Cancel")}
            </Button>
          </div>
          {error && <p className="text-negative">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-ink-2">
            {mine
              ? tr("Your figure: {t} (updated {date}).", { t: tonnes(cover.current_inventory_tonnes), date: longDate(cover.stock_updated_at ?? "") })
              : tr("Reference figure: {t}. Enter the plant's actual stock for a real answer.", { t: tonnes(cover.current_inventory_tonnes) })}
          </span>
          <Button
            variant="text"
            onClick={() => {
              setValue(cover.current_inventory_tonnes);
              setEditing(true);
            }}
          >
            {mine ? tr("Update") : tr("Enter stock")}
          </Button>
        </div>
      )}
    </div>
  );
}

function PlantStock({ plan }: { plan: CharterPlanResponse }) {
  const money = useMoney();
  const tr = useT();
  const plants = usePlants();
  const p = plan.plant;
  const top = plan.recommendation!.top;
  return (
    <SideBlock title="Plant stock">
      {p && p.days_of_cover !== null ? (
        <>
          <p className="text-[14.5px] text-ink">
            {tr("{plant} has {cover} of coking coal against a {target} target.", {
              plant: plantShort(p.name),
              cover: days(p.days_of_cover),
              target: days(p.buffer_days_target),
            })}
          </p>
          <div className="mt-3">
            <StockMeter cover={p.days_of_cover} target={p.buffer_days_target} arrival={p.arrival_in_days} />
          </div>
          <StockFigure cover={p} />
          {p.days_until_laycan > 0 && (
            <p className="mt-3 text-[13.5px] text-ink-2">
              {tr("The laycan opens {date}; the first cargo then reaches the plant in about {lead}.", {
                date: longDate(plan.laycan.start),
                lead: days(p.lead_days),
              })}
            </p>
          )}
          {p.stockout_before_arrival ? (
            <div className="mt-4 border-l-[3px] border-negative pl-3 text-[14px] text-ink">
              {tr("The first cargo arrives about {d} after stock runs out.", { d: days(p.days_short ?? 0) })}
              {p.fastest_option ? (
                <span className="mt-1 block text-ink-2">
                  {tr("Fastest option: {cls} into {port}, at the plant in {d} ({diff}).", {
                    cls: tr(p.fastest_option.vessel_class),
                    port: tr(p.fastest_option.port),
                    d: days(p.fastest_option.total_lead_days),
                    diff: perTonne(p.fastest_option.usd_per_tonne - top.usd_per_tonne, money, true) + perTonneUnit(),
                  })}
                  {p.fastest_option.total_lead_days > p.days_of_cover &&
                    " " +
                      tr("Even that arrives about {d} late, so bridge the gap from another plant's stock or by rail.", {
                        d: days(p.fastest_option.total_lead_days - p.days_of_cover),
                      })}
                </span>
              ) : (
                <span className="mt-1 block text-ink-2">{tr("No faster sea route is available; draw on another plant's stock or rail.")}</span>
              )}
            </div>
          ) : (
            <p className="mt-4 text-[14px] text-ink-2">
              {p.fix_by_date
                ? tr("Fixed today, stock lasts until the first cargo arrives with {d} to spare; fix by {date} at the latest.", {
                    d: days(p.days_to_fix ?? 0),
                    date: longDate(p.fix_by_date),
                  })
                : tr("Fixed today, stock lasts until the first cargo arrives with {d} to spare.", { d: days(p.days_to_fix ?? 0) })}
            </p>
          )}
          {p.tonnes_to_buffer > 0 && (
            <p className="mt-2 text-[13.5px] text-ink-3">{tr("{t} more would bring it up to target.", { t: tonnes(p.tonnes_to_buffer) })}</p>
          )}
          {p.cover_gap_days !== null && p.cover_gap_days >= 7 && (
            <p className="mt-3 text-[13.5px] text-ink-2">
              {tr("Stock is {d} above target, so a chartered ship may not be needed straight away.", { d: days(p.cover_gap_days) })}{" "}
              <Link to="/scenarios#employment" className="text-accent underline-offset-4 hover:underline">
                {tr("Keep it earning")} →
              </Link>
            </p>
          )}
        </>
      ) : (
        <p className="text-[14px] text-ink-2">{tr("No stock figures for this plant.")}</p>
      )}
      {plants.data && (
        <dl className="mt-5 divide-y divide-rule border-y border-rule text-[14px]">
          {plants.data.plants.map((pl) => (
            <div key={pl.name} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className={pl.name === p?.name ? "font-semibold text-ink" : "text-ink-2"}>{plantShort(pl.name)}</dt>
              <dd className="flex items-baseline gap-2 text-ink">
                {pl.days_of_cover !== null ? days(pl.days_of_cover) : "–"}
                <span className="text-ink-3">/ {days(pl.buffer_days_target)}</span>
                <span
                  className={`min-w-[88px] text-right text-[12.5px] font-semibold ${
                    pl.status === "ok" ? "text-positive" : pl.status === "critical" ? "text-negative" : "text-caution"
                  }`}
                >
                  {tr(STATUS_LABEL[pl.status])}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </SideBlock>
  );
}
