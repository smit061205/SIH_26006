import { Suspense, lazy, useState } from "react";
import { metres, num, tonnes, weekday } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { PortMapEntry, PortWeather } from "../../types";
import { Figure, FigureRow } from "../ui/figures";
import { Button, Segmented, Slider } from "../ui/inputs";
import { prefersReducedMotion } from "./colors";
import { type ShipSpec, cargoForDraft, draftForCargo } from "./hull";
import { ShipProfile } from "./ShipProfile";
import type { Viewpoint } from "./ShipStage";
import { use3d } from "./ShipView";

const SingleShip = lazy(() => import("./ShipStage").then((m) => ({ default: m.SingleShip })));
const PortScene = lazy(() => import("./PortStage").then((m) => ({ default: m.PortScene })));

const VIEWS: { value: Viewpoint; label: string }[] = [
  { value: "overview", label: "Whole ship" },
  { value: "bow", label: "Bow" },
  { value: "bridge", label: "Bridge" },
  { value: "stern", label: "Stern" },
  { value: "loadline", label: "Draft marks" },
  { value: "underwater", label: "Below the waterline" },
];

/** Forecast days as a picker: "Today 1.4 m", "Fri 2.1 m"… Sets the sea state shown. */
export function DayPicker({ weather, day, onDay }: { weather?: PortWeather; day: number; onDay: (d: number) => void }) {
  const t = useT();
  const dates = weather?.dates ?? [];
  const waves = weather?.wave_height_max_m ?? [];
  if (dates.length === 0) return null;
  return (
    <Segmented
      label={t("Forecast day")}
      value={String(day)}
      onChange={(v) => onDay(Number(v))}
      options={dates.slice(0, 5).map((d, i) => ({
        value: String(i),
        label: (
          <span>
            {i === 0 ? t("Today") : weekday(d)} <span className="text-ink-3">{num(waves[i] ?? 0, 1)} m</span>
          </span>
        ),
        title: t("Waves up to {h} m", { h: num(waves[i] ?? 0, 1) }),
      }))}
    />
  );
}

/** How the ship floats with a given cargo, and whether that fits a port's usable depth. */
export function loadReadout(spec: ShipSpec, cargo: number, usable?: number | null) {
  const draft = draftForCargo(spec, cargo);
  const freeboard = spec.depth_m - draft;
  const spare = usable != null ? usable - draft : null;
  const maxCargo = usable != null ? cargoForDraft(spec, usable) : null;
  return { draft, freeboard, spare, maxCargo, fits: spare == null || spare >= 0 };
}

/**
 * Cargo slider: drag from empty (ballast) to a full cargo and the ship sinks
 * to the matching draft (laden draft less the cargo short, at the TPC rate).
 * With a port, shows the depth to spare or how far over its limit the ship is.
 */
export function LoadSlider({
  spec,
  cargo,
  onCargo,
  port,
  usable,
}: {
  spec: ShipSpec;
  cargo: number;
  onCargo: (c: number) => void;
  port?: string;
  usable?: number | null;
}) {
  const t = useT();
  const payload = spec.payload_tonnes ?? 0;
  const r = loadReadout(spec, cargo, usable);
  const step = payload > 100000 ? 1000 : 500;
  return (
    <div className="space-y-4">
      <Slider label={t("Cargo aboard")} value={cargo} min={0} max={payload} step={step} onChange={onCargo} format={(v) => tonnes(v)} />
      <FigureRow>
        <Figure label="Draft" value={num(r.draft, 1)} unit=" m" note={t("laden {d}", { d: metres(spec.draft_laden_m) })} />
        <Figure label="Freeboard" value={num(r.freeboard, 1)} unit=" m" note={t("deck above the water")} />
        {port && r.spare != null && (
          <Figure
            label={r.fits ? t("Spare at {port}", { port }) : t("Over the limit at {port}", { port })}
            value={num(Math.abs(r.spare), 1)}
            unit=" m"
            tone={r.fits ? "positive" : "negative"}
            note={t("usable depth {d}", { d: metres(usable!) })}
          />
        )}
      </FigureRow>
      {port && r.maxCargo != null && (
        <div className="flex flex-wrap items-center gap-3">
          <p className={`text-[14.5px] ${r.fits ? "text-ink-2" : "text-negative"}`} role="status">
            {r.fits
              ? t("Fits {port} with {spare} under the keel to spare.", { port, spare: metres(r.spare!) })
              : t("Too deep for {port} by {over}. Load at most {max} to use it.", { port, over: metres(-r.spare!), max: tonnes(r.maxCargo) })}
          </p>
          {r.maxCargo < payload && Math.abs(cargo - r.maxCargo) > step && (
            <Button variant="text" onClick={() => onCargo(Math.floor(r.maxCargo! / step) * step)}>
              {t("Load to the limit")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One ship up close on the port's forecast sea: pick a viewpoint (bow,
 * bridge, stern, draft marks), a forecast day (wave height), and how much
 * cargo is aboard. The seabed shows at the port's usable depth.
 */
export function ShipCloseUp({
  spec,
  port,
  portEntry,
  usable,
  weather,
  height = 380,
}: {
  spec: ShipSpec;
  port?: string;
  /** The port's details, for an "At the port" view of the ship at its berth. */
  portEntry?: PortMapEntry;
  usable?: number | null;
  weather?: PortWeather;
  height?: number;
}) {
  const t = useT();
  const threeD = use3d(640);
  const [view, setView] = useState<Viewpoint | "port">("overview");
  const views: { value: Viewpoint | "port"; label: string }[] = portEntry && usable != null ? [...VIEWS, { value: "port", label: "At the port" }] : VIEWS;
  const [day, setDay] = useState(0);
  const [cargo, setCargo] = useState(spec.payload_tonnes ?? 0);
  const r = loadReadout(spec, cargo, usable);
  const hs = weather?.wave_height_max_m?.[day] ?? 1;
  const seabedLabel = port && usable != null ? t("{port} usable depth {d}", { port, d: metres(usable) }) : undefined;
  const label = t("{cls} with {cargo} aboard, floating at {draft} in waves up to {h} m.", {
    cls: spec.name,
    cargo: tonnes(cargo),
    draft: metres(r.draft),
    h: num(hs, 1),
  });
  const profile = <ShipProfile spec={spec} draft={r.draft} seabedDepth={usable} label={label} className="max-h-[170px]" />;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-surface">
        {threeD && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2 print:hidden">
            <Segmented label={t("Viewpoint")} value={view} onChange={setView} options={views} />
            <DayPicker weather={weather} day={day} onDay={setDay} />
          </div>
        )}
        {threeD ? (
          <>
            <div className="print:hidden">
              <Suspense fallback={<div className="p-4">{profile}</div>}>
                {view === "port" && portEntry && usable != null ? (
                  <PortScene
                    spec={spec}
                    draft={r.draft}
                    usable={usable}
                    hs={hs}
                    berth={portEntry.port_type === "berth"}
                    maxLoa={portEntry.loa_max_m}
                    queue={0}
                    queueSpecs={[]}
                    view="berth"
                    clearanceText={r.fits ? t("{d} under the keel", { d: metres(r.spare!) }) : t("{d} too deep", { d: metres(-r.spare!) })}
                    handling={portEntry.handling_type}
                    equipment={portEntry.shore_equipment}
                    height={height}
                    animate={!prefersReducedMotion()}
                    label={label}
                  />
                ) : (
                  <SingleShip
                    spec={spec}
                    draft={r.draft}
                    hs={hs}
                    view={view === "port" ? "overview" : view}
                    seabedDepth={usable ?? null}
                    seabedLabel={seabedLabel}
                    height={height}
                    animate={!prefersReducedMotion()}
                    label={label}
                  />
                )}
              </Suspense>
            </div>
            <div className="hidden p-4 print:block">{profile}</div>
          </>
        ) : (
          <div className="p-4">{profile}</div>
        )}
      </div>
      <LoadSlider spec={spec} cargo={cargo} onCargo={setCargo} port={port} usable={usable} />
    </div>
  );
}
