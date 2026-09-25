import { Suspense, lazy, useEffect, useState } from "react";
import { useT } from "../../lib/i18n";
import { prefersReducedMotion, webglAvailable } from "./colors";
import { type ShipSpec, sailingDraft } from "./hull";
import { ShipProfile } from "./ShipProfile";

// three.js loads only when a 3D view is actually shown.
const SingleShip = lazy(() => import("./ShipStage").then((m) => ({ default: m.SingleShip })));
const Fleet = lazy(() => import("./ShipStage").then((m) => ({ default: m.Fleet })));

/** 3D on capable screens; the 2D profile on small screens, without WebGL, and on paper. */
export function use3d(minWidth: number) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const check = () => setOk(webglAvailable() && window.innerWidth >= minWidth);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [minWidth]);
  return ok;
}

export function ShipView({
  spec,
  limit,
  seabedDepth,
  seabedLabel,
  label,
  height = 220,
  minWidth = 640,
  hs = 1,
}: {
  spec: ShipSpec;
  /** Significant wave height to show, metres. */
  hs?: number;
  limit?: number | null;
  seabedDepth?: number | null;
  seabedLabel?: string;
  label: string;
  height?: number;
  minWidth?: number;
}) {
  const threeD = use3d(minWidth);
  const profile = <ShipProfile spec={spec} limit={limit} seabedDepth={seabedDepth} label={label} className="max-h-[160px]" />;
  if (!threeD) return profile;
  return (
    <>
      <div className="print:hidden">
        <Suspense fallback={profile}>
          <SingleShip
            label={label}
            spec={spec}
            draft={sailingDraft(spec, limit)}
            hs={hs}
            seabedDepth={seabedDepth}
            seabedLabel={seabedLabel}
            height={height}
            animate={!prefersReducedMotion()}
          />
        </Suspense>
      </div>
      <div className="hidden print:block">{profile}</div>
    </>
  );
}

export function FleetView({
  specs,
  selected,
  onSelect,
  resetLabel,
  labelFor,
  caption3d,
  caption2d,
  height = 380,
}: {
  specs: ShipSpec[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  resetLabel: string;
  labelFor: (s: ShipSpec) => string;
  /** Caption under the 3D view (how to turn and zoom), and under the flat profiles. */
  caption3d: string;
  caption2d: string;
  height?: number;
}) {
  const threeD = use3d(640);
  const t = useT();
  const [below, setBelow] = useState(false);
  const maxL = Math.max(...specs.map((s) => s.loa_m));
  const profiles = (
    <div className="space-y-3">
      {specs.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => onSelect(s.name)}
          aria-pressed={selected === s.name}
          className={`block w-full rounded-[var(--radius-control)] border px-2 py-1.5 text-left ${
            selected === s.name ? "border-accent" : "border-transparent hover:border-rule"
          }`}
        >
          <span className="text-[13px] font-semibold text-ink-2">{s.name}</span>
          <ShipProfile spec={s} scaleLength={maxL} label={labelFor(s)} className="max-h-[70px]" />
        </button>
      ))}
    </div>
  );
  const caption = (text: string) => <p className="border-t border-rule px-4 py-2 text-[13px] text-ink-3">{text}</p>;
  if (!threeD)
    return (
      <>
        <div className="p-2">{profiles}</div>
        {caption(caption2d)}
      </>
    );
  return (
    <>
      <div className="print:hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2" role="group" aria-label={resetLabel}>
          {specs.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={selected === s.name}
              aria-label={labelFor(s)}
              onClick={() => onSelect(selected === s.name ? null : s.name)}
              className={`rounded-[3px] px-2 py-1 text-[13px] ${
                selected === s.name ? "bg-accent text-surface" : "text-ink-2 hover:bg-hover hover:text-ink"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={below}
            onClick={() => setBelow((b) => !b)}
            className={`ml-auto rounded-[3px] px-2 py-1 text-[13px] ${below ? "bg-accent text-surface" : "text-ink-2 hover:bg-hover hover:text-ink"}`}
          >
            {t("Below the waterline")}
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            disabled={selected === null}
            className="rounded-[3px] border border-rule-strong px-2 py-1 text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
          >
            {resetLabel}
          </button>
        </div>
        <Suspense fallback={profiles}>
          <Fleet specs={specs} selected={selected} onSelect={onSelect} height={height} animate={!prefersReducedMotion()} label={specs.map(labelFor).join(". ")} below={below} />
        </Suspense>
        {caption(caption3d)}
      </div>
      <div className="hidden print:block">{profiles}</div>
    </>
  );
}
