import { Suspense, lazy, useMemo, useState } from "react";
import { CallsHistory } from "../components/charts/CallsHistory";
import { FreightChart } from "../components/charts/FreightChart";
import { MiniLine } from "../components/charts/MiniLine";
import { PortLoadChart } from "../components/charts/PortLoadChart";
import { ScheduleStrip } from "../components/charts/ScheduleStrip";
import { ForecastSparkline } from "../components/charts/Sparkline";
import { StockMeter } from "../components/charts/StockMeter";
import { WaveStrip } from "../components/charts/WaveStrip";
import { DisruptionNotices } from "../components/dev/DisruptionNotices";
import { PageBoundary } from "../components/shell/PageBoundary";
import { prefersReducedMotion } from "../components/ship3d/colors";
import { type ShipSpec, ballastDraft, toSpec } from "../components/ship3d/hull";
import { type QualitySetting, setQualitySetting, useQualitySetting } from "../components/ship3d/quality";
import { SAMPLE_CLASSES } from "../components/ship3d/sampleShips";
import type { SkyPreset } from "../components/ship3d/Environment";
import { PerfReadout } from "../components/ship3d/PerfReadout";
import { ShipProfile } from "../components/ship3d/ShipProfile";
import { ShipCloseUp } from "../components/ship3d/ShipCloseUp";
import type { Viewpoint } from "../components/ship3d/ShipStage";
import { ShipTypes } from "../components/ship3d/ShipTypes";
import { FleetView, use3d } from "../components/ship3d/ShipView";
import { CoverageGlobe, FlatMap } from "../components/ship3d/VoyageView";
import { WillItFit } from "../components/ship3d/WillItFit";
import { AlertList, AlertSettings, SeverityTag } from "../components/ui/alerts";
import { DeveloperBadge } from "../components/ui/badge";
import { BarList, InlineBar, SplitBar } from "../components/ui/bars";
import { DriverCards } from "../components/ui/drivers";
import { EmptyState, ErrorState, ProgressHairline, Refreshing, Skeleton } from "../components/ui/feedback";
import { Delta, Figure, FigureRow, Verdict } from "../components/ui/figures";
import { Checkbox, DevLink, FormError, FormNotice, LinkedSentence, PasswordInput, PrimaryButton, SelectInput, TextInput } from "../components/ui/forms";
import { Button, Field, NumberField, Segmented, Select, Slider } from "../components/ui/inputs";
import { PageHeader, Section, SpecList } from "../components/ui/layout";
import { Popover, Sheet, Tooltip } from "../components/ui/overlay";
import { MobileItem, MobileList, Table, Td, Th, Tr } from "../components/ui/table";
import type { AlertThresholds } from "../api";
import { DEFAULT_THRESHOLDS } from "../lib/alertSettings";
import { useMoney } from "../lib/currency";
import { useChoiceParam } from "../lib/router";
import { useShipment } from "../lib/shipment";
import type { Alert, DriverSeries, FeasibilityRow, PortMapEntry } from "../types";

const SingleShip = lazy(() => import("../components/ship3d/ShipStage").then((m) => ({ default: m.SingleShip })));
const PortScene = lazy(() => import("../components/ship3d/PortStage").then((m) => ({ default: m.PortScene })));

const TABS = ["components", "3d", "notices"] as const;
type Tab = (typeof TABS)[number];

const SWATCHES = [
  "paper", "surface", "sunken", "hover", "rule", "rule-strong", "ink", "ink-2", "ink-3",
  "accent", "accent-hover", "accent-tint", "signal", "signal-fill", "signal-tint", "positive", "negative", "caution",
  "series-1", "series-2", "series-3", "series-4", "series-5", "grid", "band", "scrim", "overlay-border",
];

const DATES = ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

const BASE: Omit<Alert, "id" | "kind" | "port" | "value" | "severity" | "category"> = {
  vessel_class: null, title: "", message: "", threshold: 2.5, unit: "m", date: "2026-09-24", days_over: 3, days_total: 5,
  peak_date: "2026-09-25", direction: null, scope: "discharge",
};

/** Sample alerts of every kind; the kit's own thresholds decide which show. */
const SAMPLE_ALERTS: Alert[] = [
  { ...BASE, id: "w1", kind: "rough_sea", category: "weather", severity: "high", port: "Paradip", value: 4.1 },
  { ...BASE, id: "w2", kind: "rough_sea", category: "weather", severity: "high", port: "Gopalpur", value: 3.1 },
  { ...BASE, id: "w3", kind: "rough_sea", category: "weather", severity: "medium", port: "Dhamra", value: 2.7 },
  { ...BASE, id: "b1", kind: "busy", category: "congestion", severity: "medium", port: "Haldia", value: 42, unit: "%", threshold: 30, recent_calls_per_day: 1.89 },
  { ...BASE, id: "b2", kind: "busy", category: "congestion", severity: "medium", port: "Hay Point", value: 24, unit: "%", threshold: 20, scope: "load", recent_calls_per_day: 3.1 },
  { ...BASE, id: "l1", kind: "long_wait", category: "congestion", severity: "medium", port: "Haldia", value: 5.5, unit: "d", threshold: 5, wait_min_days: 4, wait_max_days: 7 },
  { ...BASE, id: "n1", kind: "notice", category: "disruption", severity: "high", port: "Paradip", value: null, title: "Berth 3 closed for dredging", message: "Berth 3 closed for dredging, 2 to 6 October." },
  { ...BASE, id: "m1", kind: "rate_move", category: "market", severity: "medium", port: null, vessel_class: "Capesize", value: -12, unit: "%", threshold: 10, direction: "down" },
  { ...BASE, id: "m2", kind: "rate_range", category: "market", severity: "medium", port: null, vessel_class: "Panamax", value: 46, unit: "%", threshold: 40 },
  { ...BASE, id: "u1", kind: "weather_unavailable", category: "data", severity: "info", port: null, value: null, title: "Sea-state forecast unavailable" },
];

function visibleAlerts(alerts: Alert[], t: AlertThresholds) {
  return alerts.filter((a) => {
    if (a.value === null) return true;
    switch (a.kind) {
      case "rough_sea":
        return a.value >= t.wave_m;
      case "busy":
        return a.value >= t.activity_pct;
      case "long_wait":
        return a.value >= t.wait_days;
      case "rate_move":
        return Math.abs(a.value) >= t.move_pct;
      case "rate_range":
        return a.value >= t.band_pct;
      default:
        return true;
    }
  });
}

function sampleForecast() {
  const history = Array.from({ length: 104 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 8, 27 + i * 7));
    return { date: d.toISOString().slice(0, 10), actual: 14000 + 3500 * Math.sin(i / 9) + 900 * Math.sin(i / 2.3) + i * 30 };
  });
  const last = history[history.length - 1];
  const forecast = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${last.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * (i + 1));
    const f = last.actual * (1 - 0.006 * (i + 1));
    const w = 400 + 260 * Math.sqrt(i + 1);
    return { date: d.toISOString().slice(0, 10), forecast: f, lower: f - w, upper: f + w };
  });
  return { history, forecast };
}

const SAMPLE_DRIVERS: DriverSeries[] = [
  { key: "coal_au", label: "Australian coal", unit: "USD/t", frequency: "monthly", source: "FRED", latest: { date: "2026-08-01", value: 138.4 }, change_3m_pct: 6.2, change_12m_pct: -9.8, history: Array.from({ length: 24 }, (_, i) => ({ date: `2024-${String((i % 12) + 1).padStart(2, "0")}-01`, value: 150 - i + 8 * Math.sin(i / 3) })) },
  { key: "brent", label: "Brent crude", unit: "USD/bbl", frequency: "weekly", source: "FRED", latest: { date: "2026-09-19", value: 78.2 }, change_3m_pct: -3.1, change_12m_pct: 4.5, history: Array.from({ length: 24 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`, value: 74 + 5 * Math.sin(i / 2) })) },
  { key: "usd_inr", label: "US dollar in rupees", unit: "INR", frequency: "weekly", source: "ECB", latest: { date: "2026-09-19", value: 88.1 }, change_3m_pct: 0.4, change_12m_pct: 2.1, history: Array.from({ length: 24 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`, value: 84 + i * 0.17 })) },
];

const SAMPLE_PORT: PortMapEntry = {
  name: "Dhamra", latitude: 20.82, longitude: 86.97, max_draft_m: 18, monsoon_draft_reduction_m: 0.5, monsoon_months: [6, 7, 8, 9], monsoon_closed: false,
  weather_delay_days_monsoon: 1, loa_max_m: 290, beam_max_m: 47, avg_wait_days_min: 2, avg_wait_days_max: 4,
  vessel_classes_allowed: ["Capesize", "Post-Panamax", "Panamax", "Supramax", "Handysize"], discharge_rate_tpd: 40000, port_type: "berth",
  rail_via_port: null, transshipment_days: null, real_avg_dry_bulk_calls_per_day: 1.6, recent_calls_per_day: 1.7, baseline_calls_per_day: 1.5,
  activity_vs_normal_pct: 13, activity_as_of: "2026-09-20", handling_type: "grab_unloaders", shore_equipment: "5 grab ship unloaders of 2,800 t/h and 2 mobile harbour cranes",
};

const SAMPLE_FEASIBILITY: FeasibilityRow[] = SAMPLE_CLASSES.map((c) => ({
  port_name: "Dhamra", vessel_class: c.name, feasible: c.draft_laden_m <= 17.5, part_loaded: c.name === "Capesize",
  usable_draft_m: 17.5, reasons_failed: "",
})) as FeasibilityRow[];

const SAMPLE_WEATHER = { dates: DATES, wave_height_max_m: [1.2, 1.8, 2.6, 2.1, 1.4] };

/** One 3D view in the kit, guarded: no WebGL shows the 2D profile, a crash shows an error, not a blank page. */
function Guard3d({ children, fallback, name }: { children: React.ReactNode; fallback: React.ReactNode; name: string }) {
  const ok = use3d(0);
  if (!ok) return <>{fallback}</>;
  return (
    <PageBoundary resetKey={name}>
      <Suspense fallback={<Skeleton className="h-[360px] w-full" />}>{children}</Suspense>
    </PageBoundary>
  );
}

/** The 3D test bench: every class under every sky, sea state, viewpoint and load, at a chosen quality. */
function ShipBench({ classes }: { classes: ShipSpec[] }) {
  const [ship, setShip] = useState(classes[classes.length - 1].name);
  const [sky, setSky] = useState<SkyPreset>("day");
  const [hs, setHs] = useState("1.5");
  const [load, setLoad] = useState<"laden" | "ballast">("laden");
  const [view, setView] = useState<Viewpoint>("overview");
  const quality = useQualitySetting();
  const spec = classes.find((c) => c.name === ship) ?? classes[0];
  const draft = load === "laden" ? spec.draft_laden_m : ballastDraft(spec);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Segmented label="Ship" value={ship} onChange={setShip} options={classes.map((c) => ({ value: c.name, label: c.name }))} />
        <Segmented label="Sky" value={sky} onChange={setSky} options={(["day", "golden", "dusk"] as const).map((k) => ({ value: k, label: k }))} />
        <Segmented label="Waves" value={hs} onChange={setHs} options={["0.3", "1.5", "3.5"].map((k) => ({ value: k, label: `${k} m` }))} />
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={(["overview", "bow", "bridge", "stern", "loadline", "underwater"] as const).map((k) => ({ value: k, label: k }))}
        />
        <Segmented label="Load" value={load} onChange={setLoad} options={[{ value: "laden", label: "Laden" }, { value: "ballast", label: "Ballast" }]} />
        <Segmented
          label="Quality"
          value={quality}
          onChange={(v) => setQualitySetting(v as QualitySetting)}
          options={(["auto", "high", "medium", "low"] as const).map((k) => ({ value: k, label: k }))}
        />
      </div>
      <PerfReadout />
      <p className="text-[13px] text-ink-3">
        {spec.name}: block coefficient {spec.block_coefficient ?? "–"}, {spec.hatch_cover_type === "folding" ? "hydraulic folding" : "side-rolling"} hatch covers,{" "}
        {spec.cranes ? `${spec.cranes} cranes of ${spec.crane_swl_t} t with grabs` : "gearless"}, draft {draft.toFixed(1)} m.
      </p>
      <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule">
        <Guard3d name={`bench-${ship}`} fallback={<ShipProfile spec={spec} draft={draft} label={spec.name} />}>
          <SingleShip
            key={`${ship}-${load}`}
            spec={spec}
            draft={draft}
            hs={Number(hs)}
            preset={sky}
            height={560}
            view={view}
            animate={!prefersReducedMotion()}
            label={`${spec.name} in ${hs} m waves, ${sky}`}
          />
        </Guard3d>
      </div>
    </div>
  );
}

function PortBench({ classes }: { classes: ShipSpec[] }) {
  const [handling, setHandling] = useState<"grab_unloaders" | "mobile_harbour_cranes" | "floating_cranes">("grab_unloaders");
  const [view, setView] = useState<"berth" | "anchorage" | "keel">("berth");
  const spec = classes.find((c) => c.name === "Panamax") ?? classes[0];
  const berth = handling !== "floating_cranes";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Equipment"
          value={handling}
          onChange={setHandling}
          options={[
            { value: "grab_unloaders", label: "Grab unloaders" },
            { value: "mobile_harbour_cranes", label: "Mobile harbour cranes" },
            { value: "floating_cranes", label: "Floating cranes (anchorage)" },
          ]}
        />
        <Segmented label="Camera" value={view} onChange={setView} options={(["berth", "anchorage", "keel"] as const).map((k) => ({ value: k, label: k }))} />
      </div>
      <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule">
        <Guard3d name={`port-${handling}`} fallback={<ShipProfile spec={spec} label={spec.name} />}>
          <PortScene
            spec={spec}
            draft={spec.draft_laden_m}
            usable={17.5}
            hs={1.4}
            berth={berth}
            maxLoa={290}
            queue={5}
            queueSpecs={classes}
            view={view}
            clearanceText="3.3 m under the keel"
            handling={handling}
            equipment={handling === "mobile_harbour_cranes" ? "8 mobile harbour cranes" : "5 grab ship unloaders"}
            animate={!prefersReducedMotion()}
            label="Port scene test"
          />
        </Guard3d>
      </div>
    </div>
  );
}

function Components() {
  const money = useMoney();
  const [seg, setSeg] = useState("12");
  const [sel, setSel] = useState("a");
  const [n, setN] = useState(75000);
  const [slider, setSlider] = useState(3);
  const [row, setRow] = useState(1);
  const [thresholds, setThresholds] = useState<AlertThresholds>(DEFAULT_THRESHOLDS);
  const [email, setEmail] = useState("planner@");
  const [password, setPassword] = useState("harbour");
  const [role, setRole] = useState("Chartering");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [retries, setRetries] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const forecast = useMemo(() => sampleForecast(), []);
  const alerts = visibleAlerts(SAMPLE_ALERTS, thresholds);

  return (
    <>
      <Section first title="Colour tokens">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {SWATCHES.map((s) => (
            <div key={s}>
              <div className="h-10 rounded-[var(--radius-control)] border border-rule" style={{ background: `var(--color-${s})` }} />
              <div className="mt-1 text-[12.5px] text-ink-3">{s}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <p className="serif text-[34px] font-semibold leading-tight">Page title, Source Serif 4</p>
        <p className="serif mt-3 text-[25px] font-[450]">Verdict sentence in the serif.</p>
        <p className="serif mt-3 text-[20px] font-semibold">Section title</p>
        <p className="mt-3 max-w-[68ch]">Body copy in Source Sans 3 at 15px. Figures align in columns: 1,065,750 / 14.21 / 3.5 d / ₹10.20 cr / −$1,200.</p>
        <p className="mt-2 text-[13px] font-semibold text-ink-3">Label</p>
        <p className="text-[12.5px] text-ink-3">Caption text</p>
      </Section>

      <Section title="Verdict and figures">
        <Verdict support="Supporting sentence in the sans.">Book 6 months of Panamax voyages into Dhamra.</Verdict>
        <FigureRow>
          <Figure label="Landed cost" value="$14.21" unit=" /t" />
          <Figure label="Shipment total" value="$1,065,750" />
          <Figure label="Spare at Paradip" value="1.2" unit=" m" tone="positive" note="usable depth 16.0 m" />
          <Figure label="Over the limit" value="0.8" unit=" m" tone="negative" />
          <Figure label="Change" value={<Delta value={2.4} goodWhen="negative">+2.4%</Delta>} />
        </FigureRow>
        <div className="mt-6">
          <Verdict size="sm">A smaller verdict for a section.</Verdict>
        </div>
      </Section>

      <Section title="Inputs" actions={<Segmented label="Demo" value={seg} onChange={setSeg} options={[{ value: "8", label: "8 weeks" }, { value: "12", label: "12 weeks" }, { value: "26", label: "26 weeks" }]} />}>
        <div className="grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-3">
          <Field label="Select">
            <Select label="Demo" value={sel} onChange={setSel} options={[{ value: "a", label: "Hay Point / Dalrymple Bay, Australia", short: "Hay Point, Australia" }, { value: "b", label: "Nacala / Beira, Mozambique" }]} />
          </Field>
          <Field label="Number (click the label: nothing changes)">
            <NumberField label="Cargo" value={n} onCommit={setN} min={10000} max={200000} step={5000} unit="t" />
          </Field>
          <Slider label="Slider" min={1} max={5} value={slider} onChange={setSlider} />
        </div>
        <p className="mt-2 text-[13px] text-ink-3">Cargo {n.toLocaleString()} t · slider {slider} · segmented {seg} · select {sel}</p>
        <div className="mt-4">
          <Field label="Inline field" layout="inline">
            <Segmented label="Inline" value={seg} onChange={setSeg} options={[{ value: "8", label: "8" }, { value: "12", label: "12" }]} />
          </Field>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button>Secondary button</Button>
          <Button disabled>Disabled</Button>
          <Button variant="text">Text button</Button>
          <Tooltip content="Tooltip content in the sans, 13.5px.">
            <span tabIndex={0} className="text-accent underline underline-offset-4">Hover for tooltip</span>
          </Tooltip>
          <Popover title="Popover" trigger={<Button>Open popover</Button>}>
            <p className="text-[14px] text-ink-2">A small panel anchored to its button.</p>
          </Popover>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <DeveloperBadge />
          <SeverityTag severity="high" />
          <SeverityTag severity="medium" />
          <SeverityTag severity="info" />
        </div>
        <Sheet open={sheet} onOpenChange={setSheet} title="Bottom sheet" footer={<Button onClick={() => setSheet(false)}>Done</Button>}>
          <p className="text-[14px] text-ink-2">The phone-width panel for the shipment inputs.</p>
        </Sheet>
      </Section>

      <Section title="Forms">
        <form className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Your work email is best." error={email.includes(".") ? null : "Enter a full email address."} />
          <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="new-password" showStrength />
          <SelectInput label="Role" value={role} onChange={setRole} options={["Chartering", "Logistics", "Finance"]} />
          <div className="self-end">
            <Checkbox checked={agree} onChange={setAgree}>
              I agree to the terms
            </Checkbox>
          </div>
          <div className="sm:col-span-2 space-y-3">
            <FormError>{agree ? null : "Tick the box to continue."}</FormError>
            <FormNotice>We sent a link to your email.</FormNotice>
            <DevLink link="http://localhost:5173/verify-email?token=sample" />
            <p className="text-[14px] text-ink-2">
              <LinkedSentence text="Already have an account? {link}." link={<a className="text-accent underline" href="#forms">Sign in</a>} />
            </p>
            <PrimaryButton
              type="button"
              busy={busy}
              className="sm:w-auto"
              onClick={() => {
                setBusy(true);
                window.setTimeout(() => setBusy(false), 1500);
              }}
            >
              Busy for 1.5 s
            </PrimaryButton>
          </div>
        </form>
      </Section>

      <Section title="Table">
        <div className="hidden sm:block">
          <Table>
            <thead>
              <tr>
                <Th align="right">#</Th>
                <Th>Port</Th>
                <Th align="right">Landed cost /t</Th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((r) => (
                <Tr key={r} onSelect={() => setRow(r)} selected={row === r} mark={r === 1 ? "signal" : "none"} label={`Rank ${r}, Port ${r}`}>
                  <Td align="right" className="text-ink-3">{r}</Td>
                  <Td className="font-semibold">Port {r}</Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-3">
                      <InlineBar value={10 + r} max={14} />${(12 + r).toFixed(2)}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="max-w-sm sm:mt-4">
          <MobileList>
            {[1, 2, 3].map((r) => (
              <MobileItem key={r} onSelect={() => setRow(r)} selected={row === r} mark={r === 1 ? "signal" : "none"}>
                Port {r}
                {r === 1 && <span className="ml-2 text-ink-3">recommended</span>}
              </MobileItem>
            ))}
          </MobileList>
        </div>
        <p className="mt-2 text-[13px] text-ink-3">Selected row {row}. Row 1 keeps its recommended mark when another row is selected.</p>
      </Section>

      <Section title="Bars and charts">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <BarList
            rows={[
              { label: "Rail to plant", value: 664, display: "$664,000", share: "62%", compare: 690, compareDisplay: "$690,000" },
              { label: "Ocean hire", value: 208, display: "$208,000", share: "20%", compare: 190, compareDisplay: "$190,000" },
              { label: "Bunker fuel", value: 120, display: "$120,000", share: "11%", compare: 118, compareDisplay: "$118,000" },
              { label: "Waiting time (hire)", value: 0, display: "$0", share: "0%", compare: 12, compareDisplay: "$12,000" },
            ]}
            compareLabel="Rank 1, Dhamra"
          />
          <div className="space-y-8">
            <SplitBar parts={[{ label: "Contract", pct: 60, color: "var(--color-series-1)" }, { label: "Spot", pct: 40, color: "var(--color-series-2)" }]} />
            <PortLoadChart rows={[{ port: "Dhamra", calls: 2 }, { port: "Gopalpur", calls: 3 }, { port: "Gangavaram", calls: 1 }]} limit={2} />
            <PortLoadChart rows={[{ port: "Dhamra", calls: 3 }, { port: "Paradip", calls: 2 }]} limit={2} limits={{ Dhamra: 4, Paradip: 2 }} />
            <WaveStrip dates={DATES} heights={[2.8, 2.4, 2.1, 1.6, 1.3]} max={3} size="md" />
            <WaveStrip dates={DATES} heights={[2.8, 2.4, 2.1, 1.6, 1.3]} max={3} />
            <MiniLine values={[3, 4, 3.6, 5, 4.4, 6]} label="Sample trend" />
          </div>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Freight chart, $/day</h3>
            <FreightChart data={forecast} range="1y" money={money} height={300} bestWeek={{ date: forecast.forecast[5].date, rate: forecast.forecast[5].forecast }} />
          </div>
          <div>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Freight chart, $/t, phone width</h3>
            <div className="max-w-[360px]">
              <FreightChart
                data={{ history: forecast.history.map((h) => ({ ...h, actual: h.actual / 900 })), forecast: forecast.forecast.map((f) => ({ ...f, forecast: f.forecast / 900, lower: f.lower / 900, upper: f.upper / 900 })) }}
                range="6m"
                money={money}
                height={240}
                unit="tonne"
              />
            </div>
          </div>
          <div>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Calls per week</h3>
            <CallsHistory weeks={forecast.history.map((h, i) => ({ date: h.date, calls: Math.round(8 + 4 * Math.sin(i / 5)) }))} />
          </div>
          <div>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Market drivers</h3>
            <DriverCards drivers={SAMPLE_DRIVERS} />
          </div>
        </div>
      </Section>

      <Section title="Alerts" description="Sandboxed: these settings change only the samples here, not your saved alert thresholds." actions={<AlertSettings value={thresholds} onChange={setThresholds} />}>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Grouped ({alerts.length} of {SAMPLE_ALERTS.length} over the thresholds)</h3>
            <AlertList alerts={alerts} empty="Nothing to flag." />
          </div>
          <div>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Expanded</h3>
            <AlertList alerts={alerts} empty="Nothing to flag." forceExpanded />
            <h3 className="mb-3 mt-6 text-[14px] font-semibold text-ink">Empty</h3>
            <AlertList alerts={[]} empty="Nothing to flag." />
          </div>
        </div>
      </Section>

      <Section title="Plan components">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <ScheduleStrip
            months={[
              { month: 10, month_label: "October", port: "Dhamra", vessel_class: "Panamax", n_voyages: 1, monsoon: false, note: null },
              { month: 11, month_label: "November", port: "Dhamra", vessel_class: "Panamax", n_voyages: 1, monsoon: false, note: null },
              { month: 6, month_label: "June", port: "Paradip", vessel_class: "Panamax", n_voyages: 2, monsoon: true, note: "Monsoon month at this port" },
              { month: 12, month_label: "December", port: null, note: "No option fits this month." },
            ]}
          />
          <div className="space-y-6">
            <StockMeter cover={40} target={30} arrival={25.8} />
            <StockMeter cover={20} target={30} arrival={25.8} />
            <StockMeter cover={10} target={30} arrival={25.8} />
            <ForecastSparkline current={20687} points={[20100, 19800, 20500, 21000, 21400, 21800]} bestIndex={2} />
          </div>
        </div>
      </Section>

      <Section title="Feedback states">
        <div className="space-y-4">
          <ErrorState message={`Couldn't calculate the ranking for this shipment. (Retried ${retries} times.)`} onRetry={() => setRetries((r) => r + 1)} />
          <EmptyState>No port can take this cargo in June.</EmptyState>
          <Skeleton className="h-10 w-64" />
          <ProgressHairline active />
          <div className="flex items-center gap-3">
            <Button onClick={() => setRefreshing((r) => !r)}>{refreshing ? "Stop refreshing" : "Show refreshing"}</Button>
          </div>
          <Refreshing active={refreshing}>
            <SpecList rows={[{ label: "Max draft", value: "18.0 m" }, { label: "Typical wait", value: "2–4 days" }]} />
          </Refreshing>
        </div>
      </Section>
    </>
  );
}

function ThreeD() {
  const { reference } = useShipment();
  const classes = (reference?.vessel_classes?.length ? reference.vessel_classes : SAMPLE_CLASSES).map(toSpec);
  const info = reference?.vessel_classes?.length ? reference.vessel_classes : SAMPLE_CLASSES;
  const [fleetPick, setFleetPick] = useState<string | null>(null);
  return (
    <>
      <Section first title="One ship" description="Every class, sky, sea state, viewpoint and load; the quality setting applies to every 3D view.">
        <ShipBench classes={classes} />
      </Section>
      <Section title="The fleet" description="All five classes side by side, sterns lined up.">
        <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-surface">
          <FleetView
            specs={classes}
            selected={fleetPick}
            onSelect={setFleetPick}
            resetLabel="Show all"
            labelFor={(s) => `${s.name}, ${s.loa_m} m`}
            caption3d="Drag to turn, scroll or pinch to zoom."
            caption2d="Profiles to scale."
          />
        </div>
      </Section>
      <Section title="Ship types (as on Vessel & port)">
        <ShipTypes classes={info} recommended="Panamax" port="Dhamra" feasibility={SAMPLE_FEASIBILITY} weather={{ ports: { Dhamra: SAMPLE_WEATHER } }} />
      </Section>
      <Section title="Close-up with the load slider">
        <ShipCloseUp spec={classes[1]} port="Paradip" portEntry={SAMPLE_PORT} usable={16} weather={SAMPLE_WEATHER} />
      </Section>
      <Section title="Port scene" description="Grab unloaders, mobile harbour cranes, or floating cranes at an anchorage port.">
        <PortBench classes={classes} />
      </Section>
      <Section title="Will it fit (as on Ports)">
        <WillItFit port={SAMPLE_PORT} month="October" classes={info} feasibility={SAMPLE_FEASIBILITY} recommendedClass="Panamax" weather={SAMPLE_WEATHER} />
      </Section>
      <Section title="Globe" description="Every route the planner covers (public data).">
        <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule">
          <CoverageGlobe height={420} />
        </div>
      </Section>
      <Section title="Flat map (no-WebGL fallback)">
        <FlatMap
          routes={[{ coords: [[149.2, -21.2], [135, -12], [110, -8], [95, 5], [86.97, 20.82]], highlight: true }]}
          points={[
            { lon: 149.2, lat: -21.2, kind: "load", name: "Hay Point" },
            { lon: 86.97, lat: 20.82, kind: "discharge" },
          ]}
          box={[60, 160, -35, 30]}
          label="Sample route on the flat map"
        />
      </Section>
      <Section title="2D profiles">
        <div className="space-y-3">
          {classes.map((c) => (
            <ShipProfile key={c.name} spec={c} scaleLength={290} label={c.name} className="max-h-[80px]" />
          ))}
        </div>
      </Section>
    </>
  );
}

/** Developer tools: the component gallery, the 3D test bench and the disruption notices. */
export default function Kit() {
  const [tab, setTab] = useChoiceParam<Tab>("tab", "components", TABS);
  return (
    <>
      <PageHeader meta="Developer tools" title="Developer tools" description="Every building block and its states, the 3D test bench, and the port disruption notices that feed the alerts." />
      <div className="mb-8">
        <Segmented
          label="Tool"
          value={tab}
          onChange={setTab}
          options={[
            { value: "components", label: "Component kit" },
            { value: "3d", label: "3D bench" },
            { value: "notices", label: "Disruption notices" },
          ]}
        />
      </div>
      {tab === "components" && <Components />}
      {tab === "3d" && <ThreeD />}
      {tab === "notices" && <DisruptionNotices />}
    </>
  );
}
