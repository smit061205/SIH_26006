import { type T, useT } from "../lib/i18n";
import { Info } from "lucide-react";
import { useState } from "react";
import { FreightChart, type HistoryRange } from "../components/charts/FreightChart";
import { InlineBar, SplitBar } from "../components/ui/bars";
import { EmptyState, ErrorState, PageSkeleton, Refreshing, Skeleton } from "../components/ui/feedback";
import { Delta, Figure, FigureRow, Verdict } from "../components/ui/figures";
import { Button, Field, Segmented, Select } from "../components/ui/inputs";
import { PageHeader, Section } from "../components/ui/layout";
import { Tooltip } from "../components/ui/overlay";
import { MobileItem, MobileList, Table, Td, Th, Tr } from "../components/ui/table";
import { useMoney } from "../lib/currency";
import { type Money, dayRate, longDate, monthLong, num, pct, perDayUnit, perTonne, perTonneUnit, shortDate, splitPercents, total } from "../lib/format";
import { MODEL_NAMES, originParts } from "../lib/labels";
import { useBacktest, useCharterPlan, useDrivers, useForecast, useRouteFreight, useRouteSeries, useTiming } from "../lib/queries";
import { DriverCards } from "../components/ui/drivers";
import { driversSentence } from "../lib/drivers";
import { signalReason } from "../lib/timing";
import { useChoiceParam, useNumberParam, useSearchParam } from "../lib/router";
import { DURATIONS, useShipment } from "../lib/shipment";
import type { ForecastResponse, RouteFreightRange, RouteFreightRow, TimingResponse } from "../types";

const HORIZONS = [8, 12, 16, 26] as const;
const RANGES = ["6m", "1y", "2y"] as const;
const FALLBACK_CLASSES = ["Handysize", "Supramax", "Panamax", "Post-Panamax", "Capesize"];

function outlookSentence(change: number, weeks: number, cls: string, tr: T) {
  const c = tr(cls);
  if (change < -5) return tr("{cls} rates are expected to fall about {pct} over the next {n} weeks.", { cls: c, pct: pct(Math.abs(change), 0), n: weeks });
  if (change > 5) return tr("{cls} rates are expected to rise about {pct} over the next {n} weeks.", { cls: c, pct: pct(change, 0), n: weeks });
  return tr("{cls} rates are expected to hold roughly flat over the next {n} weeks.", { cls: c, n: weeks });
}

function timingVerdict(t: TimingResponse, raw: string, tr: T) {
  const date = shortDate(t.best_fix.date);
  const cls = tr(raw);
  if (t.signal === "wait") return tr("Wait until the week of {date} to fix {cls}.", { date, cls });
  if (t.signal === "stagger") return tr("Fix part of the {cls} tonnage now and the rest by {date}.", { cls, date });
  return tr("Fix {cls} now.", { cls });
}

export default function FreightOutlook() {
  const money = useMoney();
  const tr = useT();
  const { shipment, reference, update } = useShipment();
  const plan = useCharterPlan(shipment);

  // Default to the vessel type the charter plan recommends; wait for the plan
  // rather than fetching another type's forecast first. An explicit choice
  // is always written to the URL, so it survives the plan loading. Every
  // type has its own forecast (Post-Panamax is the Panamax index times its
  // premium), so the chart, today's rate and the timing advice agree.
  const classes = reference?.vessel_classes.map((v) => v.name) ?? FALLBACK_CLASSES;
  const planned = plan.data?.recommendation?.top.vessel_class;
  const [clsParam, setClsParam] = useSearchParam("vtype");
  const chosen = classes.includes(clsParam ?? "") ? clsParam! : undefined;
  const planSettled = !!plan.data || plan.isError || !shipment;
  const cls: string | undefined = chosen ?? planned ?? (planSettled ? "Capesize" : undefined);
  const setCls = (v: string) => setClsParam(v);
  const [horizon, setHorizon] = useNumberParam("h", 12, (n) => (HORIZONS as readonly number[]).includes(n));
  const [range, setRange] = useChoiceParam<HistoryRange>("range", "1y", RANGES);
  const duration = shipment?.duration ?? 6;

  const forecast = useForecast(horizon, cls ?? null);
  const top = plan.data?.recommendation?.top;
  const usesPlannedVessel = top && top.vessel_class === cls;
  // Same hire days as the charter plan, so both pages show the same split and costs.
  const hireDays = top ? top.transit_days + top.expected_wait_days + top.weather_days + top.berth_days + top.load_days : 20;
  const timing = useTiming(
    shipment && cls
      ? {
          vesselClass: cls,
          durationMonths: duration,
          nVoyages: usesPlannedVessel ? plan.data!.recommendation!.total_voyages : Math.max(1, duration),
          hireDays,
          cargoTotal: shipment.cargoTonnes * Math.max(1, duration),
        }
      : null
  );

  const header = (
    <PageHeader
      meta="Up to 26 weeks ahead"
      title="Freight outlook"
      description="Time-charter rates for each vessel type, the best week to fix, and how much to put on contract."
    />
  );

  if (!forecast.data || !cls) {
    if (forecast.isError) {
      return (
        <>
          {header}
          <ErrorState message="Couldn't load the freight-rate forecast." onRetry={() => void forecast.refetch()} />
        </>
      );
    }
    return <PageSkeleton />;
  }

  const data = forecast.data;
  const last = data.forecast[data.forecast.length - 1];
  const change = ((last.forecast - data.current_rate) / data.current_rate) * 100;
  const t = timing.data;
  // Only mark a week when it's worth waiting for; "fix now" has none.
  const marked = !!t && t.signal !== "fix_now" && t.best_fix.week_index > 0;
  const bestWeek = marked ? { date: t.best_fix.date, rate: t.best_fix.expected_rate } : undefined;

  return (
    <>
      {header}
      <div className="mb-8 flex flex-wrap items-end gap-x-8 gap-y-4">
        <Field label="Vessel type">
          <div className="hidden lg:block">
            <Segmented label="Vessel type" value={cls} onChange={setCls} options={classes.map((s) => ({ value: s, label: s }))} />
          </div>
          <div className="lg:hidden">
            <Select
              label="Vessel type"
              value={cls}
              onChange={setCls}
              options={classes.map((s) => ({ value: s, label: s }))}
              className="w-[180px]"
            />
          </div>
        </Field>
        <Field label="Horizon">
          <Segmented
            label="Forecast horizon"
            value={String(horizon)}
            onChange={(v) => setHorizon(Number(v))}
            options={HORIZONS.map((h) => ({ value: String(h), label: tr("{n} wk", { n: h }) }))}
          />
        </Field>
        <Field label="Contract">
          <Segmented
            label="Contract length"
            value={String(duration)}
            onChange={(v) => update({ duration: Number(v) })}
            options={DURATIONS.map((d) => ({ value: String(d), label: d === 0 ? "Spot" : tr("{n} mo", { n: d }) }))}
          />
        </Field>
      </div>

      <Refreshing active={forecast.isPlaceholderData || timing.isPlaceholderData}>
        {t ? (
          <Verdict support={`${outlookSentence(change, horizon, cls, tr)} ${signalReason(t, tr)}`}>
            {timingVerdict(t, cls, tr)}
          </Verdict>
        ) : timing.isError ? (
          <div className="mb-8">
            <ErrorState message="Couldn't work out when to fix." onRetry={() => void timing.refetch()} />
          </div>
        ) : (
          <Skeleton className="mb-8 h-16 w-full max-w-2xl" />
        )}
        <FigureRow>
          <Figure
            label="Today"
            value={dayRate(data.current_rate, money)}
            unit={perDayUnit()}
            note={tr("Week of {date}", { date: longDate(data.as_of) })}
          />
          <Figure
            label="Best week to fix"
            value={t ? (marked ? shortDate(t.best_fix.date) : tr("Now")) : "–"}
            note={
              marked
                ? tr("{rate}, {pct} below today", { rate: dayRate(t.best_fix.expected_rate, money) + perDayUnit(), pct: pct(t.best_fix.saving_vs_now_pct, 1) })
                : tr("No week in the next {n} is worth waiting for", { n: t?.window_weeks ?? 12 })
            }
          />
          <Figure
            label={tr("Likely range in {n} weeks", { n: horizon })}
            value={
              <span className="text-[20px] md:text-[24px]">
                {dayRate(last.lower, money)} – {dayRate(last.upper, money)}
              </span>
            }
            note={tr("80% of outcomes, {model}", { model: tr(data.model_label) })}
          />
          <Figure
            label="Change"
            value={<Delta value={Math.abs(change) < 1 ? 0 : change} goodWhen="negative">{pct(change, 1, true)}</Delta>}
            note={tr("in {n} weeks, lower is cheaper", { n: horizon })}
          />
        </FigureRow>

        <Section
          title={tr("{cls} time-charter rate", { cls: tr(cls) })}
          description="Weekly, per day of hire."
          actions={
            <Segmented
              label="History shown"
              value={range}
              onChange={setRange}
              options={[
                { value: "6m", label: "6 months" },
                { value: "1y", label: "1 year" },
                { value: "2y", label: "2 years" },
              ]}
            />
          }
        >
          <RateChartPanel data={data} range={range} money={money} bestWeek={bestWeek} />
        </Section>
        <ForecastBehind data={data} />
      </Refreshing>

      <RouteFreight cls={cls} />
      <MarketDrivers />
      <ContractCover timing={timing.data} loading={timing.isLoading} error={timing.isError} retry={() => void timing.refetch()} duration={duration} cls={cls} />
      <ModelAccuracy horizon={horizon} cls={cls} used={data.model} usedLabel={data.model_label} />
    </>
  );
}

function RateChartPanel({
  data,
  range,
  money,
  bestWeek,
}: {
  data: ForecastResponse;
  range: HistoryRange;
  money: Money;
  bestWeek?: { date: string; rate: number };
}) {
  const tr = useT();
  const [asTable, setAsTable] = useState(false);
  const rows = [
    ...data.forecast.map((f) => ({ date: f.date, kind: tr("Forecast"), value: f.forecast, lower: f.lower, upper: f.upper })),
    ...data.history.map((h) => ({ date: h.date, kind: tr("Actual"), value: h.actual, lower: undefined, upper: undefined })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="bg-surface border border-rule rounded-[var(--radius-surface)] p-4 md:p-5">
      {asTable ? (
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-[14px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-[12.5px] text-ink-3">
                <th className="py-2 text-left font-semibold">{tr("Week of")}</th>
                <th className="py-2 text-left font-semibold">{tr("Series")}</th>
                <th className="py-2 text-right font-semibold">{tr("Rate /day")}</th>
                <th className="py-2 text-right font-semibold">{tr("80% range")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.date}`} className="border-t border-rule">
                  <td className="py-1.5 text-ink-2">{longDate(r.date)}</td>
                  <td className="py-1.5 text-ink-3">{r.kind}</td>
                  <td className="py-1.5 text-right text-ink">{dayRate(r.value, money)}</td>
                  <td className="py-1.5 text-right text-ink-3">
                    {r.lower !== undefined && r.upper !== undefined ? `${dayRate(r.lower, money)} – ${dayRate(r.upper, money)}` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <FreightChart data={data} range={range} money={money} height={360} bestWeek={bestWeek} />
          </div>
          <div className="md:hidden">
            <FreightChart data={data} range={range} money={money} height={260} bestWeek={bestWeek} />
          </div>
        </>
      )}
      <div className="mt-3 flex justify-end border-t border-rule pt-3">
        <Button variant="text" onClick={() => setAsTable((v) => !v)}>
          {tr(asTable ? "Show chart" : "Show as table")}
        </Button>
      </div>
    </div>
  );
}

function strategyLabel(s: string) {
  if (/^Recommended/i.test(s)) return "Recommended split";
  if (/^100% spot/i.test(s)) return "All spot, at the forecast rate";
  return "All contract, at today's rate";
}

function ContractCover({
  timing,
  loading,
  error,
  retry,
  duration,
  cls,
}: {
  timing: TimingResponse | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
  duration: number;
  cls: string;
}) {
  const money = useMoney();
  const tr = useT();
  const split = timing?.contract;
  const recommended = split?.cost_comparison.find((c) => /^Recommended/i.test(c.strategy));
  const voyages = split?.n_voyages ?? 1;

  return (
    <Section
      id="contract"
      title={duration > 0 ? "Contract or spot" : "Fix now or later"}
      description={
        duration > 0
          ? tr("How much of {n} months of {cls} voyages ({v}) to fix at today's rate rather than buy at the spot rate later.", { n: duration, cls: tr(cls), v: voyages })
          : tr("For a single {cls} voyage: fix it at today's rate, or later at the forecast rate.", { cls: tr(cls) })
      }
    >
      {!split ? (
        error ? (
          <ErrorState message="Couldn't calculate the contract split." onRetry={retry} />
        ) : (
          loading && <Skeleton className="h-40 w-full" />
        )
      ) : duration === 0 ? (
        <SingleVoyageCost timing={timing!} />
      ) : (
        <div className="grid grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
          <div className="order-1 min-w-0">
            <Verdict size="sm">
              {tr("Fix {c}% on contract and leave {s}% on the spot market.", { c: splitPercents(split.contract_pct)[0], s: splitPercents(split.contract_pct)[1] })}
            </Verdict>
            <SplitBar
              parts={[
                { label: "Contract", pct: split.contract_pct, color: "var(--color-series-1)" },
                { label: "Spot", pct: split.spot_pct, color: "var(--color-series-2)" },
              ]}
            />
            <div className="mt-6 hidden sm:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Strategy</Th>
                    <Th align="right">On contract</Th>
                    <Th align="right">{voyages === 1 ? tr("Hire, one voyage") : tr("Hire, {n} voyages", { n: voyages })}</Th>
                    <Th align="right">vs recommended</Th>
                  </tr>
                </thead>
                <tbody>
                  {split.cost_comparison.map((c) => {
                    const isRec = /^Recommended/i.test(c.strategy);
                    const diff = recommended ? c.estimated_hire_cost_usd - recommended.estimated_hire_cost_usd : 0;
                    return (
                      <Tr key={c.strategy} mark={isRec ? "signal" : "none"}>
                        <Td className={isRec ? "font-semibold" : ""}>{tr(strategyLabel(c.strategy))}</Td>
                        <Td align="right" className="text-ink-2">{pct(c.contract_pct, 0)}</Td>
                        <Td align="right">{total(c.estimated_hire_cost_usd, money)}</Td>
                        <Td align="right" className="text-ink-2">
                          {isRec ? "–" : <Delta value={diff}>{total(diff, money, true)}</Delta>}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <div className="mt-6 sm:hidden">
              <MobileList>
                {split.cost_comparison.map((c) => (
                  <MobileItem key={c.strategy} mark={/^Recommended/i.test(c.strategy) ? "signal" : "none"}>
                    <div className="flex justify-between gap-3">
                      <span className="text-ink">{tr(strategyLabel(c.strategy))}</span>
                      <span className="font-semibold text-ink">{total(c.estimated_hire_cost_usd, money)}</span>
                    </div>
                    <div className="mt-0.5 text-[13.5px] text-ink-3">{tr("{pct} on contract", { pct: pct(c.contract_pct, 0) })}</div>
                  </MobileItem>
                ))}
              </MobileList>
            </div>
          </div>
          <p className="order-2 min-w-0 text-[14px] leading-relaxed text-ink-3 lg:border-l lg:border-rule lg:pl-6">
            {tr("Over the contract, rates are expected to change {chg}, with a likely range spanning {band} of today's rate. A rising forecast moves the split toward contract, a falling one toward spot; the wider the range, the closer it stays to half and half.", {
              chg: pct(split.expected_change_pct * 100, 1, true),
              band: pct(split.band_width_pct * 100, 0),
            })}
          </p>
        </div>
      )}
    </Section>
  );
}

/** Why the forecast goes where it does: the rate's momentum, its usual season and its level, and for the drivers model, what it leans on. */
function ForecastBehind({ data }: { data: ForecastResponse }) {
  const tr = useT();
  const f = data.explain.factors;
  const importance = data.explain.importance;
  return (
    <Section title="What's behind this forecast" description="The rate's recent momentum, its usual move at this time of year and its level against the last three years.">
      <p className="mb-5 max-w-[68ch] text-[15px] text-ink">
        {f.seasonal_pct == null
          ? tr("The forecast expects {f} over {h} weeks.", { f: pct(f.forecast_change_pct, 1, true), h: f.horizon_weeks })
          : tr("The forecast expects {f} over {h} weeks; in the last {n} years these weeks moved a median {s}.", {
              f: pct(f.forecast_change_pct, 1, true),
              h: f.horizon_weeks,
              n: f.seasonal_years,
              s: pct(f.seasonal_pct, 1, true),
            })}
      </p>
      <FigureRow>
        <Figure label="Last 4 weeks" value={pct(f.momentum_4w_pct, 1, true)} note="momentum" />
        <Figure label="Last 12 weeks" value={pct(f.momentum_12w_pct, 1, true)} note="momentum" />
        <Figure label="Usual for these weeks" value={f.seasonal_pct == null ? "–" : pct(f.seasonal_pct, 1, true)} note={tr("median of {n} years", { n: f.seasonal_years })} />
        <Figure label="Against the 3-year median" value={pct(f.vs_3y_median_pct, 0, true)} note="today's rate" />
      </FigureRow>
      {importance && (
        <div className="mt-6 max-w-xl">
          <h3 className="mb-3 text-[15px] font-semibold text-ink">{tr("What the model relies on")}</h3>
          <ul className="space-y-2">
            {importance.map((r) => (
              <li key={r.input} className="grid grid-cols-[10rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-[14px]">
                <span className="text-ink-2">{tr(r.input)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-sunken">
                  <span className="block h-full rounded-full bg-series-1" style={{ width: `${Math.max(1, r.share_pct)}%` }} />
                </span>
                <span className="text-right tabular-nums text-ink">{num(r.share_pct, r.share_pct < 10 ? 1 : 0)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-ink-3">{tr("Share of the model's accuracy lost when each input is scrambled, over the last two years.")}</p>
        </div>
      )}
    </Section>
  );
}

function MarketDrivers() {
  const drivers = useDrivers();
  const tr = useT();
  const list = drivers.data?.drivers ?? [];
  if (drivers.isSuccess && list.length === 0) return null;
  const sentence = driversSentence(list, 5, tr);
  return (
    <Section
      title="What's moving the market"
      description="Coal and oil prices and the rupee, which feed through to freight rates and what SAIL pays in rupees."
    >
      {!drivers.data ? (
        drivers.isError ? (
          <ErrorState message="Couldn't load coal, oil and currency prices." onRetry={() => void drivers.refetch()} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : (
        <>
          <p className="mb-4 max-w-[68ch] text-[15px] text-ink">
            {sentence ?? tr("Coal, oil and the rupee have each moved less than 5% in three months, so they aren't pushing freight either way.")}
          </p>
          <DriverCards drivers={list} />
        </>
      )}
    </Section>
  );
}

/** One voyage has no split to make: compare fixing now with fixing at the forecast. */
function SingleVoyageCost({ timing }: { timing: TimingResponse }) {
  const money = useMoney();
  const tr = useT();
  const rows = timing.contract.cost_comparison;
  const now = rows.find((c) => c.contract_pct === 100);
  const later = rows.find((c) => c.contract_pct === 0);
  if (!now || !later) return null;
  const diff = later.estimated_hire_cost_usd - now.estimated_hire_cost_usd;
  const verdict =
    timing.signal === "fix_now"
      ? diff > 0
        ? tr("Fix this voyage now: waiting is expected to cost {x} more in hire.", { x: total(diff, money) })
        : tr("Fix this voyage now: waiting is expected to save only {x} in hire.", { x: total(-diff, money) })
      : tr("Waiting until the week of {date} is expected to save about {pct} on hire.", {
          date: shortDate(timing.best_fix.date),
          pct: pct(timing.best_fix.saving_vs_now_pct, 0),
        });
  return (
    <div className="max-w-2xl">
      <Verdict size="sm">{verdict}</Verdict>
      <dl className="divide-y divide-rule border-y border-rule text-[14px]">
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-ink">{tr("Fix now, at today's rate")}</dt>
          <dd className="text-ink">{tr("{x} hire", { x: total(now.estimated_hire_cost_usd, money) })}</dd>
        </div>
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-ink-2">{tr("Fix later, at the forecast rate")}</dt>
          <dd className="text-ink">
            {tr("{x} hire", { x: total(later.estimated_hire_cost_usd, money) })}{" "}
            <Delta value={diff}>({total(diff, money, true)})</Delta>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function HeaderHint({ label, hint }: { label: string; hint: string }) {
  const tr = useT();
  return (
    <Tooltip content={hint}>
      <span tabIndex={0} className="inline-flex cursor-help items-center gap-1">
        {tr(label)}
        <Info size={13} strokeWidth={1.75} aria-hidden />
      </span>
    </Tooltip>
  );
}

function ModelAccuracy({ horizon, cls, used: usedModel, usedLabel }: { horizon: number; cls: string; used: string; usedLabel: string }) {
  const [open, setOpen] = useState(false);
  const tr = useT();
  const backtest = useBacktest(horizon, cls);
  const models = backtest.data?.models ?? [];
  const maxMase = Math.max(...models.map((m) => m.mean_mase), 0);
  const splits = models[0]?.n_splits;
  const chosen = models.find((m) => m.model === usedModel);

  return (
    <Section
      title="Forecast accuracy"
      description={
        chosen
          ? tr("The forecast above ({model}) called the direction of {cls} rates right {pct} of the time in {n} past tests.", {
              model: tr(usedLabel),
              cls: tr(cls),
              pct: pct(chosen.mean_directional_accuracy * 100, 0),
              n: splits ?? 0,
            })
          : tr("How well each model forecast {cls} rates {n} weeks ahead in past tests.", { cls: tr(cls), n: horizon })
      }
      actions={
        <Button variant="text" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {tr(open ? "Hide model comparison" : "Compare models")}
        </Button>
      }
    >
      {open &&
        (!backtest.data ? (
          backtest.isError ? (
            <ErrorState message="Couldn't run the backtest." onRetry={() => void backtest.refetch()} />
          ) : (
            <div className="space-y-2" aria-busy="true" aria-label={tr("Running backtest")}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )
        ) : (
          <Refreshing active={backtest.isPlaceholderData}>
            <Table>
              <thead>
                <tr>
                  <Th>Model</Th>
                  <Th align="right">
                    <HeaderHint
                      label="Error (MASE)"
                      hint="Mean absolute scaled error: average forecast error relative to a one-step naive forecast. Lower is better."
                    />
                  </Th>
                  <Th align="right" className="hidden sm:table-cell">
                    <HeaderHint label="Direction right" hint="Share of forecasts that called the direction of the rate change correctly." />
                  </Th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const used = m.model === usedModel;
                  return (
                    <Tr key={m.model} mark={used ? "signal" : "none"}>
                      <Td className={used ? "font-semibold" : ""}>
                        {tr(MODEL_NAMES[m.model] ?? m.model)}
                        {used && <span className="ml-2 font-normal text-ink-3">{tr("used above")}</span>}
                      </Td>
                      <Td align="right">
                        <span className="inline-flex items-center gap-3">
                          <span className="hidden sm:inline">
                            <InlineBar value={m.mean_mase} max={maxMase} width={96} />
                          </span>
                          <span className="w-12">{num(m.mean_mase, 2)}</span>
                        </span>
                      </Td>
                      <Td align="right" className="hidden sm:table-cell">
                        <span className="inline-flex items-center gap-3">
                          <InlineBar value={m.mean_directional_accuracy} max={1} width={96} />
                          <span className="w-10">{pct(m.mean_directional_accuracy * 100, 0)}</span>
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Refreshing>
        ))}
    </Section>
  );
}

const ROUTE_WEEKS = [4, 12, 26] as const;

function routeKey(r: { origin: string; port: string }) {
  return `${r.origin}|${r.port}`;
}

function RangeCell({ r, money }: { r: RouteFreightRange | undefined; money: Money }) {
  if (!r) return <span className="text-ink-3">–</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-ink">{perTonne(r.point, money)}</span>
      <span className="text-[12px] text-ink-3">
        {perTonne(r.lower, money)}–{perTonne(r.upper, money)}
      </span>
    </span>
  );
}

/** Sea freight per tonne on every route a vessel type can sail, now and ahead. */
function RouteFreight({ cls }: { cls: string }) {
  const tr = useT();
  const money = useMoney();
  const { shipment } = useShipment();
  const params = shipment ? { vessel_class: cls, cargo: shipment.cargoTonnes, month: shipment.month, plant: shipment.plant } : null;
  const routes = useRouteFreight(params);
  const [picked, setPicked] = useState<string | null>(null);
  const list = routes.data?.routes ?? [];
  const selected =
    list.find((r) => routeKey(r) === picked) ?? list.find((r) => r.origin === shipment?.origin) ?? list[0];
  const series = useRouteSeries(params && selected ? { ...params, origin: selected.origin, port: selected.port } : null);
  const label = (r: RouteFreightRow) => `${tr(originParts(r.origin).short)} → ${tr(r.port)}`;

  return (
    <Section
      id="routes"
      title="Freight by trade route"
      description={
        shipment
          ? tr("Sea freight per tonne for a {cls} on each route it can sail in {month}: hire for the voyage days, bunkers and port costs. Select a route to see its weekly history and forecast.", {
              cls: tr(cls),
              month: tr(monthLong(shipment.month)),
            })
          : undefined
      }
    >
      {!routes.data ? (
        routes.isError ? (
          <ErrorState message="Couldn't price the trade routes." onRetry={() => void routes.refetch()} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )
      ) : list.length === 0 ? (
        <EmptyState>{tr("A {cls} can't sail any route with this cargo in this month.", { cls: tr(cls) })}</EmptyState>
      ) : (
        <Refreshing active={routes.isPlaceholderData}>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Route</Th>
                  <Th align="right">Distance</Th>
                  <Th align="right">Now</Th>
                  {ROUTE_WEEKS.map((w) => (
                    <Th key={w} align="right">
                      {tr("In {n} weeks", { n: w })}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <Tr
                    key={routeKey(r)}
                    onSelect={() => setPicked(routeKey(r))}
                    selected={selected && routeKey(r) === routeKey(selected)}
                    mark={i === 0 ? "signal" : "none"}
                    label={tr("{route}, {price} per tonne now", { route: label(r), price: perTonne(r.now, money) })}
                  >
                    <Td className="font-semibold">
                      {label(r)}
                      {r.origin === shipment?.origin && <span className="ml-2 text-[12.5px] font-normal text-ink-3">{tr("your load port")}</span>}
                    </Td>
                    <Td align="right" className="text-ink-2">
                      {r.route_nm ? tr("{n} nm", { n: num(r.route_nm) }) : "–"}
                      <span className="block text-[12px] text-ink-3">{tr("{d} at sea", { d: `${num(r.transit_days, 1)} d` })}</span>
                    </Td>
                    <Td align="right" className="font-semibold">{perTonne(r.now, money)}</Td>
                    {ROUTE_WEEKS.map((w) => (
                      <Td key={w} align="right">
                        <RangeCell r={r[`week_${w}`]} money={money} />
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="md:hidden">
            <MobileList>
              {list.map((r, i) => (
                <MobileItem
                  key={routeKey(r)}
                  onSelect={() => setPicked(routeKey(r))}
                  selected={selected && routeKey(r) === routeKey(selected)}
                  mark={i === 0 ? "signal" : "none"}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold text-ink">{label(r)}</span>
                    <span className="whitespace-nowrap font-semibold text-ink">
                      {perTonne(r.now, money)}
                      <span className="text-[13px] font-normal text-ink-3">{perTonneUnit()}</span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-[13.5px] text-ink-3">
                    {r.week_12 ? tr("In 12 weeks {x}", { x: `${perTonne(r.week_12.point, money)}${perTonneUnit()}` }) : ""}
                    {r.route_nm ? ` · ${tr("{n} nm", { n: num(r.route_nm) })}` : ""}
                  </div>
                </MobileItem>
              ))}
            </MobileList>
          </div>
          <p className="mt-2 text-[13px] text-ink-3">
            {tr("Per tonne of cargo, in {unit}. Ranges are 80% of outcomes, from {model}.", {
              unit: money.currency === "USD" ? "US$" : "₹",
              model: tr(routes.data.model_label),
            })}
          </p>

          {selected && (
            <div className="mt-6 bg-surface border border-rule rounded-[var(--radius-surface)] p-4 md:p-5">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">{tr("{route}, weekly freight per tonne", { route: label(selected) })}</h3>
              {!series.data ? (
                series.isError ? (
                  <ErrorState message="Couldn't load this route's freight history." onRetry={() => void series.refetch()} />
                ) : (
                  <Skeleton className="h-[260px] w-full" />
                )
              ) : (
                <Refreshing active={series.isPlaceholderData}>
                  <div className="hidden md:block">
                    <FreightChart
                      data={{
                        history: series.data.history.map((h) => ({ date: h.date, actual: h.usd_per_tonne })),
                        forecast: series.data.forecast.map((f) => ({ date: f.date, forecast: f.usd_per_tonne, lower: f.lower, upper: f.upper })),
                      }}
                      range="1y"
                      money={money}
                      height={320}
                      unit="tonne"
                    />
                  </div>
                  <div className="md:hidden">
                    <FreightChart
                      data={{
                        history: series.data.history.map((h) => ({ date: h.date, actual: h.usd_per_tonne })),
                        forecast: series.data.forecast.map((f) => ({ date: f.date, forecast: f.usd_per_tonne, lower: f.lower, upper: f.upper })),
                      }}
                      range="6m"
                      money={money}
                      height={240}
                      unit="tonne"
                    />
                  </div>
                </Refreshing>
              )}
            </div>
          )}
        </Refreshing>
      )}
    </Section>
  );
}
