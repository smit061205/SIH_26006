import { type T, useT } from "../lib/i18n";
import { PortLoadChart } from "../components/charts/PortLoadChart";
import { InlineBar } from "../components/ui/bars";
import { EmptyState, ErrorState, PageSkeleton, Refreshing, Skeleton } from "../components/ui/feedback";
import { Delta, Figure, FigureRow, Verdict } from "../components/ui/figures";
import { Field, Segmented, Select, Slider } from "../components/ui/inputs";
import { PageHeader, Section } from "../components/ui/layout";
import { MobileItem, MobileList, Table, Td, Th, Tr } from "../components/ui/table";
import { useThresholds } from "../lib/alertSettings";
import { useMoney } from "../lib/currency";
import { dayRate, days, monthLong, monthShort, num, perDayUnit, perTonne, perTonneUnit, shortDate, tonnes, total } from "../lib/format";
import { useCharterPlan, useEmployment, useExcludePort, useIdle, usePlan, useRank, useWaitScenarios } from "../lib/queries";
import { useChoiceParam, useNumberParam, useSearchParam } from "../lib/router";
import { useShipment } from "../lib/shipment";
import type { EmploymentOption, EmploymentResponse, IdleResponse, PlanResponse, RankedRow } from "../types";

export default function Scenarios() {
  const { request, shipment, reference, referenceError, retryReference } = useShipment();
  const tr = useT();
  const rank = useRank(request);

  const header = (
    <PageHeader
      meta="What-if analysis on this shipment"
      title="Scenarios"
      description="Where time is lost to waiting, how to keep a spare ship earning, and how the recommendation holds up if a port closes or several shipments arrive together."
    />
  );

  if (referenceError) {
    return (
      <>
        {header}
        <ErrorState message="Couldn't load the list of ports, plants and load ports." onRetry={retryReference} />
      </>
    );
  }
  if (!shipment || !reference || !rank.data) {
    if (rank.isError) {
      return (
        <>
          {header}
          <ErrorState message="Couldn't calculate the recommendation for this shipment." onRetry={() => void rank.refetch()} />
        </>
      );
    }
    return <PageSkeleton />;
  }

  const best = rank.data.ranked[0];
  const month = tr(monthLong(shipment.month));

  return (
    <>
      {header}
      {!best ? (
        <EmptyState>{tr("No port can take this cargo in {month}, so there is nothing to test. Try a different month or plant.", { month })}</EmptyState>
      ) : (
        <>
          <IdleTime />
          <WaitScenario best={best} />
          <Employment />
          <PortClosure best={best} ports={reference.ports} month={month} />
          <MultiShipment month={month} />
        </>
      )}
    </>
  );
}

const OPTION_LABEL: Record<string, string> = {
  port: "Another port",
  vessel_class: "Another vessel type",
  month: "Later arrival",
};

function idleSupport(r: NonNullable<IdleResponse["result"]>, money: ReturnType<typeof useMoney>, tr: T) {
  const parts: string[] = [];
  const swell = r.baseline.weather_delay_days;
  if (swell > 0) {
    parts.push(
      r.baseline.weather_basis === "forecast"
        ? tr("Includes {d} of rough sea in the current forecast.", { d: days(swell) })
        : tr("Includes {d} typically lost to swell at {port} in {month}.", { d: days(swell), port: tr(r.baseline.port), month: tr(monthLong(r.baseline.month)) })
    );
  }
  const cheaper = r.alternatives
    .filter((a) => (a.delta_vs_baseline_usd ?? 0) < 0)
    .sort((a, b) => (a.delta_vs_baseline_usd ?? 0) - (b.delta_vs_baseline_usd ?? 0))[0];
  if (cheaper) {
    parts.push(tr("{option} saves {x}.", { option: tr(OPTION_LABEL[cheaper.option_type] ?? cheaper.description), x: total(-(cheaper.delta_vs_baseline_usd ?? 0), money) }));
  } else if (r.alternatives.length > 0) {
    parts.push(tr("Accepting the wait is cheaper: every option that cuts it costs more in freight and rail than it saves."));
  }
  return parts.length ? parts.join(" ") : undefined;
}

function IdleTime() {
  const { request } = useShipment();
  const tr = useT();
  const money = useMoney();
  const thresholds = useThresholds();
  const idle = useIdle(request, thresholds.wave_m);
  const r = idle.data?.result;

  return (
    <Section
      first
      title="Idle time and how to cut it"
      description="Days the ship is expected to spend waiting for a berth or for weather, what that costs, and the options that cut it."
    >
      {!idle.data ? (
        idle.isError ? (
          <ErrorState message="Couldn't work out idle time." onRetry={() => void idle.refetch()} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : !r ? (
        <EmptyState>{tr("No option fits this cargo, so there is no idle time to cut.")}</EmptyState>
      ) : (
        <Refreshing active={idle.isPlaceholderData}>
          <Verdict size="sm" support={idleSupport(r, money, tr)}>
            {tr("A {cls} at {port} is expected to sit idle about {d} per call, costing {x} on this cargo.", {
              cls: tr(r.baseline.vessel_class),
              port: tr(r.baseline.port),
              d: days(r.baseline.expected_idle_days),
              x: total(r.baseline.idle_cost_usd, money),
            })}
          </Verdict>
          {r.alternatives.length === 0 ? (
            <p className="text-[14.5px] text-ink-2">{tr("No other port, vessel type or arrival month cuts idle time or cost for this cargo.")}</p>
          ) : (
            <>
            <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th>Option</Th>
                  <Th>Port and vessel</Th>
                  <Th align="right">Idle days</Th>
                  <Th align="right">Days saved</Th>
                  <Th align="right" className="hidden sm:table-cell">Landed cost /t</Th>
                  <Th align="right">vs current</Th>
                </tr>
              </thead>
              <tbody>
                {r.alternatives.slice(0, 5).map((a) => (
                  <Tr key={`${a.option_type}-${a.port}-${a.vessel_class}-${a.month}`}>
                    <Td className="font-semibold">{tr(OPTION_LABEL[a.option_type] ?? a.description)}</Td>
                    <Td className="text-ink-2">
                      {tr(a.port)}, {tr(a.vessel_class)}
                      {a.option_type === "month" && `, ${tr(monthLong(a.month))}`}
                    </Td>
                    <Td align="right">{days(a.expected_idle_days)}</Td>
                    <Td align="right" className={a.idle_days_saved && a.idle_days_saved > 0 ? "text-positive" : "text-ink-3"}>
                      {a.idle_days_saved && a.idle_days_saved > 0 ? days(a.idle_days_saved) : "–"}
                    </Td>
                    <Td align="right" className="hidden sm:table-cell">{perTonne(a.usd_per_tonne, money)}</Td>
                    <Td align="right">
                      <Delta value={a.delta_vs_baseline_usd ?? 0}>{total(a.delta_vs_baseline_usd ?? 0, money, true)}</Delta>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            </div>
            <div className="sm:hidden">
              <MobileList>
                {r.alternatives.slice(0, 5).map((a) => (
                  <MobileItem key={`${a.option_type}-${a.port}-${a.vessel_class}-${a.month}`}>
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold text-ink">{tr(OPTION_LABEL[a.option_type] ?? a.description)}</span>
                      <Delta value={a.delta_vs_baseline_usd ?? 0}>{total(a.delta_vs_baseline_usd ?? 0, money, true)}</Delta>
                    </div>
                    <div className="mt-0.5 text-[13.5px] text-ink-2">
                      {tr(a.port)}, {tr(a.vessel_class)}
                      {a.option_type === "month" && `, ${tr(monthLong(a.month))}`} · {tr("idle {d}", { d: days(a.expected_idle_days) })}
                      {a.idle_days_saved && a.idle_days_saved > 0 ? `, ${tr("{d} less", { d: days(a.idle_days_saved) })}` : ""}
                    </div>
                  </MobileItem>
                ))}
              </MobileList>
            </div>
            </>
          )}
        </Refreshing>
      )}
    </Section>
  );
}

function WaitScenario({ best }: { best: RankedRow }) {
  const { request } = useShipment();
  const tr = useT();
  const money = useMoney();
  const wait = useWaitScenarios(request);
  const rows = wait.data?.wait_scenarios ?? [];
  const base = rows[0];
  const maxExtra = Math.max(...rows.map((r) => (base ? r.total_usd - base.total_usd : 0)), 0);

  let verdict = "";
  if (rows.length >= 2 && base) {
    const [prev, last] = rows.slice(-2);
    const perDay = (last.total_usd - prev.total_usd) / (last.wait_days - prev.wait_days);
    verdict =
      base.n_voyages > 1
        ? tr("Each extra day of waiting adds about {x} in hire across {n} voyages.", { x: total(perDay, money), n: base.n_voyages })
        : tr("Each extra day of waiting adds about {x} in hire.", { x: total(perDay, money) });
  }

  return (
    <Section
      title="If the vessel has to wait"
      description={tr("Same port and vessel as the recommendation ({port}, {cls}); only the days waiting for a berth change. The ship is on hire while it waits.", { port: tr(best.port), cls: tr(best.vessel_class) })}
    >
      {!wait.data ? (
        wait.isError ? (
          <ErrorState message="Couldn't calculate waiting costs." onRetry={() => void wait.refetch()} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )
      ) : (
        <Refreshing active={wait.isPlaceholderData}>
          {verdict && <Verdict size="sm">{verdict}</Verdict>}
          <Table>
            <thead>
              <tr>
                <Th>Wait</Th>
                <Th align="right">Landed cost /t</Th>
                <Th align="right" className="hidden sm:table-cell">Shipment total</Th>
                <Th align="right" className="hidden sm:table-cell">Hire while idle</Th>
                <Th align="right">Extra vs no wait</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const extra = base ? r.total_usd - base.total_usd : 0;
                return (
                  <Tr key={r.wait_days}>
                    <Td className="font-semibold">{days(r.wait_days)}</Td>
                    <Td align="right">{perTonne(r.usd_per_tonne, money)}</Td>
                    <Td align="right" className="hidden sm:table-cell text-ink-2">{total(r.total_usd, money)}</Td>
                    <Td align="right" className={`hidden sm:table-cell ${r.waiting_hire_usd > 0 ? "text-ink-2" : "text-ink-3"}`}>
                      {r.waiting_hire_usd > 0 ? total(r.waiting_hire_usd, money) : "–"}
                    </Td>
                    <Td align="right">
                      {extra > 0 ? (
                        <span className="inline-flex items-center gap-3">
                          <span className="hidden md:inline">
                            <InlineBar value={extra} max={maxExtra} width={120} />
                          </span>
                          <span className="text-negative">{total(extra, money, true)}</span>
                        </span>
                      ) : (
                        <span className="text-ink-3">–</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Refreshing>
      )}
    </Section>
  );
}

function PortClosure({ best, ports, month }: { best: RankedRow; ports: string[]; month: string }) {
  const { request } = useShipment();
  const tr = useT();
  const money = useMoney();
  const [closedParam, setClosed] = useSearchParam("closed");
  const closed = closedParam && ports.includes(closedParam) ? closedParam : best.port;
  const result = useExcludePort(request, closed);
  const ranked = result.data?.ranked ?? [];
  const next = ranked[0];
  const unchanged = closed !== best.port;

  let verdict = "";
  // While the new port's result loads, the old one is still on screen; don't pair it with the new name.
  if (result.data && !result.isPlaceholderData) {
    if (unchanged) {
      verdict = tr("Closing {closed} doesn't change the recommendation: a {cls} into {port} at {x}.", {
        closed: tr(closed),
        cls: tr(best.vessel_class),
        port: tr(best.port),
        x: perTonne(best.usd_per_tonne, money) + perTonneUnit(),
      });
    } else if (next) {
      verdict = tr("Without {closed}, use a {cls} into {port} at {x}, {diff} for this shipment.", {
        closed: tr(closed),
        cls: tr(next.vessel_class),
        port: tr(next.port),
        x: perTonne(next.usd_per_tonne, money) + perTonneUnit(),
        diff: total(next.total_usd - best.total_usd, money, true),
      });
    }
  }

  return (
    <Section
      title="If a port is unavailable"
      description="Closes one port, for weather, congestion or a strike, and ranks what's left."
      actions={
        <Field label="Close" layout="inline">
          <Select
            label="Port to close"
            value={closed}
            onChange={(v) => setClosed(v === best.port ? null : v)}
            options={ports.map((p) => ({ value: p, label: p === best.port ? tr("{port} (recommended)", { port: tr(p) }) : tr(p), short: tr(p) }))}
            className="w-[180px]"
          />
        </Field>
      }
    >
      {!result.data ? (
        result.isError ? (
          <ErrorState message="Couldn't rank the remaining ports." onRetry={() => void result.refetch()} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )
      ) : ranked.length === 0 ? (
        <EmptyState>{tr("With {closed} closed, no other port can take this cargo in {month}.", { closed: tr(closed), month })}</EmptyState>
      ) : (
        <Refreshing active={result.isPlaceholderData}>
          {verdict && <Verdict size="sm">{verdict}</Verdict>}
          <div className="hidden sm:block">
            <Table>
              <thead>
                <tr>
                  <Th align="right" className="w-12">#</Th>
                  <Th>Port</Th>
                  <Th>Vessel</Th>
                  <Th align="right">Landed cost /t</Th>
                  <Th align="right">vs recommended</Th>
                  <Th align="right">Shipment total</Th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 5).map((r) => {
                  const diff = r.total_usd - best.total_usd;
                  return (
                    <Tr key={`${r.port}-${r.vessel_class}`} mark={r.rank === 1 ? "signal" : "none"}>
                      <Td align="right" className="text-ink-3">{r.rank}</Td>
                      <Td className="font-semibold">{tr(r.port)}</Td>
                      <Td className="text-ink-2">{tr(r.vessel_class)}</Td>
                      <Td align="right">{perTonne(r.usd_per_tonne, money)}</Td>
                      <Td align="right">
                        <Delta value={diff}>{Math.abs(diff) < 1 ? tr("same") : total(diff, money, true)}</Delta>
                      </Td>
                      <Td align="right" className="text-ink-2">{total(r.total_usd, money)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <div className="sm:hidden">
            <MobileList>
              {ranked.slice(0, 5).map((r) => (
                <MobileItem key={`${r.port}-${r.vessel_class}`} mark={r.rank === 1 ? "signal" : "none"}>
                  <div className="flex justify-between gap-3">
                    <span>
                      <span className="mr-2 text-ink-3">{r.rank}</span>
                      <span className="font-semibold text-ink">{tr(r.port)}</span>
                      <span className="text-ink-2">, {tr(r.vessel_class)}</span>
                    </span>
                    <span className="font-semibold text-ink">{perTonne(r.usd_per_tonne, money)}</span>
                  </div>
                  <div className="mt-0.5 text-[13.5px] text-ink-3">
                    {tr("{x} vs recommended", { x: total(r.total_usd - best.total_usd, money, true) })}
                  </div>
                </MobileItem>
              ))}
            </MobileList>
          </div>
        </Refreshing>
      )}
    </Section>
  );
}

const EMPLOYMENT_TITLE: Record<EmploymentOption["option"], string> = {
  wait: "Wait on hire",
  sublet: "Sublet the ship",
  backhaul: "Backhaul cargo",
};

function employmentVerdict(r: EmploymentResponse, money: ReturnType<typeof useMoney>, tr: T) {
  const best = r.options?.find((o) => o.option === r.best);
  if (!best || best.option === "wait") return tr("Keep the ship waiting: neither subletting nor a backhaul pays for a spell this short.");
  const x = total(best.saving_vs_wait_usd, money);
  if (best.option === "sublet") return tr("Sublet the {cls} while it's spare: about {x} better than waiting.", { cls: tr(r.vessel_class), x });
  return tr("Take a backhaul cargo to {to}: about {x} better than waiting.", { to: tr(String(best.detail.to_port)), x });
}

function OptionCard({ o, best, r }: { o: EmploymentOption; best: boolean; r: EmploymentResponse }) {
  const tr = useT();
  const money = useMoney();
  const d = o.detail;
  const lines: string[] = [];
  if (o.option === "wait") {
    lines.push(tr("{d} on hire: {idle} spare, then {ballast} back to {origin}", {
      d: days(o.days),
      idle: days(r.idle_days),
      ballast: days(Math.max(0, r.window_days - r.idle_days)),
      origin: tr(r.origin.replace(/\s*\(.*\)$/, "")),
    }));
    lines.push(tr("Hire {h}, fuel {f}", { h: total(Number(d.hire_usd), money), f: total(Number(d.bunkers_usd), money) }));
  } else if (o.option === "sublet") {
    lines.push(tr("Relet at about {m}{u} against your {h}{u} hire", {
      m: dayRate(Number(d.market_rate_usd_per_day), money),
      h: dayRate(Number(d.hire_rate_usd_per_day), money),
      u: perDayUnit(),
    }));
    lines.push(tr("Earns {x} after {c}% commission; the sub-charterer pays its fuel", { x: total(o.revenue_usd, money), c: num(Number(d.commission_pct), 2) }));
  } else {
    lines.push(tr("{t} of {cargo} to {to} at {f}{u}", {
      t: tonnes(Number(d.tonnes)),
      cargo: tr(String(d.cargo)).toLowerCase(),
      to: tr(String(d.to_port)),
      f: perTonne(Number(d.freight_usd_per_tonne), money),
      u: perTonneUnit(),
    }));
    lines.push(tr("{d} in all: {laden} laden, {ports} in port, {ballast} back in ballast", {
      d: days(o.days),
      laden: days(Number(d.laden_days)),
      ports: days(Number(d.port_days)),
      ballast: days(Number(d.ballast_days)),
    }));
    lines.push(tr("Fuel {f}, port costs {p}", { f: total(Number(d.bunkers_usd), money), p: total(Number(d.port_costs_usd), money) }));
  }
  const net = o.net_cost_usd;
  return (
    <div
      className={`rounded-[var(--radius-surface)] border bg-surface p-4 ${
        best ? "border-signal-fill shadow-[inset_3px_0_0_var(--color-signal-fill)]" : "border-rule"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{tr(EMPLOYMENT_TITLE[o.option])}</h3>
        {best && <span className="text-[12.5px] font-semibold text-ink-2">{tr("Best on time")}</span>}
      </div>
      <p className="mt-2 text-[22px] font-semibold text-ink">
        {net <= 0 ? tr("Earns {x}", { x: total(-net, money) }) : tr("Costs {x}", { x: total(net, money) })}
      </p>
      <p className="text-[13.5px] text-ink-3">
        {o.option === "wait" ? (
          tr("over the spare spell")
        ) : (
          <>
            <Delta value={-o.saving_vs_wait_usd}>{total(-o.saving_vs_wait_usd, money, true)}</Delta> {tr("vs waiting")}
          </>
        )}
      </p>
      <ul className="mt-3 space-y-1 text-[13.5px] text-ink-2">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {o.late_days > 0 && (
        <p className="mt-3 text-[13.5px] font-semibold text-negative">
          {tr("{d} late for the next cargo", { d: days(o.late_days) })}
        </p>
      )}
    </div>
  );
}

/** When a chartered ship isn't needed for a spell: wait, sublet it, or take a backhaul cargo. */
function Employment() {
  const { request, shipment } = useShipment();
  const tr = useT();
  const money = useMoney();
  const plan = useCharterPlan(shipment);
  const top = plan.data?.recommendation?.top;
  const planSettled = !!plan.data || plan.isError;
  const [idleParam, setIdle] = useNumberParam("idle", 0, (v) => Number.isInteger(v) && v >= 3 && v <= 60);
  const result = useEmployment(
    planSettled ? request : null,
    top?.vessel_class ?? shipment?.fixedClass ?? null,
    top?.port ?? shipment?.fixedPort ?? null,
    idleParam || null
  );
  const r = result.data;
  const idle = idleParam || Math.round(r?.idle_days ?? 10);
  const p = r?.periods;

  return (
    <Section
      id="employment"
      title="Keep an idle ship earning"
      description="A time-chartered ship stays on hire when it isn't needed: the plant has stock, the port is closed or the next cargo isn't due. Compare waiting with subletting it or carrying a backhaul cargo, and see when such spells are likely."
    >
      {!r ? (
        result.isError ? (
          <ErrorState message="Couldn't cost the options for a spare ship." onRetry={() => void result.refetch()} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )
      ) : !r.options ? (
        <EmptyState>{tr("No option fits this cargo, so there is no ship to keep busy.")}</EmptyState>
      ) : (
        <Refreshing active={result.isPlaceholderData}>
          <div className="mb-6 max-w-md">
            <Slider
              label={tr("Days the {cls} is spare", { cls: tr(r.vessel_class) })}
              min={3}
              max={60}
              value={idle}
              onChange={setIdle}
              format={(v) => days(v)}
            />
            {!idleParam && (
              <p className="mt-2 text-[13px] text-ink-3">
                {r.idle_days_source === "stock"
                  ? tr("Set from the plant's stock above its buffer.")
                  : tr("A typical spell; move the slider to your own.")}
              </p>
            )}
          </div>
          <Verdict size="sm" support={tr("After discharging at {port}, the ship has {d} before it must be back at {origin} for the next cargo.", {
            port: tr(r.port),
            d: days(r.window_days),
            origin: tr(r.origin.replace(/\s*\(.*\)$/, "")),
          })}>
            {employmentVerdict(r, money, tr)}
          </Verdict>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {r.options.map((o) => (
              <OptionCard key={o.option} o={o} best={o.option === r.best} r={r} />
            ))}
          </div>
          {p && (
            <div className="mt-8">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">{tr("When a ship is likely to be spare")}</h3>
              <dl className="divide-y divide-rule border-y border-rule text-[14px]">
                <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <dt className="text-ink-3">{tr("Plant stock")}</dt>
                  <dd className="text-ink">
                    {p.stock_spare_days === null
                      ? tr("No stock figure for this plant.")
                      : p.stock_spare_days > 0
                        ? tr("{d} above the buffer, so the next cargo can wait that long.", { d: days(p.stock_spare_days) })
                        : tr("At or below the buffer: the next cargo is needed on time.")}
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <dt className="text-ink-3">{tr("Monsoon at {port}", { port: tr(r.port) })}</dt>
                  <dd className="text-ink">
                    {p.monsoon_months.length === 0
                      ? tr("No monsoon months in the next year.")
                      : tr(p.port_closed_in_monsoon ? "{months}: the port closes, so ships are spare." : "{months}: slower discharge and weather waits.", {
                          months: p.monsoon_months.map((m) => tr(monthShort(m))).join(", "),
                        })}
                  </dd>
                </div>
                <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <dt className="text-ink-3">{tr("Best weeks to sublet")}</dt>
                  <dd className="text-ink">
                    {p.strong_market_weeks.length === 0
                      ? tr("The forecast market rate stays below your hire for 26 weeks, so subletting would earn less than the hire.")
                      : tr("{n} of the next 26 weeks pay at least 5% over your hire, first the week of {date} at {rate}.", {
                          n: p.strong_market_weeks.length,
                          date: shortDate(p.strong_market_weeks[0].date),
                          rate: dayRate(p.strong_market_weeks[0].rate_usd_per_day, money) + perDayUnit(),
                        })}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </Refreshing>
      )}
    </Section>
  );
}

const SOLVER_LABEL: Record<string, string> = {
  OPTIMAL: "Optimal",
  FEASIBLE: "Feasible",
  INFEASIBLE: "No plan",
  MODEL_INVALID: "No plan",
  UNKNOWN: "No answer",
};

function independentNote(plan: PlanResponse, tr: T) {
  if (plan.naive_capacity_violations.length === 0) return tr("Every shipment fits within the slots");
  return plan.naive_capacity_violations
    .map((v) => tr("{calls} calls at {port}, which has {cap} slots", { calls: v.calls_assigned, port: tr(v.port), cap: v.cap }))
    .join("; ");
}

function MultiShipment({ month }: { month: string }) {
  const { request } = useShipment();
  const tr = useT();
  const money = useMoney();
  const [n, setN] = useNumberParam("n", 5, (v) => Number.isInteger(v) && v >= 2 && v <= 8);
  const [slots, setSlots] = useNumberParam("slots", 2, (v) => Number.isInteger(v) && v >= 1 && v <= 5);
  const [basis, setBasis] = useChoiceParam<"flat" | "traffic">("cap", "flat", ["flat", "traffic"]);
  const plan = usePlan(request, n, slots, basis);

  const p = plan.data;
  const solved = p?.status === "planned" && p.total_cost_usd !== null;
  // A shipment split into several voyages makes several port calls.
  const load = p
    ? Object.entries(
        p.assignments.reduce<Record<string, number>>((acc, a) => {
          acc[a.port] = (acc[a.port] ?? 0) + a.n_voyages;
          return acc;
        }, {})
      )
        .map(([port, calls]) => ({ port, calls }))
        .sort((a, b) => b.calls - a.calls)
    : [];
  const extra = p && p.total_cost_usd !== null ? p.total_cost_usd - p.naive_total_cost_usd : 0;

  return (
    <Section
      title="If several shipments arrive in the same month"
      description={tr("{n} identical shipments in {month} compete for berth slots, one slot per voyage. Booked one by one, each takes the cheapest port; planned together, they're spread so no port is over its slots.", { n, month })}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6 max-w-3xl mb-4">
        <Slider label={tr("Shipments this month")} min={2} max={8} value={n} onChange={setN} />
        <Slider
          label={tr(basis === "traffic" ? "Berth slots at a typical port" : "Berth slots per port per month")}
          min={1}
          max={5}
          value={slots}
          onChange={setSlots}
        />
      </div>
      <div className="mb-8">
        <Field label="Slots" layout="inline">
          <Segmented
            label="How berth slots are set"
            value={basis}
            onChange={setBasis}
            options={[
              { value: "flat", label: "Same at every port" },
              { value: "traffic", label: "Scaled to each port's traffic" },
            ]}
          />
        </Field>
      </div>

      {!p ? (
        plan.isError ? (
          <ErrorState message="Couldn't solve the shipment plan." onRetry={() => void plan.refetch()} />
        ) : (
          <Skeleton className="h-56 w-full" />
        )
      ) : (
        <Refreshing active={plan.isPlaceholderData}>
          {!solved ? (
            <EmptyState>
              {tr(p.reason ?? "No plan fits these shipments into the slots. Add slots or reduce shipments.")}
            </EmptyState>
          ) : (
            <>
              <FigureRow>
                <Figure label="Booked one by one" value={total(p.naive_total_cost_usd, money)} note={independentNote(p, tr)} />
                <Figure
                  label="Planned together"
                  value={total(p.total_cost_usd ?? 0, money)}
                  note={
                    extra > 0.5
                      ? tr("{x} to stay within the slots", { x: total(extra, money, true) })
                      : "Same cost, within the slots"
                  }
                />
                <Figure label="Solver" value={tr(SOLVER_LABEL[p.solver_status] ?? p.solver_status)} note="OR-Tools CP-SAT" />
              </FigureRow>

              <div className="mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-12 gap-y-8">
                <div>
                  <h3 className="mb-4 text-[15px] font-semibold text-ink">{tr("Calls per port, planned together")}</h3>
                  <PortLoadChart rows={load} limit={slots} limits={basis === "traffic" ? p.capacities : undefined} />
                </div>
                <div className="min-w-0">
                  <h3 className="mb-4 text-[15px] font-semibold text-ink">{tr("Assignments")}</h3>
                  <div className="hidden sm:block">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Shipment</Th>
                          <Th>Port</Th>
                          <Th>Vessel</Th>
                          <Th align="right">Landed cost /t</Th>
                          <Th align="right">Shipment total</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.assignments.map((a) => (
                          <Tr key={a.shipment_id}>
                            <Td className="font-semibold">{a.shipment_id}</Td>
                            <Td>{tr(a.port)}</Td>
                            <Td className="text-ink-2">
                              {a.n_voyages > 1 ? `${a.n_voyages} × ` : ""}
                              {tr(a.vessel_class)}
                            </Td>
                            <Td align="right">{perTonne(a.usd_per_tonne, money)}</Td>
                            <Td align="right" className="text-ink-2">{total(a.total_usd, money)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  <div className="sm:hidden">
                    <MobileList>
                      {p.assignments.map((a) => (
                        <MobileItem key={a.shipment_id}>
                          <div className="flex justify-between gap-3">
                            <span>
                              <span className="mr-2 font-semibold text-ink">{a.shipment_id}</span>
                              {tr(a.port)}, <span className="text-ink-2">{tr(a.vessel_class)}</span>
                            </span>
                            <span className="font-semibold text-ink">{perTonne(a.usd_per_tonne, money)}</span>
                          </div>
                        </MobileItem>
                      ))}
                    </MobileList>
                  </div>
                </div>
              </div>
            </>
          )}
        </Refreshing>
      )}
    </Section>
  );
}
