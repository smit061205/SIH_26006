import { useT } from "../lib/i18n";
import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { CallsHistory } from "../components/charts/CallsHistory";
import { WaveStrip } from "../components/charts/WaveStrip";
import { ErrorState, PageSkeleton, Refreshing, Skeleton } from "../components/ui/feedback";
import { Button, Field, Segmented, Select } from "../components/ui/inputs";
import { PageHeader, Section, SpecList } from "../components/ui/layout";
import { Tooltip } from "../components/ui/overlay";
import { MobileItem, MobileList, Table, Td, Th, Tr } from "../components/ui/table";
import { AlertList, AlertSettings, SeverityTag } from "../components/ui/alerts";
import { actionable, alertSummary, portFlags } from "../lib/alerts";
import { useThresholds } from "../lib/alertSettings";
import { days, longDate, metres, monthLong, monthShort, num, pct } from "../lib/format";
import { VESSEL_ABBR, VESSEL_CLASSES, originParts } from "../lib/labels";
import { useAlerts, useLoadPorts, usePortHistory, usePorts, useRank, useWeather } from "../lib/queries";
import { useSearchParam } from "../lib/router";
import { useShipment } from "../lib/shipment";
import type { Alert, FeasibilityRow, PortMapEntry, PortWeather, VesselClassInfo } from "../types";
import { WillItFit } from "../components/ship3d/WillItFit";

type ClassState = "fits" | "part-loaded" | "not-this-month" | "not-accepted" | "unknown";

interface PortView {
  port: PortMapEntry;
  usableDraft: number | undefined;
  classes: { cls: string; state: ClassState }[];
  weather: PortWeather | undefined;
}

function buildViews(ports: PortMapEntry[], feasibility: FeasibilityRow[] | undefined, weather: Record<string, PortWeather> | undefined) {
  return ports.map<PortView>((port) => {
    const rows = feasibility?.filter((f) => f.port_name === port.name) ?? [];
    return {
      port,
      usableDraft: rows[0]?.usable_draft_m,
      classes: VESSEL_CLASSES.map((cls) => {
        const accepted = port.vessel_classes_allowed.includes(cls);
        const f = rows.find((r) => r.vessel_class === cls);
        const state: ClassState = !accepted
          ? "not-accepted"
          : !f
            ? "unknown"
            : !f.feasible
              ? "not-this-month"
              : f.part_loaded
                ? "part-loaded"
                : "fits";
        return { cls, state };
      }),
      weather: weather?.[port.name],
    };
  });
}

function coords(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
}

function ClassMarks({ classes, month }: { classes: PortView["classes"]; month: string }) {
  const tr = useT();
  const describe = (c: PortView["classes"][number]) =>
    tr(
      c.state === "fits"
        ? "{cls}: fits in {month}"
        : c.state === "part-loaded"
          ? "{cls}: fits part-loaded in {month}, for the draft"
          : c.state === "not-this-month"
            ? "{cls}: accepted, but not in {month}"
            : c.state === "unknown"
              ? "{cls}: accepted"
              : "{cls}: not accepted",
      { cls: tr(c.cls), month }
    );
  return (
    <Tooltip
      content={
        <ul className="space-y-0.5">
          {classes.map((c) => (
            <li key={c.cls}>{describe(c)}</li>
          ))}
        </ul>
      }
    >
      <span tabIndex={0} className="inline-flex text-[13px]" aria-label={classes.map(describe).join(". ")}>
        {classes.map((c) => (
          <span
            key={c.cls}
            aria-hidden
            className={`inline-block w-[3.1em] ${
              c.state === "fits"
                ? "font-semibold text-ink"
                : c.state === "part-loaded"
                  ? "font-semibold text-ink underline decoration-dotted underline-offset-4"
                  : c.state === "unknown"
                    ? "text-ink-2"
                    : c.state === "not-this-month"
                      ? "text-ink-3 line-through"
                      : "text-ink-3"
            }`}
          >
            {c.state === "not-accepted" ? "–" : VESSEL_ABBR[c.cls]}
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

function waveRange(w: PortWeather | undefined) {
  const h = w?.wave_height_max_m;
  if (!h?.length) return null;
  const lo = Math.min(...h);
  const hi = Math.max(...h);
  return lo === hi ? metres(lo) : `${lo.toFixed(1)}–${metres(hi)}`;
}

export default function Ports() {
  const tr = useT();
  const { request, shipment, reference, update, referenceError, retryReference } = useShipment();
  const ports = usePorts();
  const rank = useRank(request);
  const weather = useWeather(5);
  const thresholds = useThresholds();
  // Discharge ports, plus the planner's own loading port (a queue there delays the voyage).
  const alerts = useAlerts(shipment ? { includeMarket: false, origin: shipment.origin } : null, thresholds);
  const alertList = actionable(alerts.data?.alerts ?? []);
  const [selectedParam, setSelected] = useSearchParam("port");
  const detailRef = useRef<HTMLDivElement>(null);

  const header = (
    <PageHeader
      meta="Discharge ports, east coast of India"
      title="Ports"
      description="What each port can take this month, how busy it is, the sea state ahead, and the traffic there now."
    />
  );

  if (referenceError || ports.isError) {
    return (
      <>
        {header}
        <ErrorState
          message="Couldn't load port details."
          onRetry={() => {
            retryReference();
            void ports.refetch();
          }}
        />
      </>
    );
  }
  if (!ports.data || !shipment || !reference) return <PageSkeleton />;

  const month = tr(monthLong(shipment.month));
  const views = buildViews(ports.data.ports, rank.data?.feasibility, weather.data?.ports);
  const recommended = rank.data?.ranked[0]?.port;
  const selectedName =
    selectedParam && views.some((v) => v.port.name === selectedParam) ? selectedParam : (recommended ?? views[0]?.port.name);
  const selected = views.find((v) => v.port.name === selectedName) ?? views[0];
  const waveMax = Math.max(
    2,
    ...views.flatMap((v) => v.weather?.wave_height_max_m ?? [])
  );

  const choose = (name: string, scroll: boolean) => {
    setSelected(name === recommended ? null : name);
    if (scroll) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <>
      {header}

      <div className="mb-6">
        <Field label="Delivery month" layout="inline">
          <Select
            label="Delivery month"
            value={String(shipment.month)}
            onChange={(v) => update({ month: Number(v) })}
            options={reference.months.map((m) => ({ value: String(m.value), label: tr(m.label) }))}
            className="w-[150px]"
          />
        </Field>
      </div>

      <Section
        first
        title="Port comparison"
        description={tr("Usable draft and vessel fit in {month}, with anything to watch at each port. Select a port for detail.", { month })}
        actions={<AlertSettings include={["wave_m", "wait_days", "activity_pct"]} />}
      >
        <AlertStrip alerts={alertList} loading={!alerts.data && !alerts.isError} />
        <Refreshing active={rank.isPlaceholderData}>
        <div className="hidden lg:block">
          <Table>
            <thead>
              <tr>
                <Th>Port</Th>
                <Th align="right">{tr("Usable draft, {month}", { month: tr(monthShort(shipment.month)) })}</Th>
                <Th>Classes</Th>
                <Th align="right">Discharge /day</Th>
                <Th align="right">Typical wait</Th>
                <Th align="right">Activity vs normal</Th>
                <Th>Max wave, next 5 days</Th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => (
                <Tr
                  key={v.port.name}
                  onSelect={() => choose(v.port.name, false)}
                  selected={v.port.name === selected?.port.name}
                  mark={v.port.name === recommended ? "signal" : "none"}
                  label={v.port.name === recommended ? tr("{port}, recommended", { port: tr(v.port.name) }) : tr(v.port.name)}
                >
                  <Td className="font-semibold">
                    {tr(v.port.name)}
                    {v.port.name === recommended && <span className="ml-2 font-normal text-signal">{tr("recommended")}</span>}
                    {v.port.port_type === "anchorage_transshipment" && (
                      <span className="block text-[12.5px] font-normal text-ink-3">
                        {tr("Anchorage, transships to {port}", { port: tr(v.port.rail_via_port ?? "") })}
                      </span>
                    )}
                    <PortFlags alerts={alertList} port={v.port.name} />
                  </Td>
                  <Td align="right">{v.usableDraft !== undefined ? metres(v.usableDraft) : "–"}</Td>
                  <Td>
                    <ClassMarks classes={v.classes} month={month} />
                  </Td>
                  <Td align="right" className="text-ink-2">
                    {v.port.discharge_rate_tpd ? `${num(v.port.discharge_rate_tpd / 1000, 0)}k t` : "–"}
                    {v.port.handling_type && (
                      <span className="block text-[12.5px] text-ink-3">{tr(HANDLING_SHORT[v.port.handling_type])}</span>
                    )}
                  </Td>
                  <Td align="right" className="text-ink-2">
                    {v.port.avg_wait_days_min}–{v.port.avg_wait_days_max} d
                  </Td>
                  <Td align="right">
                    <Activity port={v.port} />
                  </Td>
                  <Td>
                    {v.weather?.dates && v.weather.wave_height_max_m ? (
                      <span className="inline-flex items-center gap-3">
                        <WaveStrip dates={v.weather.dates} heights={v.weather.wave_height_max_m} max={waveMax} />
                        <span className="text-ink-2">{waveRange(v.weather)}</span>
                      </span>
                    ) : weather.isLoading ? (
                      <Skeleton className="h-4 w-24" />
                    ) : (
                      <span className="text-ink-3">–</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="lg:hidden">
          <MobileList>
            {views.map((v) => (
              <MobileItem
                key={v.port.name}
                onSelect={() => choose(v.port.name, true)}
                selected={v.port.name === selected?.port.name}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold text-ink">
                    {tr(v.port.name)}
                    {v.port.name === recommended && <span className="ml-2 font-normal text-signal">{tr("recommended")}</span>}
                  </span>
                  <span className="text-ink-2">
                    {v.usableDraft !== undefined ? tr("{m} usable", { m: metres(v.usableDraft) }) : metres(v.port.max_draft_m)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[13.5px] text-ink-3">
                  <ClassMarks classes={v.classes} month={month} />
                  <span>
                    {tr("Wait {min}–{max} d", { min: v.port.avg_wait_days_min, max: v.port.avg_wait_days_max })}
                    {v.port.activity_vs_normal_pct !== null && <> · {tr("activity {pct}", { pct: pct(v.port.activity_vs_normal_pct, 0, true) })}</>}
                    {waveRange(v.weather) && <> · {tr("waves {range}", { range: waveRange(v.weather)! })}</>}
                  </span>
                </div>
                <PortFlags alerts={alertList} port={v.port.name} />
              </MobileItem>
            ))}
          </MobileList>
        </div>
        </Refreshing>
      </Section>

      {selected && (
        <div ref={detailRef} className="scroll-mt-28">
          <PortDetail
            view={selected}
            month={month}
            waveMax={waveMax}
            recommended={selected.port.name === recommended}
            weatherLoading={weather.isLoading}
            classes={reference.vessel_classes}
            feasibility={rank.data?.feasibility ?? []}
            recommendedClass={rank.data?.ranked[0]?.vessel_class}
          />
        </div>
      )}

      <LoadPorts selectedOrigin={shipment.origin} />
    </>
  );
}

function LoadPorts({ selectedOrigin }: { selectedOrigin: string }) {
  const tr = useT();
  const loadPorts = useLoadPorts();
  const thresholds = useThresholds();
  const rows = loadPorts.data?.load_ports ?? [];
  return (
    <Section
      title="Loading ports"
      description="Size limits and loading rate at each origin terminal, and how busy it has been over the last four weeks against the year before."
    >
      {!loadPorts.data ? (
        loadPorts.isError ? (
          <ErrorState message="Couldn't load the loading ports." onRetry={() => void loadPorts.refetch()} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Origin</Th>
                  <Th align="right">Max draft</Th>
                  <Th align="right">Largest ship</Th>
                  <Th align="right">Loading /day</Th>
                  <Th align="right">Voyage</Th>
                  <Th align="right">Activity vs normal</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const o = originParts(r.origin);
                  const busy = r.activity_vs_normal_pct !== null && r.activity_vs_normal_pct >= thresholds.activity_pct;
                  return (
                    <Tr key={r.origin} mark={r.origin === selectedOrigin ? "signal" : "none"}>
                      <Td>
                        <span className="font-semibold">{tr(o.label)}</span>
                        {r.origin === selectedOrigin && <span className="ml-2 text-signal">{tr("your load port")}</span>}
                        {r.load_port && <span className="block text-[12.5px] text-ink-3">{r.load_port}</span>}
                      </Td>
                      <Td align="right">{r.max_draft_m !== null ? metres(r.max_draft_m) : "–"}</Td>
                      <Td align="right" className="text-ink-2">{r.max_dwt ? `${num(r.max_dwt / 1000)}k dwt` : "–"}</Td>
                      <Td align="right" className="text-ink-2">{r.load_rate_tpd ? `${num(r.load_rate_tpd / 1000)}k t` : "–"}</Td>
                      <Td align="right" className="text-ink-2">{days(r.transit_days)}</Td>
                      <Td align="right">
                        {r.activity_vs_normal_pct === null ? (
                          <span className="text-ink-3">–</span>
                        ) : (
                          <span className={busy ? "font-semibold text-caution" : "text-ink-2"}>
                            {pct(r.activity_vs_normal_pct, 0, true)}
                            {busy && ` ${tr("busy")}`}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <div className="md:hidden">
            <MobileList>
              {rows.map((r) => {
                const o = originParts(r.origin);
                return (
                  <MobileItem key={r.origin} mark={r.origin === selectedOrigin ? "signal" : "none"}>
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold text-ink">{tr(o.label)}</span>
                      <span className="text-ink-2">{r.max_draft_m !== null ? metres(r.max_draft_m) : "–"}</span>
                    </div>
                    <div className="mt-0.5 text-[13.5px] text-ink-3">
                      {r.load_port}
                      {r.activity_vs_normal_pct !== null && <> · {tr("activity {pct}", { pct: pct(r.activity_vs_normal_pct, 0, true) })}</>}
                    </div>
                  </MobileItem>
                );
              })}
            </MobileList>
          </div>
          {rows[0]?.activity_as_of && (
            <p className="mt-3 text-[13px] text-ink-3">{tr("Port calls to {date}.", { date: longDate(rows[0].activity_as_of) })}</p>
          )}
        </>
      )}
    </Section>
  );
}

const HISTORY_RANGES = [
  { value: "52", label: "1 year" },
  { value: "104", label: "2 years" },
  { value: "260", label: "5 years" },
] as const;

function PortTraffic({ port }: { port: string }) {
  const tr = useT();
  const [weeks, setWeeks] = useState<"52" | "104" | "260">("104");
  const [asTable, setAsTable] = useState(false);
  const history = usePortHistory(port, Number(weeks));
  const rows = history.data?.weeks ?? [];
  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{tr("Dry-bulk calls per week at {port}", { port: tr(port) })}</h3>
        <Segmented label="History shown" value={weeks} onChange={setWeeks} options={[...HISTORY_RANGES]} />
      </div>
      {!history.data ? (
        history.isError ? (
          <ErrorState message="Couldn't load the port's call history." onRetry={() => void history.refetch()} />
        ) : (
          <Skeleton className="h-[200px] w-full" />
        )
      ) : rows.length === 0 ? (
        <p className="text-[14px] text-ink-3">{tr("No call history for this port.")}</p>
      ) : (
        <Refreshing active={history.isPlaceholderData}>
          {asTable ? (
            <div className="max-h-[220px] overflow-y-auto text-[14px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-paper text-[12.5px] text-ink-3">
                  <tr>
                    <th className="py-1.5 text-left font-semibold">{tr("Week to")}</th>
                    <th className="py-1.5 text-right font-semibold">{tr("Calls")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.date} className="border-t border-rule">
                      <td className="py-1 text-ink-2">{longDate(r.date)}</td>
                      <td className="py-1 text-right text-ink">{r.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <CallsHistory weeks={rows} />
          )}
          <div className="mt-2 flex items-center justify-between text-[13px] text-ink-3">
            <span>{tr("Average {n} a week", { n: num(history.data.average_calls_per_week ?? 0, 1) })}</span>
            <Button variant="text" className="text-[13px]" onClick={() => setAsTable((v) => !v)}>
              {tr(asTable ? "Show chart" : "Show as table")}
            </Button>
          </div>
        </Refreshing>
      )}
    </div>
  );
}

const HANDLING_SHORT: Record<NonNullable<PortMapEntry["handling_type"]>, string> = {
  grab_unloaders: "Grab ship unloaders",
  mobile_harbour_cranes: "Mobile harbour cranes",
  floating_cranes: "Floating cranes",
};

const REGION = { lat: 18.5, lon: 85.5, zoom: 6 };

/** A monsoon window as "Jun–Sep", including windows that run past December ("Nov–Feb"). */
function monthSpan(months: number[], tr: (s: string) => string) {
  if (!months.length) return "–";
  const set = new Set(months);
  const start = months.find((m) => !set.has(((m + 10) % 12) + 1)) ?? months[0];
  let end = start;
  while (set.has((end % 12) + 1) && (end % 12) + 1 !== start) end = (end % 12) + 1;
  return start === end ? tr(monthShort(start)) : `${tr(monthShort(start))}–${tr(monthShort(end))}`;
}

function Activity({ port }: { port: PortMapEntry }) {
  const tr = useT();
  const thresholds = useThresholds();
  if (port.activity_vs_normal_pct === null) return <span className="text-ink-3">–</span>;
  const busy = port.activity_vs_normal_pct >= thresholds.activity_pct;
  return (
    <Tooltip
      content={tr("{calls} dry-bulk calls a day over the last 4 weeks, against {base} the year before.", {
        calls: num(port.recent_calls_per_day ?? 0, 2),
        base: num(port.baseline_calls_per_day ?? 0, 2),
      })}
    >
      <span tabIndex={0} className={busy ? "font-semibold text-caution" : "text-ink-2"}>
        {pct(port.activity_vs_normal_pct, 0, true)}
      </span>
    </Tooltip>
  );
}

/** One line above the table: what's flagged, with every group listed on demand. */
function AlertStrip({ alerts, loading }: { alerts: Alert[]; loading: boolean }) {
  const t = useT();
  if (loading) return <Skeleton className="mb-4 h-5 w-72" />;
  if (!alerts.length) return <p className="mb-4 text-[14px] text-ink-2">{t("Nothing to flag at any port right now.")}</p>;
  return (
    <details className="group mb-4 text-[14px]">
      <summary className="cursor-pointer list-none text-ink [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{alertSummary(alerts, t)}</span>
        <span className="ml-2 text-accent group-open:hidden">{t("Details")}</span>
        <span className="ml-2 hidden text-accent group-open:inline">{t("Hide")}</span>
      </summary>
      <div className="mt-3 max-w-3xl">
        <AlertList alerts={alerts} empty="" forceExpanded />
      </div>
    </details>
  );
}

function PortFlags({ alerts, port }: { alerts: Alert[]; port: string }) {
  const t = useT();
  const flags = portFlags(alerts, port, t);
  if (!flags.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-normal">
      {flags.map((f) => (
        <span key={f.label} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <SeverityTag severity={f.severity} />
          {f.label}
        </span>
      ))}
    </span>
  );
}

function PortDetail({
  view,
  month,
  waveMax,
  recommended,
  weatherLoading,
  classes,
  feasibility,
  recommendedClass,
}: {
  view: PortView;
  month: string;
  waveMax: number;
  recommended: boolean;
  classes: VesselClassInfo[];
  feasibility: FeasibilityRow[];
  recommendedClass?: string;
  weatherLoading: boolean;
}) {
  const tr = useT();
  const { port, weather } = view;
  const [scope, setScope] = useState<"port" | "region">("port");
  const [reloads, setReloads] = useState(0);
  const center = scope === "port" ? { lat: port.latitude, lon: port.longitude, zoom: 10 } : REGION;
  const src = `https://www.marinetraffic.com/en/ais/embed/zoom:${center.zoom}/centery:${center.lat}/centerx:${center.lon}/maptype:4/shownames:false/mmsi:0/shipid:0/fleet:/fleet_hash:`;
  const accepted = view.classes.filter((c) => c.state !== "not-accepted").map((c) => c.cls);
  const fitting = view.classes
    .filter((c) => c.state === "fits" || c.state === "part-loaded")
    .map((c) => (c.state === "part-loaded" ? tr("{cls} (part-loaded)", { cls: tr(c.cls) }) : tr(c.cls)));

  return (
    <>
      <Section
        title={tr(port.name)}
        description={`${coords(port.latitude, port.longitude)}${recommended ? ` · ${tr("recommended port")}` : ""}`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-12 gap-y-10">
          <div className="min-w-0">
            <SpecList
              rows={[
                ...(port.port_type === "anchorage_transshipment"
                  ? [
                      {
                        label: "Type",
                        value: tr("Offshore anchorage; cargo is transloaded to {port}, about {d} extra days", {
                          port: tr(port.rail_via_port ?? ""),
                          d: port.transshipment_days ?? 0,
                        }),
                      },
                    ]
                  : []),
                { label: "Max draft", value: metres(port.max_draft_m) },
                { label: tr("Usable draft in {month}", { month }), value: view.usableDraft !== undefined ? metres(view.usableDraft) : "–" },
                {
                  label: "Monsoon months",
                  value: `${monthSpan(port.monsoon_months, tr)}${
                    port.monsoon_closed
                      ? `, ${tr("closed")}`
                      : port.monsoon_draft_reduction_m > 0
                        ? `, ${tr("draft {m} less", { m: metres(port.monsoon_draft_reduction_m) })}`
                        : ""
                  }`,
                },
                { label: "Discharge rate", value: port.discharge_rate_tpd ? tr("{n} t/day", { n: num(port.discharge_rate_tpd) }) : "–" },
                {
                  label: "Unloading equipment",
                  value: port.handling_type
                    ? `${tr(HANDLING_SHORT[port.handling_type])}${port.shore_equipment ? `: ${port.shore_equipment}` : ""}`
                    : "–",
                },
                {
                  label: "Geared ships",
                  value:
                    port.handling_type === "grab_unloaders"
                      ? tr("Discharge with the shore unloaders, like every other ship")
                      : tr("Can add their own cranes and grabs, so they discharge faster here"),
                },
                { label: "Classes accepted", value: accepted.length ? accepted.map((c) => tr(c)).join(", ") : "–" },
                { label: tr("Fits in {month}", { month }), value: fitting.length ? fitting.join(", ") : tr("None") },
                { label: "Typical wait", value: tr("{min}–{max} days", { min: port.avg_wait_days_min, max: port.avg_wait_days_max }) },
                {
                  label: "Dry-bulk calls per day",
                  value:
                    port.recent_calls_per_day !== null
                      ? tr("{recent} lately, {base} the year before", {
                          recent: num(port.recent_calls_per_day, 2),
                          base: num(port.baseline_calls_per_day ?? 0, 2),
                        })
                      : port.real_avg_dry_bulk_calls_per_day !== null
                        ? num(port.real_avg_dry_bulk_calls_per_day, 2)
                        : "–",
                },
              ]}
            />
            <h3 className="mt-8 mb-4 text-[15px] font-semibold text-ink">{tr("Max wave height, next 5 days (m)")}</h3>
            {weather?.dates && weather.wave_height_max_m ? (
              <WaveStrip dates={weather.dates} heights={weather.wave_height_max_m} max={waveMax} size="md" />
            ) : weatherLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <p className="text-[14px] text-ink-3">{tr("Sea-state forecast unavailable right now.")}</p>
            )}
            <PortTraffic port={port.port_type === "anchorage_transshipment" && port.rail_via_port ? port.rail_via_port : port.name} />
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-ink">{tr("Vessel traffic now")}</h3>
              <div className="flex items-center gap-3">
                <Segmented
                  label="Map extent"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: "port", label: tr(port.name) },
                    { value: "region", label: "All ports" },
                  ]}
                />
                <Button onClick={() => setReloads((r) => r + 1)} aria-label={tr("Reload map")}>
                  <RefreshCw size={14} strokeWidth={1.75} />
                  <span className="hidden sm:inline">{tr("Reload")}</span>
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-sunken">
              <iframe
                key={`${port.name}-${scope}-${reloads}`}
                title={scope === "port" ? tr("Vessel traffic near {port}", { port: tr(port.name) }) : tr("Vessel traffic near the east-coast ports")}
                src={src}
                className="block h-[320px] w-full md:h-[440px]"
                style={{ border: 0 }}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </Section>
      <Section
        id="port-3d"
        title={tr("{port} in 3D", { port: tr(port.name) })}
        description={tr("A ship at the berth under this port's own equipment, the depth under its keel this month, and the ships waiting at anchor.")}
      >
        <WillItFit port={port} month={month} classes={classes} feasibility={feasibility} recommendedClass={recommendedClass} weather={weather} />
      </Section>
    </>
  );
}
