/**
 * A bulk carrier's shape from its main particulars, as plain numbers (no
 * three.js), so the same geometry drives the 3D model and the 2D profile and
 * can be checked on its own (npm run check:hull).
 *
 * Axes: x along the ship from the transom (0) to the stem (loa), y up from the
 * keel (0), z across (port +, starboard -). Units are metres.
 *
 * The form follows a modern bulk carrier's lines plan:
 * - a long parallel middle body at full beam with a flat bottom and a round bilge;
 * - a full, raked bow with flare above the waterline and a bulbous bow below it;
 * - an aft run that narrows at the bottom into a boss carrying the propeller
 *   shaft, with the counter above the propeller and rudder, and a flat transom;
 * - sheer (the deck rising towards the ends), a raised forecastle, and camber
 *   (the deck higher on the centreline than at the sides).
 */

export interface ShipSpec {
  name: string;
  loa_m: number;
  beam_m: number;
  depth_m: number;
  draft_laden_m: number;
  holds: number;
  cranes: number;
  /** Cargo on a full voyage (tonnes); drives the load slider. */
  payload_tonnes?: number;
  /** Tonnes per centimetre immersion at the summer draft. */
  tpc?: number | null;
  /** Fullness of the underwater form, 0.80 (Handysize) to 0.87 (Capesize). Sets the entrance and run. */
  block_coefficient?: number | null;
  /** Hydraulic folding covers (geared Handysize and Supramax) or side-rolling covers (the gearless classes). */
  hatch_cover_type?: "folding" | "side_rolling" | null;
  /** Safe working load of each deck crane, tonnes. */
  crane_swl_t?: number | null;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** 0 for a fine hull (block coefficient 0.80) to 1 for a full one (0.87). */
export function fullness(spec: ShipSpec) {
  return clamp(((spec.block_coefficient ?? 0.84) - 0.8) / 0.07);
}

/** Fixed proportions of the form, as shares of length (L), beam (B) or draft (T). */
export function hullForm(spec: ShipSpec) {
  const L = spec.loa_m;
  const B = spec.beam_m;
  const D = spec.depth_m;
  const T = spec.draft_laden_m;
  // A fuller hull has a longer parallel middle body: a shorter entrance and run.
  const full = fullness(spec);
  const propRadius = 0.33 * T; // propeller diameter about two-thirds of the draft
  const hubY = propRadius + 0.05 * T; // tip clears the keel line
  return {
    L,
    B,
    D,
    T,
    bilgeRadius: Math.min(0.065 * B, 0.2 * D),
    camber: B / 50,
    /** Forward end of the parallel middle body, and aft end. */
    entrance: (0.74 + 0.08 * full) * L,
    run: (0.3 - 0.08 * full) * L,
    /** The waterline stem sits this far aft of the deck stem; below the bulb's top it is further aft still. */
    stemRakeAbove: 0.025 * L,
    forefoot: 0.065 * L,
    /** Bulb: an ellipsoid projecting ahead of the stem below the waterline, its underside faired into the keel. */
    bulb: { xc: 0.956 * L, yc: 0.5 * T, ax: 0.04 * L, ay: 0.3 * T, az: Math.min(0.09 * B, 0.5 * T) },
    /** Shaft boss: the aft end of the underwater hull, where the propeller sits. */
    boss: { xEnd: 0.05 * L, radius: Math.max(0.8, 0.12 * propRadius + 0.018 * B) },
    prop: { x: 0.043 * L, y: hubY, radius: propRadius, blades: L > 240 ? 4 : 5 },
    rudder: { x: 0.018 * L, yBottom: 0.04 * T, yTop: 0.93 * T, chord: 0.022 * L, thickness: 0.004 * L },
    /** Height of the counter's underside at the transom and at the boss. */
    counter: { atTransom: 0.97 * T, atBoss: 0.9 * T },
    transomHalf: 0.8,
    sheerFwd: 0.006 * L,
    sheerAft: 0.002 * L,
    forecastle: { start: 0.915 * L, height: 2.6 },
  };
}

export type HullForm = ReturnType<typeof hullForm>;

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Main-deck height at x, before camber: moulded depth plus sheer and the forecastle. */
export function deckHeight(f: HullForm, x: number): number {
  const t = x / f.L;
  let y = f.D;
  if (t > 0.6) y += f.sheerFwd * ((t - 0.6) / 0.4) ** 2;
  if (t < 0.25) y += f.sheerAft * ((0.25 - t) / 0.25) ** 2;
  if (x >= f.forecastle.start) y += f.forecastle.height;
  return y;
}

/** Height of the hull's underside above the keel line at x. */
export function bottomHeight(f: HullForm, x: number): number {
  const { boss, counter, prop } = f;
  if (x < boss.xEnd) return counter.atTransom + (counter.atBoss - counter.atTransom) * (x / boss.xEnd);
  const riseStart = 0.13 * f.L;
  if (x >= riseStart) return 0;
  const u = (riseStart - x) / (riseStart - boss.xEnd);
  return (prop.y - boss.radius) * u * u;
}

/** x of the stem at height y (the bow rakes forward going up). */
function stemX(f: HullForm, y: number): number {
  const top = deckHeight(f, f.L);
  if (y >= f.T) return f.L - f.stemRakeAbove * (1 - clamp((y - f.T) / (top - f.T)));
  // Below about three-quarters of the draft the bulb takes over; the stem curves back from it.
  const u = smooth(clamp((y / f.T - 0.72) / 0.28));
  return f.L - f.stemRakeAbove - (f.forefoot - f.stemRakeAbove) * (1 - u);
}

/** Half-breadth of the main hull (without the bulb) at x and height y. */
function bodyHalfBreadth(f: HullForm, x: number, y: number): number {
  const half = f.B / 2;
  if (x > f.entrance) {
    const xs = stemX(f, y);
    if (x >= xs) return 0;
    const u = (x - f.entrance) / (xs - f.entrance);
    // Fuller waterlines higher up: that's the flare over the bow.
    const p = 1.7 + 0.9 * clamp(y / f.D);
    return half * (1 - u ** p) ** (1 / p);
  }
  if (x < f.run) {
    const u = x / f.run; // 0 at the transom
    const high = half * (f.transomHalf + (1 - f.transomHalf) * Math.sin((u * Math.PI) / 2));
    const bossShare = f.boss.radius / half;
    const low = half * (bossShare + (1 - bossShare) * smooth(clamp(u * 1.08)));
    // Sections are narrow near the keel aft and open out towards the waterline.
    const yb = bottomHeight(f, x);
    const s = smooth(clamp((y - yb) / (1.05 * f.T - yb)));
    return low + (high - low) * s;
  }
  return half;
}

/** Half-breadth of the bulbous bow at x and height y (zero outside it). */
function bulbHalfBreadth(f: HullForm, x: number, y: number): number {
  const { xc, yc, ax, ay, az } = f.bulb;
  // The underside reaches down to the keel line; the top is rounder.
  const dy = (y - yc) / (y < yc ? yc : ay);
  const dx = x > xc ? (x - xc) / ax : 0;
  const r = 1 - dx * dx - dy * dy;
  return r > 0 ? az * Math.sqrt(r) : 0;
}

/** Hull half-breadth at x and height y: the body blended smoothly into the bulb. */
export function halfBreadth(f: HullForm, x: number, y: number): number {
  const a = bodyHalfBreadth(f, x, y);
  const b = bulbHalfBreadth(f, x, y);
  if (b <= 0) return a;
  const k = 6;
  return (a ** k + b ** k) ** (1 / k);
}

const BOTTOM_POINTS = 3;
const BILGE_POINTS = 6;
const SIDE_POINTS = 22;
/** Points on one side of a section, keel centre to deck edge. */
export const POINTS_PER_SIDE = BOTTOM_POINTS + BILGE_POINTS + 1 + SIDE_POINTS;

/**
 * One cross-section at x, as (z, y) points on the port side from the keel
 * centreline, across the flat bottom, round the bilge and up to the deck edge.
 */
export function halfSection(f: HullForm, x: number): [number, number][] {
  const yb = bottomHeight(f, x);
  const yd = deckHeight(f, x);
  const H = yd - yb;
  const r0 = Math.min(f.bilgeRadius, 0.3 * H);
  const wAtBilgeTop = halfBreadth(f, x, yb + r0);
  const r = Math.min(r0, 0.9 * wAtBilgeTop);
  const flat = Math.max(0, halfBreadth(f, x, yb + r) - r);
  const pts: [number, number][] = [];
  for (let j = 0; j < BOTTOM_POINTS; j++) pts.push([(flat * j) / BOTTOM_POINTS, yb]);
  for (let k = 0; k <= BILGE_POINTS; k++) {
    const a = (k / BILGE_POINTS) * (Math.PI / 2);
    pts.push([flat + r * Math.sin(a), yb + r - r * Math.cos(a)]);
  }
  for (let k = 1; k <= SIDE_POINTS; k++) {
    const y = yb + r + ((yd - yb - r) * k) / SIDE_POINTS;
    pts.push([Math.max(0.01, halfBreadth(f, x, y)), y]);
  }
  return pts;
}

/** Station positions: close together at the ends where the shape changes, and
 *  paired either side of steps (the boss end, the forecastle front). */
export function stations(f: HullForm, detail = 1): number[] {
  const L = f.L;
  const xs = new Set<number>();
  const n = Math.round(70 * detail);
  for (let i = 0; i <= n; i++) xs.add((L * i) / n);
  const fine = Math.round(30 * detail);
  for (let i = 0; i <= fine; i++) {
    xs.add(f.entrance + ((L - f.entrance) * i) / fine);
    xs.add((f.run * 0.6 * i) / fine);
  }
  const eps = 0.05;
  for (const x of [f.boss.xEnd, f.forecastle.start]) {
    xs.add(x - eps);
    xs.add(x + eps);
  }
  // Just short of the stem, so the tip of the bulb and the stem are both drawn.
  xs.add(L - 0.002 * L);
  return [...xs].filter((x) => x >= 0 && x <= L).sort((a, b) => a - b);
}

export interface HullMesh {
  positions: number[]; // x, y, z triples
  indices: number[];
}

/**
 * The shell as a triangle mesh (port and starboard sides joined at the keel),
 * wound so faces point outwards. The deck is a separate mesh.
 */
export function hullMesh(spec: ShipSpec, detail = 1): HullMesh {
  const f = hullForm(spec);
  const xs = stations(f, detail);
  const positions: number[] = [];
  const indices: number[] = [];
  const side = POINTS_PER_SIDE;
  const ring = side * 2 - 1;
  for (const x of xs) {
    const half = halfSection(f, x);
    // Port side from the deck edge down to the keel, then starboard back up.
    for (let j = side - 1; j >= 0; j--) positions.push(x, half[j][1], half[j][0]);
    for (let j = 1; j < side; j++) positions.push(x, half[j][1], -half[j][0]);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // Transom: a fan from the middle of the stern section, facing aft.
  const centre = positions.length / 3;
  const sternRing = Array.from({ length: ring }, (_, j) => positions[j * 3 + 1]);
  positions.push(0, sternRing.reduce((s, y) => s + y, 0) / ring, 0);
  for (let j = 0; j < ring - 1; j++) indices.push(centre, j + 1, j);
  return { positions, indices };
}

/** Deck across the ship at each station, cambered, from port edge to starboard edge. */
export function deckMesh(spec: ShipSpec, detail = 1, across = 10): HullMesh {
  const f = hullForm(spec);
  const xs = stations(f, detail);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const x of xs) {
    const yd = deckHeight(f, x);
    const hw = Math.max(0.01, halfBreadth(f, x, yd));
    for (let k = 0; k <= across; k++) {
      const z = hw * (1 - (2 * k) / across);
      positions.push(x, yd + f.camber * (1 - (z / (f.B / 2)) ** 2), z);
    }
  }
  const row = across + 1;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k;
      const b = (i + 1) * row + k;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, indices };
}

/** Deck edge (port side) as points along the ship, for railings. */
export function deckEdge(spec: ShipSpec, from: number, to: number, step = 1.5): [number, number, number][] {
  const f = hullForm(spec);
  const out: [number, number, number][] = [];
  const n = Math.max(1, Math.round((to - from) / step));
  for (let i = 0; i <= n; i++) {
    const x = from + ((to - from) * i) / n;
    const y = deckHeight(f, x);
    out.push([x, y, halfBreadth(f, x, y)]);
  }
  return out;
}

export interface Box {
  x: number; // centre
  y: number;
  z: number;
  lx: number; // size
  ly: number;
  lz: number;
}

export interface Crane {
  x: number;
  pedestalHeight: number;
  jibLength: number;
  /** Which way the jib points when stowed: +1 forward, -1 aft. */
  facing: 1 | -1;
  /** Safe working load, tonnes (painted on the jib). */
  swl: number;
}

export interface Tier extends Box {
  windows: number; // windows along the front
}

/**
 * The general arrangement placed from the particulars: hatches, cranes,
 * accommodation tiers and wheelhouse, funnel, masts, lifeboat, deck gear.
 */
export function arrangement(spec: ShipSpec) {
  const f = hullForm(spec);
  const L = spec.loa_m;
  const B = spec.beam_m;
  const geared = spec.cranes > 0;
  const cargoStart = 0.165 * L;
  const cargoEnd = 0.9 * L;
  const pitch = (cargoEnd - cargoStart) / Math.max(1, spec.holds);
  const coamingHeight = 1.8;
  const coverHeight = 0.9;

  const hatches: Box[] = Array.from({ length: spec.holds }, (_, i) => {
    const x = cargoStart + pitch * (i + 0.5);
    const yDeck = deckHeight(f, x) + f.camber;
    const lz = B * (geared ? 0.6 : 0.5);
    return { x, y: yDeck + (coamingHeight + coverHeight) / 2, z: 0, lx: pitch * 0.68, ly: coamingHeight + coverHeight, lz };
  });

  // Geared ships carry cranes on the centreline between hatches, jibs stowed alternately
  // fore and aft. A heavier crane (Supramax 35-36 t against Handysize 30 t) is taller with a longer jib.
  const swl = spec.crane_swl_t ?? 30;
  const cranes: Crane[] = Array.from({ length: spec.cranes }, (_, i) => ({
    x: cargoStart + pitch * (i + 1),
    pedestalHeight: 7.5 + (swl - 30) * 0.12,
    jibLength: Math.min(26 + (swl - 30) * 0.4, pitch * 1.25),
    facing: i % 2 === 0 ? -1 : 1,
    swl,
  }));

  // Accommodation aft, over the engine room: tiers of 2.8 m, the wheelhouse on top.
  const tierCount = Math.min(8, Math.max(5, Math.round(3.2 + L / 70)));
  const accFront = 0.14 * L;
  const accLength = Math.max(12, 0.06 * L);
  const accX = accFront - accLength / 2;
  const deckAtAcc = deckHeight(f, accX);
  const tierHeight = 2.8;
  const tiers: Tier[] = Array.from({ length: tierCount }, (_, i) => {
    const width = B * (0.74 - 0.02 * Math.max(0, i - 2));
    const length = accLength * (i === tierCount - 1 ? 0.62 : 1 - 0.03 * i);
    return {
      x: accFront - length / 2,
      y: deckAtAcc + tierHeight * (i + 0.5),
      z: 0,
      lx: length,
      ly: tierHeight,
      lz: width,
      windows: Math.max(4, Math.floor(width / 2.4)),
    };
  });
  const wheelhouse = tiers[tierCount - 1];
  const bridgeWings: Box = {
    x: accFront - 2.2,
    y: wheelhouse.y + 0.2,
    z: 0,
    lx: 4.4,
    ly: 0.5,
    lz: B,
  };
  const accTop = deckAtAcc + tierHeight * tierCount;

  // Funnel at the aft end of the accommodation, rising from a few decks up to
  // a few metres above the wheelhouse, over the engine casing.
  const funnelBase = deckAtAcc + tierHeight * Math.max(2, tierCount - 3);
  const funnelTop = accTop + 4.5;
  const funnel = {
    x: accFront - accLength - Math.max(2.5, 0.012 * L),
    y: (funnelBase + funnelTop) / 2,
    lx: Math.max(6, 0.03 * L),
    ly: funnelTop - funnelBase,
    lz: Math.max(3.8, 0.13 * B),
  };
  const casing: Box = {
    x: funnel.x + 0.8,
    y: (deckAtAcc + funnelBase) / 2,
    z: 0,
    lx: funnel.lx + 3,
    ly: funnelBase - deckAtAcc,
    lz: funnel.lz + 5,
  };

  const radarMast = { x: wheelhouse.x - 0.5, y: accTop, height: 6 };
  const fcDeck = deckHeight(f, 0.97 * L);
  const foremast = { x: 0.965 * L, y: fcDeck, height: Math.max(9, 0.035 * L) };
  const lifeboat = { x: Math.max(4.5, 0.028 * L), y: deckHeight(f, 0.03 * L) + 3.2, length: L > 200 ? 9 : 8, pitch: 0.6 };
  const windlasses = [1, -1].map((s) => ({ x: 0.955 * L, y: fcDeck, z: s * B * 0.17 }));
  const anchors = [1, -1].map((s) => ({ x: 0.94 * L, y: deckHeight(f, 0.94 * L) - 3.2, side: s }));
  // Bollard pairs along the deck edge: at the ends and between every other hatch.
  const bollardXs = [0.03 * L, 0.2 * L, ...hatches.filter((_, i) => i % 2 === 1).map((h) => h.x + pitch / 2), 0.93 * L, 0.985 * L];
  const bollards = bollardXs.flatMap((x) => [1, -1].map((s) => ({ x, y: deckHeight(f, x), z: s * (halfBreadth(f, x, deckHeight(f, x)) - 1.4) })));

  const hatchCover: "folding" | "side_rolling" = spec.hatch_cover_type ?? (geared ? "folding" : "side_rolling");
  const edge = (x: number) => halfBreadth(f, x, deckHeight(f, x));

  // Grabs stowed on deck beside each crane pedestal, ready to hook on.
  const grabs = cranes.map((c, i) => ({ x: c.x, z: (i % 2 === 0 ? 1 : -1) * Math.min(B * 0.2, 6.5), y: deckHeight(f, c.x) }));

  // Air pipes and mushroom vents for the holds, at each end of each hatch, both sides.
  const vents = hatches.flatMap((h) =>
    [-1, 1].flatMap((end) =>
      [1, -1].map((side) => {
        const x = h.x + end * (h.lx / 2 + 1.3);
        return { x, y: deckHeight(f, x), z: side * Math.min(h.lz / 2 + 1.6, edge(x) - 1.8), kind: end > 0 ? "mushroom" : "pipe" };
      })
    )
  );

  // Mooring: winches on the forecastle and the poop, fairleads (Panama chocks) at the deck edge.
  const mooringWinches = [
    ...[1, -1].map((s) => ({ x: 0.925 * L, y: deckHeight(f, 0.925 * L), z: s * B * 0.24 })),
    ...[1, -1].map((s) => ({ x: 0.045 * L, y: deckHeight(f, 0.045 * L), z: s * B * 0.24 })),
  ];
  const fairleads = [0.985 * L, 0.955 * L, 0.02 * L, 0.07 * L].flatMap((x) =>
    [1, -1].map((s) => ({ x, y: deckHeight(f, x), z: s * Math.max(0.5, edge(x) - 0.35), side: s }))
  );

  // Life-saving: liferaft canisters in cradles on the accommodation sides, lifebuoys on the
  // bridge wings and the poop rail, a rescue boat on its davit to starboard, the provision
  // crane to port.
  const tier1 = tiers[Math.min(1, tiers.length - 1)];
  const liferafts = [1, -1].flatMap((s) =>
    [0.25, 0.55].map((u) => ({ x: accFront - accLength * u, y: deckAtAcc + tierHeight * 2 + 0.2, z: s * (tier1.lz / 2 + 0.9) }))
  );
  const lifebuoys = [
    ...[1, -1].map((s) => ({ x: bridgeWings.x + 1.6, y: bridgeWings.y - wheelhouse.ly / 2 + 0.9, z: s * (B / 2 - 0.4), side: s })),
    ...[1, -1].map((s) => ({ x: 0.018 * L, y: deckHeight(f, 0.018 * L) + 0.75, z: s * (edge(0.018 * L) - 0.8), side: s })),
  ];
  const rescueBoat = { x: accFront - accLength * 0.62, y: deckAtAcc + tierHeight * 1.35, z: -(tier1.lz / 2 + 2.3), length: 6.2 };
  const provisionCrane = { x: accFront - accLength * 0.45, y: deckAtAcc + tierHeight, z: tier1.lz / 2 + 1.1 };
  // Accommodation ladders stowed flat along the ship's side under the deck edge, just forward of the accommodation.
  const ladderLength = Math.min(28, 1.25 * (spec.depth_m - 0.4 * spec.draft_laden_m) + 4);
  const accommodationLadders = [1, -1].map((s) => ({ x: accFront + 3 + ladderLength / 2, y: deckHeight(f, accFront + 3) - 1.4, z: s * (edge(accFront + 3) + 0.45), length: ladderLength, side: s }));
  const pilotReels = [1, -1].map((s) => ({ x: 0.5 * L, y: deckHeight(f, 0.5 * L), z: s * (edge(0.5 * L) - 1.2) }));

  // Navigation lights (COLREGs): masthead lights on the foremast and the radar mast, the
  // sidelights (red to port, green to starboard) at the bridge-wing ends, the stern light.
  const sternDeck = deckHeight(f, 0.004 * L);
  const navLights = {
    mastheadFwd: [foremast.x, foremast.y + foremast.height - 0.3, 0] as const,
    mastheadAft: [radarMast.x, radarMast.y + radarMast.height + 0.3, 0] as const,
    port: [bridgeWings.x + 1.2, bridgeWings.y - wheelhouse.ly / 2 + 1.5, B / 2 - 0.2] as const,
    starboard: [bridgeWings.x + 1.2, bridgeWings.y - wheelhouse.ly / 2 + 1.5, -(B / 2 - 0.2)] as const,
    stern: [0.3, sternDeck + 2.2, 0] as const,
  };
  // Deck floodlights on the masts and the accommodation front, aimed at the hatches.
  const floodlights = [
    [foremast.x - 0.3, foremast.y + foremast.height * 0.62, 1.2],
    [foremast.x - 0.3, foremast.y + foremast.height * 0.62, -1.2],
    [accFront + 0.2, deckAtAcc + tierHeight * (tierCount - 1) - 0.4, tier1.lz * 0.3],
    [accFront + 0.2, deckAtAcc + tierHeight * (tierCount - 1) - 0.4, -tier1.lz * 0.3],
    ...cranes.map((c) => [c.x + 1.8, deckHeight(f, c.x) + c.pedestalHeight + 3.4, 0]),
  ] as [number, number, number][];
  const satDomes = [
    { x: radarMast.x - 1.2, y: accTop + 0.2, z: tier1.lz * 0.28, r: L > 240 ? 0.75 : 0.6 },
    { x: radarMast.x - 1.2, y: accTop + 0.2, z: -tier1.lz * 0.28, r: 0.5 },
  ];
  const flagstaff = { x: 0.6, y: sternDeck, height: 6 };

  const topHeight = Math.max(accTop + radarMast.height, foremast.y + foremast.height);
  return {
    hatchCover,
    grabs,
    vents,
    mooringWinches,
    fairleads,
    liferafts,
    lifebuoys,
    rescueBoat,
    provisionCrane,
    accommodationLadders,
    pilotReels,
    navLights,
    floodlights,
    satDomes,
    flagstaff,
    form: f,
    hatches,
    cranes,
    tiers,
    wheelhouse,
    bridgeWings,
    accFront,
    accLength,
    accTop,
    funnel,
    casing,
    radarMast,
    foremast,
    lifeboat,
    windlasses,
    anchors,
    bollards,
    topHeight,
    // Kept for the 2D profile: one box for the accommodation block and the forecastle.
    accommodation: { x: accX, y: deckAtAcc + (accTop - deckAtAcc) / 2, z: 0, lx: accLength, ly: accTop - deckAtAcc, lz: B * 0.74 } as Box,
    forecastle: { x: (f.forecastle.start + L) / 2, y: fcDeck - f.forecastle.height / 2, z: 0, lx: L - f.forecastle.start, ly: f.forecastle.height, lz: B * 0.8 } as Box,
  };
}

/** Draft a ship sails at under a draft limit (never deeper than laden). */
export function sailingDraft(spec: ShipSpec, limit?: number | null): number {
  return limit != null ? Math.min(spec.draft_laden_m, limit) : spec.draft_laden_m;
}

/** Draft in ballast, with no cargo: about 40% of the laden draft for a bulk carrier. */
export function ballastDraft(spec: ShipSpec) {
  return 0.4 * spec.draft_laden_m;
}

/**
 * Draft with `cargo` tonnes aboard: laden draft less the cargo not loaded,
 * at the tonnes-per-centimetre rate, never lighter than the ballast draft.
 * (The same rule the backend uses for part-loading.)
 */
export function draftForCargo(spec: ShipSpec, cargo: number): number {
  const payload = spec.payload_tonnes ?? 0;
  if (!spec.tpc || payload <= 0) return spec.draft_laden_m;
  const short = Math.max(0, payload - cargo);
  return Math.max(ballastDraft(spec), spec.draft_laden_m - short / (spec.tpc * 100));
}

/** Cargo that brings the ship to a draft (inverse of draftForCargo). */
export function cargoForDraft(spec: ShipSpec, draft: number): number {
  const payload = spec.payload_tonnes ?? 0;
  if (!spec.tpc || payload <= 0) return payload;
  return Math.min(payload, Math.max(0, payload - (spec.draft_laden_m - draft) * spec.tpc * 100));
}

/** Bounding box of a mesh, for checks and camera framing. */
export function bounds(mesh: HullMesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.positions[i + k]);
      max[k] = Math.max(max[k], mesh.positions[i + k]);
    }
  }
  return { min, max };
}

/** A ShipSpec from the API's vessel class record. */
export function toSpec(v: {
  name: string;
  loa_m: number;
  beam_m: number;
  draft_laden_m: number;
  depth_m: number | null;
  holds: number;
  cranes: number;
  payload_tonnes?: number;
  tpc_t_per_cm?: number | null;
  block_coefficient?: number | null;
  hatch_cover_type?: string | null;
  crane_swl_t?: number | null;
}): ShipSpec {
  return {
    name: v.name,
    loa_m: v.loa_m,
    beam_m: v.beam_m,
    draft_laden_m: v.draft_laden_m,
    depth_m: v.depth_m ?? v.draft_laden_m * 1.4,
    holds: v.holds,
    cranes: v.cranes,
    payload_tonnes: v.payload_tonnes,
    tpc: v.tpc_t_per_cm ?? null,
    block_coefficient: v.block_coefficient ?? null,
    hatch_cover_type: v.hatch_cover_type === "folding" || v.hatch_cover_type === "side_rolling" ? v.hatch_cover_type : null,
    crane_swl_t: v.crane_swl_t ?? null,
  };
}
