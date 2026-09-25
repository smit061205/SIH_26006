import { Suspense, lazy, useState } from "react";
import { metres, num, tonnes } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { rejectionSentences } from "../../lib/labels";
import type { FeasibilityRow, PortMapEntry, PortWeather, VesselClassInfo } from "../../types";
import { Segmented } from "../ui/inputs";
import { prefersReducedMotion } from "./colors";
import { type ShipSpec, draftForCargo, toSpec } from "./hull";
import type { PortView } from "./PortStage";
import { DayPicker, LoadSlider, loadReadout } from "./ShipCloseUp";
import { ShipProfile } from "./ShipProfile";
import { use3d } from "./ShipView";

const PortScene = lazy(() => import("./PortStage").then((m) => ({ default: m.PortScene })));

/**
 * Ships typically waiting at anchor, by Little's law: arrivals per day times
 * the days each waits. Recent dry-bulk calls (PortWatch) and the port's
 * typical wait; at most 12 drawn.
 */
export function shipsWaiting(port: PortMapEntry) {
  const calls = port.recent_calls_per_day ?? port.real_avg_dry_bulk_calls_per_day ?? port.baseline_calls_per_day ?? 0;
  const wait = (port.avg_wait_days_min + port.avg_wait_days_max) / 2;
  return Math.min(12, Math.round(calls * wait));
}

/**
 * The port in 3D with one vessel type at the berth: choose the type, how much
 * cargo it carries and the forecast day, and see whether it clears this
 * month's usable depth, alongside the ships waiting at anchor.
 */
export function WillItFit({
  port,
  month,
  classes,
  feasibility,
  recommendedClass,
  weather,
}: {
  port: PortMapEntry;
  month: string;
  classes: VesselClassInfo[];
  feasibility: FeasibilityRow[];
  recommendedClass?: string;
  weather?: PortWeather;
}) {
  const t = useT();
  const threeD = use3d(640);
  const checked = feasibility.filter((f) => f.port_name === port.name);
  // Until the shipment's own check is in (or if it can't be had), the port's published limits: its
  // accepted classes at its charted depth.
  const rows: FeasibilityRow[] = checked.length
    ? checked
    : classes
        .filter((c) => port.vessel_classes_allowed.includes(c.name))
        .map((c) => ({
          port_id: 0,
          port_name: port.name,
          vessel_class: c.name,
          feasible: c.draft_laden_m <= port.max_draft_m,
          part_loaded: false,
          usable_draft_m: port.max_draft_m,
          draft_limit_m: port.max_draft_m,
          reasons_failed: "",
          avg_wait_days_min: port.avg_wait_days_min,
          avg_wait_days_max: port.avg_wait_days_max,
        }));
  const accepted = classes.filter((c) => rows.some((r) => r.vessel_class === c.name && !r.reasons_failed.includes("not an accepted class")));
  const fits = (name: string) => rows.find((r) => r.vessel_class === name)?.feasible ?? false;
  // The recommended type if it can use this port, else the largest type that can.
  const fallback =
    (recommendedClass && fits(recommendedClass) ? recommendedClass : undefined) ?? [...accepted].reverse().find((c) => fits(c.name))?.name;
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<PortView>("berth");
  const [day, setDay] = useState(0);
  const [cargoByClass, setCargoByClass] = useState<Record<string, number>>({});
  const name = picked && accepted.some((c) => c.name === picked) ? picked : (fallback ?? accepted[0]?.name);
  const vessel = classes.find((c) => c.name === name);
  const row = rows.find((r) => r.vessel_class === name);
  if (!vessel || !row) return <p className="text-[14px] text-ink-3">{t("No vessel type is accepted at this port.")}</p>;

  const usable = row.usable_draft_m;
  const spec = toSpec(vessel);
  const cargo = cargoByClass[vessel.name] ?? vessel.payload_tonnes;
  const setCargo = (c: number) => setCargoByClass((m) => ({ ...m, [vessel.name]: c }));
  const r = loadReadout(spec, cargo, usable);
  const hs = weather?.wave_height_max_m?.[day] ?? 1;
  const waiting = shipsWaiting(port);
  const queueSpecs = accepted.map(toSpec);
  const berth = port.port_type === "berth";

  let sentence: string;
  if (!row.feasible && !row.reasons_failed.includes("draft")) {
    sentence = t("{cls} can't use this port in {month}: {why}.", { cls: vessel.name, month, why: rejectionSentences(row.reasons_failed, t).join("; ") });
  } else if (r.fits) {
    sentence = t("With {cargo} aboard a {cls} draws {draft}: {spare} inside this port's {usable} limit in {month}.", {
      cargo: tonnes(cargo),
      cls: vessel.name,
      draft: metres(r.draft),
      spare: metres(r.spare!),
      usable: metres(usable),
      month,
    });
  } else {
    sentence = t("With {cargo} aboard a {cls} draws {draft}, {over} deeper than this port's {usable} limit in {month}.", {
      cargo: tonnes(cargo),
      cls: vessel.name,
      draft: metres(r.draft),
      over: metres(-r.spare!),
      usable: metres(usable),
      month,
    });
  }
  const clearanceText = r.fits ? t("{d} under the keel", { d: metres(r.spare!) }) : t("{d} too deep", { d: metres(-r.spare!) });
  const queueText =
    waiting > 0
      ? t("About {n} ships typically waiting at anchor: {calls} dry-bulk calls a day × a {wait}-day wait.", {
          n: waiting,
          calls: num(port.recent_calls_per_day ?? port.real_avg_dry_bulk_calls_per_day ?? 0, 2),
          wait: num((port.avg_wait_days_min + port.avg_wait_days_max) / 2, 1),
        })
      : t("Usually no ships waiting at anchor.");
  const profile = <ShipProfile spec={spec} draft={draftForCargo(spec, cargo)} seabedDepth={usable} label={sentence} className="max-h-[170px]" />;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{t("Will it fit?")}</h3>
        {accepted.length > 1 && (
          <Segmented
            label={t("Vessel type")}
            value={name}
            onChange={setPicked}
            options={accepted.map((c) => ({ value: c.name, label: c.name.replace("Post-Panamax", "Post-Pmx") }))}
          />
        )}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-surface">
        {threeD && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-3 py-2 print:hidden">
            <Segmented
              label={t("Viewpoint")}
              value={view}
              onChange={setView}
              options={[
                { value: "berth", label: berth ? t("At the berth") : t("Alongside") },
                { value: "anchorage", label: t("Anchorage") },
                { value: "keel", label: t("Under the keel") },
              ]}
            />
            <DayPicker weather={weather} day={day} onDay={setDay} />
          </div>
        )}
        {threeD ? (
          <>
            <div className="print:hidden">
              <Suspense fallback={<div className="p-4">{profile}</div>}>
                <PortScene
                  spec={spec}
                  draft={r.draft}
                  usable={usable}
                  hs={hs}
                  berth={berth}
                  maxLoa={port.loa_max_m}
                  queue={waiting}
                  queueSpecs={queueSpecs}
                  view={view}
                  clearanceText={clearanceText}
                  handling={port.handling_type}
                  equipment={port.shore_equipment}
                  animate={!prefersReducedMotion()}
                  label={`${sentence} ${queueText}`}
                />
              </Suspense>
            </div>
            <div className="hidden p-4 print:block">{profile}</div>
          </>
        ) : (
          <div className="p-4">{profile}</div>
        )}
      </div>
      <p className={`mt-3 text-[14.5px] ${r.fits ? "text-ink-2" : "text-negative"}`}>{sentence}</p>
      <p className="mt-1 text-[14px] text-ink-3">{queueText}</p>
      <div className="mt-5">
        <LoadSlider spec={spec} cargo={cargo} onCargo={setCargo} port={port.name} usable={usable} />
      </div>
    </div>
  );
}

/**
 * One ship lying at a port in 3D, with the port's own equipment and the ships
 * waiting at anchor: the charter plan's recommendation seen where it discharges.
 */
export function ShipAtPort({ port, spec, draft, usable, label, height = 280 }: { port: PortMapEntry; spec: ShipSpec; draft: number; usable: number; label: string; height?: number }) {
  const t = useT();
  const threeD = use3d(640);
  const spare = usable - draft;
  const profile = <ShipProfile spec={spec} draft={draft} seabedDepth={usable} label={label} className="max-h-[160px]" />;
  if (!threeD) return <div className="p-3">{profile}</div>;
  return (
    <>
      <div className="print:hidden">
        <Suspense fallback={<div className="p-3">{profile}</div>}>
          <PortScene
            spec={spec}
            draft={draft}
            usable={usable}
            hs={1}
            berth={port.port_type === "berth"}
            maxLoa={port.loa_max_m}
            queue={shipsWaiting(port)}
            queueSpecs={[spec]}
            view="berth"
            clearanceText={spare >= 0 ? t("{d} under the keel", { d: metres(spare) }) : t("{d} too deep", { d: metres(-spare) })}
            handling={port.handling_type}
            equipment={port.shore_equipment}
            height={height}
            animate={!prefersReducedMotion()}
            label={label}
          />
        </Suspense>
      </div>
      <div className="hidden p-3 print:block">{profile}</div>
    </>
  );
}
