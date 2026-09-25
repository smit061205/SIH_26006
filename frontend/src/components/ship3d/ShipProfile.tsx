import { useId, useMemo } from "react";
import { type ShipSpec, arrangement, bottomHeight, deckHeight, halfBreadth, hullForm, sailingDraft } from "./hull";
import { PAINT } from "./paint";

/**
 * The hull's side outline from the same form as the 3D model: deck line with
 * sheer and forecastle, the stem and bulb traced from the half-breadths, the
 * keel and stern boss, and the transom.
 */
function outline(spec: ShipSpec): [number, number][] {
  const f = hullForm(spec);
  const top = deckHeight(f, f.L);
  // Foremost point of the hull at height y (includes the bulb).
  const front = (y: number) => {
    for (let x = f.L; x > f.L * 0.85; x -= 0.25) if (halfBreadth(f, x, y) > 0.05) return x;
    return f.L * 0.85;
  };
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40) * f.L * 0.99;
    pts.push([x, deckHeight(f, x)]);
  }
  for (let i = 0; i <= 40; i++) {
    const y = top - (top * i) / 40;
    pts.push([front(y), y]);
  }
  for (let i = 40; i >= 0; i--) {
    const x = (i / 40) * front(0.2);
    pts.push([x, bottomHeight(f, x)]);
  }
  // The boss end: a vertical step up to the counter.
  pts.splice(pts.length - 2, 0, [f.boss.xEnd, bottomHeight(f, f.boss.xEnd + 0.01)], [f.boss.xEnd, bottomHeight(f, f.boss.xEnd - 0.01)]);
  pts.push([0, deckHeight(f, 0)]);
  return pts;
}

/**
 * Side elevation to scale, in SVG: for phones, print, and browsers without
 * WebGL. `scaleLength` draws several ships to one scale.
 */
export function ShipProfile({
  spec,
  limit,
  draft: draftIn,
  seabedDepth,
  scaleLength,
  label,
  className = "",
  aboveWater = false,
}: {
  /** Draw only what shows above the sea, as in a picture rather than a diagram. */
  aboveWater?: boolean;
  spec: ShipSpec;
  limit?: number | null;
  /** Draft to float at; defaults to the laden draft, or `limit` if shallower. */
  draft?: number;
  seabedDepth?: number | null;
  /** Length the full width stands for, so a fleet lines up to one scale. */
  scaleLength?: number;
  /** Accessible description, e.g. "Panamax, 225 m long, 14.2 m laden draft". */
  label: string;
  className?: string;
}) {
  const draft = draftIn ?? sailingDraft(spec, limit);
  const a = arrangement(spec);
  const width = scaleLength ?? spec.loa_m;
  const hull = useMemo(() => outline(spec), [spec]);
  // SVG y grows downward. The waterline is y = 0 and the keel sits at y = draft.
  const toY = (y: number) => draft - y;
  const minY = toY(a.topHeight + 4);
  const maxY = aboveWater ? 0 : Math.max(draft, seabedDepth ?? 0) + 4;
  const height = maxY - minY;
  const points = hull.map(([x, y]) => `${x.toFixed(1)},${toY(y).toFixed(1)}`).join(" ");
  // Unique per drawing: a clipPath inside a hidden copy (print, fallbacks) can't be referenced by another.
  const clip = `below-${useId().replace(/\W/g, "")}`;
  const box = (b: { x: number; y: number; lx: number; ly: number }, fill: string, key: string) => (
    <rect key={key} x={b.x - b.lx / 2} y={toY(b.y + b.ly / 2)} width={b.lx} height={b.ly} fill={fill} />
  );
  const f = a.funnel;
  return (
    <svg viewBox={`-4 ${minY} ${width + 8} ${height}`} className={`w-full ${className}`} role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} preserveAspectRatio="xMinYMid meet">
      <defs>
        {/* Antifouling below the summer load line, as on the 3D model. */}
        <clipPath id={clip}>
          <rect x={-10} y={toY(spec.draft_laden_m)} width={spec.loa_m + 20} height={spec.depth_m + 20} />
        </clipPath>
      </defs>
      {seabedDepth != null && <rect x={-4} y={seabedDepth} width={width + 8} height={3} fill="var(--color-caution)" opacity={0.6} />}
      {a.hatches.map((h, i) => box(h, PAINT.hatch, `h${i}`))}
      {a.tiers.map((t, i) => box(t, PAINT.superstructure, `t${i}`))}
      <rect x={f.x - f.lx / 2} y={toY(f.y + f.ly / 2)} width={f.lx} height={f.ly} rx={1} fill={PAINT.funnel} />
      <rect x={f.x - f.lx / 2} y={toY(f.y + f.ly / 2 - f.ly * 0.18)} width={f.lx} height={f.ly * 0.2} fill={PAINT.funnelBand} />
      <polygon points={points} fill={PAINT.topsides} stroke="var(--color-ink-3)" strokeWidth={0.3} />
      <polygon points={points} fill={PAINT.bottom} clipPath={`url(#${clip})`} />
      {a.cranes.map((c, i) => (
        <g key={`c${i}`} stroke={PAINT.crane} strokeWidth={1.6}>
          <line x1={c.x} y1={toY(spec.depth_m)} x2={c.x} y2={toY(spec.depth_m + c.pedestalHeight)} strokeWidth={2.6} />
          <line
            x1={c.x}
            y1={toY(spec.depth_m + c.pedestalHeight + 1.6)}
            x2={c.x + c.facing * c.jibLength * 0.95}
            y2={toY(spec.depth_m + c.pedestalHeight + 1.6 + c.jibLength * 0.18)}
          />
        </g>
      ))}
      {!aboveWater && <line x1={-4} x2={width + 4} y1={0} y2={0} stroke="var(--color-accent)" strokeWidth={0.8} strokeDasharray="4 3" />}
    </svg>
  );
}
