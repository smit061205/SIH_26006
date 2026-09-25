import { useQuery } from "@tanstack/react-query";
import {
  Anchor,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  Clock3,
  Database,
  KeyRound,
  Layers,
  LineChart,
  Lock,
  Scale,
  ShieldCheck,
  Ship,
  Sparkles,
  Waves,
} from "lucide-react";
import { type ReactNode, Suspense, lazy, useEffect, useRef, useState } from "react";
import { getPublicPorts, getPublicSummary } from "../api";
import { prefersReducedMotion } from "../components/ship3d/colors";
import type { ShipSpec } from "../components/ship3d/hull";
import type { Viewpoint } from "../components/ship3d/ShipStage";
import { ShipProfile } from "../components/ship3d/ShipProfile";
import { use3d } from "../components/ship3d/ShipView";
import { CoverageGlobe } from "../components/ship3d/VoyageView";
import { Skeleton } from "../components/ui/feedback";
import { pct, shortDate } from "../lib/format";
import { useT } from "../lib/i18n";
import { Link } from "../lib/router";
import { DemoButton } from "../components/shell/PublicShell";
import { type ThemeChoice, useTheme } from "../lib/theme";

const SingleShip = lazy(() => import("../components/ship3d/ShipStage").then((m) => ({ default: m.SingleShip })));

// Particulars from data/vessel_classes.csv (the reference API needs a sign-in).
const SUPRAMAX: ShipSpec = { name: "Supramax", loa_m: 190, beam_m: 32.26, depth_m: 18.3, draft_laden_m: 12.8, holds: 5, cranes: 4, payload_tonnes: 57000, tpc: 57, block_coefficient: 0.84, hatch_cover_type: "folding", crane_swl_t: 35 };
const wrap = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

/** The landing page is always in the light theme; the viewer's own choice returns when they leave it. */
function useLightTheme(choice: ThemeChoice) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "light");
    return () => {
      if (choice === "system") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", choice);
    };
  }, [choice]);
}

/** A faint nautical chart behind the hero: depth contours and a graticule. */
const CHART_BG = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='420' viewBox='0 0 640 420'><g fill='none' stroke='#1e3a5f' stroke-opacity='0.07' stroke-width='1'><path d='M-20 80 C 90 40, 180 120, 300 90 S 520 40, 660 100'/><path d='M-20 130 C 100 95, 200 170, 320 140 S 530 95, 660 150'/><path d='M-20 185 C 110 150, 210 225, 330 195 S 540 150, 660 205'/><path d='M-20 245 C 120 205, 220 285, 340 255 S 550 210, 660 265'/><path d='M-20 310 C 130 270, 230 350, 350 320 S 560 275, 660 330'/><path d='M-20 375 C 140 335, 240 415, 360 385 S 570 340, 660 395'/></g><g stroke='#1e3a5f' stroke-opacity='0.045' stroke-width='1'><path d='M0 0V420M160 0V420M320 0V420M480 0V420M0 105H640M0 210H640M0 315H640'/></g></svg>`
)}")`;

function useSummary() {
  return useQuery({ queryKey: ["public-summary"], queryFn: ({ signal }) => getPublicSummary(signal), staleTime: 10 * 60_000 });
}

function usePortConditions() {
  return useQuery({ queryKey: ["public-ports"], queryFn: ({ signal }) => getPublicPorts(signal), staleTime: 10 * 60_000 });
}

/** Wave height as a colour: calm, worth watching, rough enough to stop cargo work. */
function seaTone(h: number) {
  return h >= 3.5 ? "var(--color-negative)" : h >= 2.5 ? "var(--color-caution)" : "var(--color-series-1)";
}

/** The hero's product panel: conditions at every discharge port right now, live from the service. */
function ConditionsPanel() {
  const t = useT();
  const q = usePortConditions();
  const ports = q.data?.ports ?? [];
  const dates = ports.find((p) => p.dates)?.dates ?? null;
  const top = Math.max(4, ...ports.flatMap((p) => p.wave_height_max_m ?? []));
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[28px] bg-[radial-gradient(60%_60%_at_60%_40%,rgba(30,58,95,0.16),transparent_70%)]" />
      <div className="overflow-hidden rounded-2xl border border-rule bg-surface shadow-[0_24px_60px_-20px_rgba(21,23,27,0.28),0_2px_6px_rgba(21,23,27,0.06)]">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rule-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-rule-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-rule-strong" />
            <span className="ml-3 text-[13px] font-semibold text-ink">{t("Discharge ports now")}</span>
          </div>
          {q.data && q.data.weather !== "unavailable" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-[12px] font-semibold text-positive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" />
              {t("Live")}
            </span>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-x-5 px-5 pt-4 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          <span>{t("Port")}</span>
          <span className="w-[112px] whitespace-nowrap">{t("Waves, 5 days")}</span>
          <span className="w-[72px] whitespace-nowrap text-right">{t("Vs usual")}</span>
        </div>
        <ul className="divide-y divide-rule px-5">
          {!q.data
            ? [0, 1, 2, 3, 4, 5, 6].map((i) => (
                <li key={i} className="py-2.5">
                  <Skeleton className="h-5 w-full" />
                </li>
              ))
            : ports.map((p) => {
                const peak = p.wave_height_max_m ? Math.max(...p.wave_height_max_m) : null;
                const busy = p.activity_vs_normal_pct;
                return (
                  <li key={p.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-5 py-2.5">
                    <span className="truncate text-[14px] font-semibold text-ink">{t(p.name)}</span>
                    <span
                      className="flex h-[22px] w-[112px] items-end gap-[3px]"
                      role="img"
                      aria-label={peak != null ? t("Waves up to {h} m in the next 5 days", { h: peak.toFixed(1) }) : t("Sea-state forecast unavailable right now.")}
                    >
                      {(p.wave_height_max_m ?? []).map((h, i) => (
                        <span
                          key={i}
                          title={dates ? `${shortDate(dates[i])}: ${h.toFixed(1)} m` : undefined}
                          className="flex-1 rounded-[2px]"
                          style={{ height: `${Math.max(12, (h / top) * 100)}%`, background: seaTone(h) }}
                        />
                      ))}
                    </span>
                    <span className={`w-[72px] text-right text-[13px] font-semibold tabular-nums ${busy == null ? "text-ink-3" : busy > 15 ? "text-signal" : "text-ink-2"}`}>
                      {busy == null ? "–" : pct(busy, 0, true)}
                    </span>
                  </li>
                );
              })}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-2 pb-3 text-[12px] text-ink-3">
          {[
            ["var(--color-series-1)", t("Under 2.5 m")],
            ["var(--color-caution)", t("2.5–3.5 m")],
            ["var(--color-negative)", t("Over 3.5 m")],
          ].map(([c, label]) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: c }} />
              {label}
            </span>
          ))}
          <span className="ml-auto">{t("Dry-bulk calls, last 4 weeks")}</span>
        </div>
        <div className="grid grid-cols-3 border-t border-rule bg-paper/60 text-center">
          {[
            [t("Best week to fix"), CalendarClock],
            [t("Contract or spot"), Scale],
            [t("26-week forecast"), LineChart],
          ].map(([label, Icon]) => {
            const I = Icon as typeof Ship;
            return (
              <div key={label as string} className="flex flex-col items-center gap-1.5 border-r border-rule px-2 py-3.5 last:border-r-0">
                <I size={17} strokeWidth={1.8} className="text-accent" aria-hidden />
                <span className="text-[12.5px] font-semibold text-ink-2">{label as string}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const t = useT();
  return (
    <section className="relative isolate overflow-hidden border-b border-rule bg-paper">
      <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundImage: CHART_BG, backgroundSize: "640px 420px" }} />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_85%_0%,rgba(30,58,95,0.10),transparent_60%),radial-gradient(50%_50%_at_0%_100%,rgba(196,80,26,0.07),transparent_60%)]" />
      <div className={`${wrap} grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:gap-16 lg:py-24`}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-rule bg-surface/80 px-3 py-1.5 text-[12.5px] font-semibold text-ink-2 shadow-sm backdrop-blur">
            <Sparkles size={14} className="text-signal" aria-hidden />
            {t("Smart India Hackathon 2026 · SIH26006 · Ministry of Steel")}
          </p>
          <h1 className="serif mt-6 text-[42px] font-semibold leading-[1.04] tracking-[-0.02em] text-ink sm:text-[54px] lg:text-[60px]">
            {t("Charter coking coal with the whole voyage in view.")}
          </h1>
          <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]">
            {t("Which ship to charter, when to fix it, how much to put on contract and what could go wrong, worked out from freight markets, port depths, sea forecasts and rail links to five steel plants.")}
          </p>
          <div className="mt-9 flex flex-wrap items-start gap-3">
            <DemoButton className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-[15px] font-semibold text-surface shadow-[0_6px_18px_-6px_rgba(30,58,95,0.55)] transition-colors hover:bg-accent-hover disabled:opacity-70">
              {t("Try the live demo")}
              <ArrowRight size={16} aria-hidden />
            </DemoButton>
            <a href="#features" className="inline-flex items-center gap-2 rounded-lg border border-rule-strong bg-surface px-5 py-3 text-[15px] font-semibold text-ink transition-colors hover:bg-hover">
              {t("See what it does")}
            </a>
          </div>
          <p className="mt-3 text-[13.5px] text-ink-3">{t("No sign-up: the planner opens straight away, and anything you save is deleted after a day.")}</p>
          <ul className="mt-9 grid gap-2.5 text-[14.5px] text-ink-2 sm:grid-cols-2">
            {[
              "Live sea state and port traffic at every port",
              "Every vessel type checked at both ports",
              "Landed cost to the plant, not just freight",
              "English and हिन्दी, US$ and ₹",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
                  <Check size={12} strokeWidth={2.6} aria-hidden />
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
        <ConditionsPanel />
      </div>
    </section>
  );
}

/** The public sources the figures come from. */
function SourcesStrip() {
  const t = useT();
  const sources = ["Open-Meteo", "IMF PortWatch", "FRED", "European Central Bank", "MarineTraffic", "Indian Railways FOIS"];
  return (
    <div className="border-b border-rule bg-surface">
      <div className={`${wrap} flex flex-col items-center gap-4 py-7 md:flex-row md:justify-between`}>
        <p className="shrink-0 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{t("Built on public data from")}</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
          {sources.map((s) => (
            <li key={s} className="text-[14.5px] font-semibold tracking-[-0.005em] text-ink-2/80">
              {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CoverageStats() {
  const t = useT();
  const q = useSummary();
  const d = q.data;
  const items: [string, ReactNode][] = [
    [t("coal load ports abroad"), d?.load_ports],
    [t("discharge ports on India's east coast"), d?.ports],
    [t("SAIL integrated steel plants"), d?.plants],
    [t("vessel types, Handysize to Capesize"), d?.vessel_types],
  ];
  return (
    <section className={`${wrap} py-16`}>
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-rule bg-surface px-5 py-5">
            <dd className="serif text-[34px] font-semibold leading-none text-ink">{value ?? <Skeleton className="h-8 w-10" />}</dd>
            <dt className="mt-2 text-[13.5px] leading-snug text-ink-3">{label}</dt>
          </div>
        ))}
        <div className="col-span-2 rounded-xl border border-accent/25 bg-accent-tint px-5 py-5 lg:col-span-1">
          <dd className="serif text-[34px] font-semibold leading-none text-accent">
            {d ? t("{p}% lower", { p: d.savings.median_saving_pct }) : <Skeleton className="h-8 w-24" />}
          </dd>
          <dt className="mt-2 text-[13.5px] leading-snug text-ink-2">
            {d
              ? t("hire on 6-month contracts planned this way than fixing spot month by month, cheaper in {p}% of months since {year}", {
                  p: d.savings.cheaper_share_pct,
                  year: d.savings.since.slice(0, 4),
                })
              : " "}
          </dt>
        </div>
      </dl>
    </section>
  );
}

function SectionHead({ id, eyebrow, title, intro, center = false }: { id?: string; eyebrow: string; title: string; intro?: string; center?: boolean }) {
  const t = useT();
  return (
    <div id={id} className={`max-w-[64ch] scroll-mt-24 ${center ? "mx-auto text-center" : ""}`}>
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-signal">{t(eyebrow)}</p>
      <h2 className="serif mt-3 text-[32px] font-semibold leading-[1.12] tracking-[-0.015em] text-ink sm:text-[40px]">{t(title)}</h2>
      {intro && <p className="mt-4 text-[16.5px] leading-relaxed text-ink-2">{t(intro)}</p>}
    </div>
  );
}

function IconTile({ icon: Icon }: { icon: typeof Ship }) {
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-accent/15 bg-accent-tint text-accent">
      <Icon size={19} strokeWidth={1.8} aria-hidden />
    </span>
  );
}

function Problem() {
  const t = useT();
  const points = [
    { icon: Clock3, title: "Fixing late costs money", body: "A ship chartered when the cargo is already due pays whatever the spot market asks that week." },
    { icon: Anchor, title: "Waiting ships run up hire", body: "Every day a ship waits off a busy or monsoon-hit port is paid for at the charter rate." },
    { icon: Waves, title: "Ports decide the ship", body: "Depth, length and unloading equipment at both ends decide which ship can carry the cargo, and they change with the season." },
  ];
  return (
    <section className="border-y border-rule bg-sunken/60 py-20">
      <div className={wrap}>
        <SectionHead eyebrow="The problem" title="Coking coal crosses oceans. Planning it shouldn't be guesswork." />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {points.map(({ icon, title, body }) => (
            <div key={title} className="rounded-xl border border-rule bg-surface p-6">
              <IconTile icon={icon} />
              <h3 className="mt-5 text-[17.5px] font-semibold text-ink">{t(title)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{t(body)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Small drawings for the feature cards, in the app's own style. Shapes, not figures. */

function MiniForecast() {
  return (
    <svg viewBox="0 0 220 70" className="h-[60px] w-full" aria-hidden>
      <path d="M110 30 L140 22 L170 16 L220 8 L220 50 L170 44 L140 40 L110 30 Z" fill="var(--color-band)" />
      <path d="M0 44 L22 40 L44 48 L66 34 L88 38 L110 30" fill="none" stroke="var(--color-series-1)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M110 30 L140 31 L170 28 L220 30" fill="none" stroke="var(--color-signal)" strokeWidth="2.2" strokeDasharray="5 4" />
      <circle cx="140" cy="31" r="5" fill="var(--color-surface)" stroke="var(--color-signal-fill)" strokeWidth="2" />
    </svg>
  );
}

function MiniRoutes() {
  const t = useT();
  const rows = [
    ["Hay Point → Paradip", 0.62],
    ["Nacala → Dhamra", 0.48],
    ["Tanjung Bara → Vizag", 0.38],
  ] as const;
  return (
    <div className="space-y-2">
      {rows.map(([r, w]) => (
        <div key={r} className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="truncate text-ink-2">{t(r)}</span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-rule">
            <span className="block h-full rounded-full bg-series-3" style={{ width: `${w * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function MiniSplit() {
  const t = useT();
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        <span className="bg-accent" style={{ width: "60%" }} />
        <span className="bg-signal-fill/70" style={{ width: "40%" }} />
      </div>
      <div className="mt-2 flex justify-between text-[12.5px] text-ink-3">
        <span>{t("Contract")}</span>
        <span>{t("Spot")}</span>
      </div>
    </div>
  );
}

function MiniAlerts() {
  const t = useT();
  const rows = [
    ["var(--color-negative)", "Rough sea at the discharge port"],
    ["var(--color-caution)", "Loading port busier than usual"],
    ["var(--color-caution)", "Berth closed for dredging"],
  ];
  return (
    <ul className="space-y-2">
      {rows.map(([c, text]) => (
        <li key={text} className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
          {t(text)}
        </li>
      ))}
    </ul>
  );
}

function MiniFit() {
  const t = useT();
  const months = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
  const rows: [string, number[]][] = [
    ["Supramax", [2, 2, 2, 2, 2, 2]],
    ["Panamax", [1, 0, 0, 1, 2, 2]],
    ["Capesize", [0, 0, 0, 0, 1, 1]],
  ];
  const fill = ["var(--color-rule)", "var(--color-caution)", "var(--color-positive)"];
  return (
    <div className="grid grid-cols-[70px_repeat(6,1fr)] items-center gap-1 text-[11.5px] text-ink-3">
      <span />
      {months.map((m) => (
        <span key={m} className="text-center">{t(m)}</span>
      ))}
      {rows.map(([cls, cells]) => (
        <div key={cls} className="contents">
          <span className="text-[12.5px] text-ink-2">{t(cls)}</span>
          {cells.map((c, i) => (
            <span key={i} className="h-3.5 rounded-[3px]" style={{ background: fill[c], opacity: c === 1 ? 0.75 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function MiniEmployment() {
  const t = useT();
  const rows = [
    ["Wait on hire", 0.85, "var(--color-rule-strong)"],
    ["Sublet the ship", 0.45, "var(--color-series-1)"],
    ["Backhaul cargo", 0.3, "var(--color-positive)"],
  ] as const;
  return (
    <div className="space-y-2">
      {rows.map(([label, w, c]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-[96px] text-[12.5px] text-ink-2">{t(label)}</span>
          <span className="h-2 rounded-full" style={{ width: `${w * 60}%`, background: c }} />
        </div>
      ))}
    </div>
  );
}

interface Feature {
  icon: typeof Ship;
  title: string;
  body: string;
  mini: ReactNode;
}

/** What SIH26006 asks for, one card per requirement. */
function Features() {
  const t = useT();
  const features: Feature[] = [
    {
      icon: LineChart,
      title: "Freight forecasts by vessel and route",
      body: "Weekly time-charter rates for every vessel type and freight per tonne on every trade route, 26 weeks ahead, driven by coal, oil and the rupee.",
      mini: <MiniRoutes />,
    },
    {
      icon: CalendarClock,
      title: "When to enter the market",
      body: "The best week to fix inside the laycan, and whether to fix now, wait or stagger, with what each saves.",
      mini: <MiniForecast />,
    },
    {
      icon: Layers,
      title: "The right ship for both ports",
      body: "Every vessel type checked against draft, length and cargo-handling equipment at the load and discharge ports, month by month, with loading-port congestion.",
      mini: <MiniFit />,
    },
    {
      icon: Anchor,
      title: "Idle time and alternative employment",
      body: "What idle days cost and how to cut them, and when a ship isn't needed: wait, sublet it or carry a backhaul cargo.",
      mini: <MiniEmployment />,
    },
    {
      icon: Bell,
      title: "Early warnings",
      body: "Rough seas, busy ports, long berth waits, disruption notices and freight moves, against your own thresholds.",
      mini: <MiniAlerts />,
    },
    {
      icon: Scale,
      title: "From spot to multi-voyage contracts",
      body: "A 3, 6 or 12-month programme on one vessel type, how much to fix on contract, and each month priced at spot too.",
      mini: <MiniSplit />,
    },
  ];
  return (
    <section className="py-20">
      <div className={wrap}>
        <SectionHead
          id="features"
          eyebrow="What SIH26006 asks"
          title="Every question in the problem statement, answered"
          intro="Six decisions the Ministry of Steel's statement asks for, each with the figures behind it."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon, title, body, mini }) => (
            <article
              key={title}
              className="flex flex-col rounded-2xl border border-rule bg-surface p-6 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-20px_rgba(21,23,27,0.3)]"
            >
              <IconTile icon={icon} />
              <h3 className="serif mt-5 text-[20px] font-semibold text-ink">{t(title)}</h3>
              <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink-2">{t(body)}</p>
              <div className="mt-5 rounded-xl border border-rule bg-paper px-4 py-3.5">{mini}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const VIEWS: { value: Viewpoint; label: string }[] = [
  { value: "overview", label: "Whole ship" },
  { value: "bow", label: "Bow" },
  { value: "bridge", label: "Bridge" },
  { value: "underwater", label: "Below the waterline" },
];

/** The 3D ship, live and interactive: a spotlight on the 3D views the app is built round. */
function ShipSpotlight() {
  const t = useT();
  const threeD = use3d(768);
  const [view, setView] = useState<Viewpoint>("overview");
  const points = [
    "Built from each class's real length, beam, depth, draft and fullness",
    "Hydraulic folding covers and 35 t cranes on the Supramax; side-rolling covers on the big ships",
    "Draft marks, the load line and the ship's name, sharp at any zoom",
    "Waves from the port's own sea forecast; the ship rides them",
    "Go below the waterline to see the bulb, the propeller and the keel",
    "The port in 3D: the ship at the berth under that port's unloaders",
  ];
  return (
    <section className="border-y border-rule bg-sunken/60 py-24">
      <div className={`${wrap} grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
        <div>
          <SectionHead id="3d" eyebrow="3D, from real particulars" title="See the ship before you charter it" />
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] leading-relaxed text-ink-2">
                <span className="mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent text-surface">
                  <Check size={11} strokeWidth={3} aria-hidden />
                </span>
                {t(p)}
              </li>
            ))}
          </ul>
        </div>
        <div className="overflow-hidden rounded-2xl border border-rule bg-surface shadow-[0_24px_60px_-24px_rgba(21,23,27,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
            <span className="text-[13.5px] font-semibold text-ink">{t("Supramax, laden, 1.2 m sea")}</span>
            {threeD && (
              <div role="radiogroup" aria-label={t("Viewpoint")} className="flex flex-wrap gap-1">
                {VIEWS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    role="radio"
                    aria-checked={view === v.value}
                    onClick={() => setView(v.value)}
                    className={`rounded-md px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${view === v.value ? "bg-accent text-surface" : "text-ink-2 hover:bg-hover"}`}
                  >
                    {t(v.label)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {threeD ? (
            <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-none" />}>
              <SingleShip
                spec={SUPRAMAX}
                draft={SUPRAMAX.draft_laden_m}
                hs={1.2}
                preset="day"
                view={view}
                height={420}
                wheelZoom={false}
                animate={!prefersReducedMotion()}
                label={t("A Supramax in 3D, laden, in a 1.2 m sea. Drag to turn; zoom with the + and − buttons.")}
              />
            </Suspense>
          ) : (
            <div className="p-6">
              <ShipProfile spec={SUPRAMAX} label={t("A Supramax drawn to scale")} />
            </div>
          )}
          <p className="border-t border-rule px-4 py-2.5 text-[12.5px] text-ink-3">{t("Drag to turn; zoom with the + and − buttons.")}</p>
        </div>
      </div>
    </section>
  );
}

/** Live AIS map of the east-coast ports, loaded only when scrolled near. */
function TrafficSpotlight() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const src = "https://www.marinetraffic.com/en/ais/embed/zoom:6/centery:18.5/centerx:85.5/maptype:4/shownames:false/mmsi:0/shipid:0/fleet:/fleet_hash:";
  const points = [
    ["Live ship positions", "The vessels at each port and in the Bay of Bengal, from AIS, on the Ports page."],
    ["Busy or quiet, against normal", "Dry-bulk calls over the last four weeks against the year before, at every discharge and loading port."],
    ["Sea state ahead", "Maximum wave height for the next five days at every port, from the marine forecast."],
  ];
  return (
    <section className="py-24">
      <div className={`${wrap} grid items-center gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]`}>
        <div ref={ref} className="order-2 overflow-hidden rounded-2xl border border-rule bg-surface shadow-[0_24px_60px_-24px_rgba(21,23,27,0.35)] lg:order-1">
          <div className="flex items-center justify-between border-b border-rule px-4 py-3">
            <span className="text-[13.5px] font-semibold text-ink">{t("Vessel traffic, India's east coast")}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-[12px] font-semibold text-positive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-positive" />
              {t("Live")}
            </span>
          </div>
          {near ? (
            <div className="relative" onMouseLeave={() => setLive(false)}>
              <iframe title={t("Live vessel traffic off India's east coast")} src={src} className="block h-[380px] w-full md:h-[420px]" style={{ border: 0 }} loading="lazy" />
              {/* Until clicked, the map lets the page scroll past it instead of zooming. */}
              {!live && (
                <button type="button" onClick={() => setLive(true)} className="group absolute inset-0 flex items-end justify-center pb-5" aria-label={t("Use the map")}>
                  <span className="rounded-full bg-ink/80 px-3.5 py-1.5 text-[12.5px] font-semibold text-surface opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {t("Click to use the map")}
                  </span>
                </button>
              )}
            </div>
          ) : (
            <Skeleton className="h-[380px] w-full rounded-none md:h-[420px]" />
          )}
        </div>
        <div className="order-1 lg:order-2">
          <SectionHead id="traffic" eyebrow="Live, at every port" title="Know what's happening at the port before the ship arrives" />
          <dl className="mt-8 space-y-5">
            {points.map(([k, v]) => (
              <div key={k} className="rounded-xl border border-rule bg-surface p-5">
                <dt className="text-[15.5px] font-semibold text-ink">{t(k)}</dt>
                <dd className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{t(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function Coverage() {
  return (
    <section className="border-y border-rule bg-sunken/60 py-24">
      <div className={wrap}>
        <SectionHead
          id="coverage"
          center
          eyebrow="Coverage"
          title="Every route from mine to plant"
          intro="Coking coal from Australia, Mozambique, Indonesia, the USA and Russia over real shipping lanes to seven ports on India's east coast, then by rail to SAIL's five integrated steel plants."
        />
        <div className="mt-12 overflow-hidden rounded-2xl border border-rule shadow-[0_24px_60px_-24px_rgba(21,23,27,0.4)]">
          <CoverageGlobe height={520} />
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const t = useT();
  const steps = [
    ["Enter the shipment", "Plant, coal grade, load port, tonnes and tolerance, the laycan and a spot voyage or a 3 to 12-month programme."],
    ["Check both ports", "Draft, length, monsoon and unloading limits at loading and discharge rule out ships that can't fit."],
    ["Price and forecast", "Landed cost per tonne for every ship and port, from freight, bunkers, port charges, waiting time and rail."],
    ["Plan and watch", "The charter plan, a voyage schedule and early warnings, with ships and ports to explore in 3D."],
  ];
  return (
    <section className="py-24">
      <div className={wrap}>
        <SectionHead id="how" center eyebrow="How it works" title="From a shipment to a plan in four steps" />
        <ol className="relative mt-14 grid gap-10 md:grid-cols-4 md:gap-6">
          <span aria-hidden className="absolute top-5 right-[12%] left-[12%] hidden h-px bg-gradient-to-r from-transparent via-rule-strong to-transparent md:block" />
          {steps.map(([title, body], i) => (
            <li key={title} className="relative text-center">
              <span className="relative mx-auto grid h-10 w-10 place-items-center rounded-full border border-accent/20 bg-surface text-[15px] font-semibold text-accent shadow-sm">{i + 1}</span>
              <h3 className="mt-5 text-[17px] font-semibold text-ink">{t(title)}</h3>
              <p className="mx-auto mt-2 max-w-[30ch] text-[14.5px] leading-relaxed text-ink-2">{t(body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function DataAndTrust() {
  const t = useT();
  const sources = [
    ["Sea state", "Open-Meteo marine forecasts for every port, refreshed through the day."],
    ["Port traffic", "IMF PortWatch daily dry-bulk port calls, for congestion and waiting times; live AIS from MarineTraffic."],
    ["Markets", "Coal, oil and exchange-rate series from FRED and the European Central Bank."],
    ["Ports and rail", "Published port depth, length and equipment, and Indian Railways FOIS freight rates."],
    ["Sea routes", "Distances over real shipping lanes (Malacca, Suez, the open ocean)."],
  ];
  const security = [
    { icon: KeyRound, title: "No sign-up, no personal data", body: "The live demo asks for no name, email or password: a throwaway session opens the planner." },
    { icon: Lock, title: "Private sessions", body: "Each visitor gets their own session in a Secure, HttpOnly cookie; your plant stock and saved plans aren't shared." },
    { icon: ShieldCheck, title: "Nothing kept", body: "A demo session and anything saved in it are deleted after a day, or at once when you end the demo." },
  ];
  return (
    <section className="border-y border-rule bg-sunken/60 py-24">
      <div className={wrap}>
        <SectionHead id="data" eyebrow="Data and trust" title="Public data you can check, and a demo that keeps nothing" />
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="rounded-2xl border border-rule bg-surface p-6">
            <h3 className="flex items-center gap-2.5 text-[15.5px] font-semibold text-ink">
              <Database size={18} strokeWidth={1.8} className="text-accent" aria-hidden />
              {t("Where the figures come from")}
            </h3>
            <dl className="mt-4 divide-y divide-rule">
              {sources.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-3.5 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-[14.5px] font-semibold text-ink">{t(k)}</dt>
                  <dd className="text-[14.5px] leading-relaxed text-ink-2">{t(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="space-y-4">
            {security.map(({ icon, title, body }) => (
              <div key={title} className="flex gap-4 rounded-2xl border border-rule bg-surface p-5">
                <IconTile icon={icon} />
                <div>
                  <h3 className="text-[16px] font-semibold text-ink">{t(title)}</h3>
                  <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{t(body)}</p>
                </div>
              </div>
            ))}
            <p className="px-1 text-[14px]">
              <Link to="/privacy" className="font-semibold text-accent underline-offset-4 hover:underline">
                {t("Read the privacy notice")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const t = useT();
  const items = [
    ["Who is Freightwise for?", "People at SAIL who plan coking-coal imports: chartering, logistics and shipping, and raw-materials planning at the plants."],
    ["Does it book ships?", "No. It works out and explains the options; your team fixes charters as it does today."],
    ["How reliable is the freight forecast?", "Each forecast comes with the range that 80% of outcomes fall in, and the Freight outlook page shows how the model has done on past weeks."],
    ["Where does the voyage and port data come from?", "Public sources: sea forecasts, port traffic, published port limits, market series and rail tariffs. Each figure shows the date it's from."],
    ["Do I need an account?", "No. Try the live demo opens the planner straight away, with no sign-up. Anything you save in it is deleted after a day."],
    ["Does it work on a phone?", "Yes. Every page works on a phone; the 3D ships and globe become to-scale drawings on small screens."],
  ];
  return (
    <section className="py-24">
      <div className={`${wrap} grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]`}>
        <SectionHead id="faq" eyebrow="FAQ" title="Questions people ask first" />
        <div className="space-y-3">
          {items.map(([q, a]) => (
            <details key={q} className="group rounded-xl border border-rule bg-surface px-5 py-4 open:shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {t(q)}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sunken text-ink-2 transition-transform duration-200 group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{t(a)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  const t = useT();
  return (
    <section className="pb-24">
      <div className={wrap}>
        <div className="relative isolate overflow-hidden rounded-3xl bg-accent px-6 py-14 text-center sm:px-12">
          <div aria-hidden className="absolute inset-0 -z-10 opacity-60" style={{ backgroundImage: CHART_BG.replaceAll("%231e3a5f", "%23ffffff"), backgroundSize: "640px 420px" }} />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(255,255,255,0.14),transparent_70%)]" />
          <h2 className="serif mx-auto max-w-[24ch] text-[32px] font-semibold leading-tight text-white sm:text-[40px]">{t("Plan your next coking-coal shipment with the whole voyage in view.")}</h2>
          <p className="mx-auto mt-4 max-w-[56ch] text-[16.5px] leading-relaxed text-white/80">{t("No sign-up: open the planner, set a shipment and see the plan, the saving and the risks in seconds.")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <DemoButton className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-[15px] font-semibold text-accent shadow-sm hover:bg-white/90 disabled:opacity-70">
              {t("Try the live demo")}
              <ArrowRight size={16} aria-hidden />
            </DemoButton>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The public front page, always light: what Freightwise does, how, from what data, and how to start. */
export default function Landing() {
  const theme = useTheme();
  useLightTheme(theme);
  return (
    <div className="bg-paper">
      <Hero />
      <SourcesStrip />
      <CoverageStats />
      <Problem />
      <Features />
      <ShipSpotlight />
      <TrafficSpotlight />
      <Coverage />
      <HowItWorks />
      <DataAndTrust />
      <Faq />
      <FinalCta />
    </div>
  );
}
