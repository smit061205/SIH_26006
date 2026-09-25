// Geometry checks for src/components/ship3d/hull.ts: every class's shell spans
// its real length, beam and depth, faces point outwards, the bulb and sheer are
// where a bulk carrier has them, and the load rule matches the backend's.
// Run: npm run check:hull
import {
  arrangement,
  ballastDraft,
  bounds,
  cargoForDraft,
  deckHeight,
  deckMesh,
  draftForCargo,
  halfBreadth,
  hullForm,
  hullMesh,
  sailingDraft,
  type ShipSpec,
  toSpec,
} from "../src/components/ship3d/hull.ts";
import { SAMPLE_CLASSES } from "../src/components/ship3d/sampleShips.ts";
import { cumulative, densify, seaName, toLonLat, toVec } from "../src/components/ship3d/geo.ts";
import { seaState, shipMotion, significantHeight } from "../src/components/ship3d/waves.ts";
import { readFileSync } from "node:fs";

// The classes as the app draws them (the same fixture the component kit uses),
// checked against data/vessel_classes.csv below so the two never drift.
const SHIPS: ShipSpec[] = SAMPLE_CLASSES.map(toSpec);

const close = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol * Math.abs(b);

/** Outward normal check: the average face normal on the port side amidships points to port (+z). */
function facesOutward(s: ShipSpec) {
  const m = hullMesh(s);
  let sum = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((k) => m.positions.slice(k * 3, k * 3 + 3));
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cz = (a[2] + b[2] + c[2]) / 3;
    if (Math.abs(cx - s.loa_m / 2) > s.loa_m * 0.1 || cz < s.beam_m * 0.45) continue;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    sum += u[0] * v[1] - u[1] * v[0]; // z of the cross product
  }
  return sum > 0;
}

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failed++;
    console.log(`  FAIL ${what}`);
  }
  return ok;
};

for (const s of SHIPS) {
  const f = hullForm(s);
  const { min, max } = bounds(hullMesh(s));
  const length = max[0] - min[0];
  const beam = max[2] - min[2];
  const midDepth = deckHeight(f, s.loa_m / 2);
  const deck = bounds(deckMesh(s));
  const a = arrangement(s);
  const T = s.draft_laden_m;
  console.log(`${s.name}: ${length.toFixed(1)} x ${beam.toFixed(2)} m, depth ${midDepth.toFixed(2)} m, ${a.hatches.length} hatches, ${a.cranes.length} cranes, ${a.tiers.length} tiers`);
  check(close(length, s.loa_m), "length");
  check(close(beam, s.beam_m), "beam");
  check(close(midDepth, s.depth_m) && min[1] >= -1e-6, "moulded depth amidships, keel at 0");
  check(facesOutward(s), "hull faces point outwards");
  check(deck.max[1] > s.depth_m + f.forecastle.height, "forecastle and sheer raise the deck forward");
  // Bulb: wider than the stem just above it, ahead of the forefoot, below the waterline.
  const xb = f.bulb.xc + f.bulb.ax * 0.75;
  check(halfBreadth(f, xb, f.bulb.yc) > 1 && halfBreadth(f, xb, T * 1.05) < halfBreadth(f, xb, f.bulb.yc) + 0.5, "bulbous bow");
  // Aft run: narrow at the boss, full at the deck.
  check(halfBreadth(f, f.boss.xEnd + 1, f.prop.y) < s.beam_m * 0.2 && halfBreadth(f, f.boss.xEnd + 1, s.depth_m) > s.beam_m * 0.35, "stern boss and transom");
  check(f.prop.y + f.prop.radius < T && f.prop.y - f.prop.radius > 0, "propeller immersed and above the keel");
  check(a.hatches.length === s.holds && a.cranes.length === s.cranes && a.hatches.every((h) => h.x > 0 && h.x < s.loa_m), "hatches and cranes");
  check(a.tiers[a.tiers.length - 1].y < a.topHeight, "wheelhouse under the masthead");
  check(sailingDraft(s, 9) === Math.min(9, T), "sailing draft under a limit");
  // Load rule: full cargo -> laden draft; each 100*TPC tonnes short lifts 1 m; never above ballast.
  check(close(draftForCargo(s, s.payload_tonnes!), T, 1e-9), "laden draft at full cargo");
  check(close(draftForCargo(s, s.payload_tonnes! - s.tpc! * 100), T - 1, 1e-9), "1 m lighter per 100 x TPC tonnes");
  check(draftForCargo(s, 0) === ballastDraft(s), "ballast draft when empty");
  check(close(cargoForDraft(s, T - 1), s.payload_tonnes! - s.tpc! * 100, 1e-9), "cargo for a draft");
}
// Fixture against the data: every particular the 3D model uses matches the CSV.
{
  const [header, ...lines] = readFileSync(new URL("../../data/vessel_classes.csv", import.meta.url), "utf8").trim().split("\n");
  const cols = header.split(",");
  const rows = lines.map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, ""));
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
  });
  for (const c of SAMPLE_CLASSES) {
    const r = rows.find((x) => x.vessel_class === c.name);
    const same = (a: number | null, b: string) => Math.abs((a ?? 0) - Number(b || 0)) < 1e-6;
    check(
      !!r &&
        same(c.loa_m, r.loa_m) && same(c.beam_m, r.beam_m) && same(c.depth_m, r.depth_m) && same(c.draft_laden_m, r.draft_laden_m) &&
        same(c.holds, r.holds) && same(c.cranes, r.cranes) && same(c.tpc_t_per_cm, r.tpc_t_per_cm) && same(c.block_coefficient, r.block_coefficient) &&
        same(c.crane_swl_t, r.crane_swl_t) && c.hatch_cover_type === r.hatch_cover_type,
      `${c.name}: sample particulars match data/vessel_classes.csv`
    );
  }
}

// Block coefficient: the model's underwater fullness (displaced volume over L x B x T,
// on the overall length) rises from Handysize to Capesize, and the parallel body with it.
const cbOf = (s: ShipSpec) => {
  const f = hullForm(s);
  const nx = 240;
  const ny = 24;
  let v = 0;
  for (let i = 0; i < nx; i++) {
    const x = ((i + 0.5) / nx) * s.loa_m;
    for (let j = 0; j < ny; j++) v += 2 * halfBreadth(f, x, ((j + 0.5) / ny) * s.draft_laden_m);
  }
  return (v * (s.loa_m / nx) * (s.draft_laden_m / ny)) / (s.loa_m * s.beam_m * s.draft_laden_m);
};
const cbs = SHIPS.map(cbOf);
console.log(`model block coefficients (on LOA): ${SHIPS.map((s, i) => `${s.name} ${cbs[i].toFixed(3)}`).join(", ")}`);
check(cbs.every((c, i) => i === 0 || c >= cbs[i - 1] - 0.005) && cbs[0] < cbs[cbs.length - 1], "fuller hulls from Handysize to Capesize");
check(cbs.every((c, i) => Math.abs(c - SHIPS[i].block_coefficient! * 0.97) < 0.08), "model fullness near each class's block coefficient");
for (const s of SHIPS) {
  const a = arrangement(s);
  check(a.hatchCover === (s.cranes > 0 ? "folding" : "side_rolling"), `${s.name}: ${s.cranes > 0 ? "folding" : "side-rolling"} hatch covers`);
  check(a.grabs.length === s.cranes && a.navLights.port[2] > 0 && a.navLights.starboard[2] < 0, `${s.name}: grabs per crane, red light to port, green to starboard`);
}

// Sea state: the wave trains add up to the significant wave height asked for, and a
// long ship barely moves in a small sea.
for (const hs of [0.5, 1.5, 3.5]) {
  check(close(significantHeight(seaState(hs)), hs, 1e-6), `wave trains add up to Hs ${hs} m`);
}
const calm = shipMotion(seaState(0.5), 290, 45, 3.7);
check(Math.abs(calm.pitch) < 0.01 && Math.abs(calm.roll) < 0.02, "a Capesize barely pitches or rolls in a 0.5 m sea");

// Geography: positions round-trip, seas are named, and route lengths match searoute's.
for (const [lon, lat] of [[149.3, -21.26], [86.68, 20.26], [-76.33, 36.87], [0, 0]]) {
  const [lo, la] = toLonLat(toVec(lon, lat, 100));
  check(Math.abs(lo - lon) < 1e-6 && Math.abs(la - lat) < 1e-6, `lon/lat round trip ${lon}, ${lat}`);
}
check(seaName(88, 15) === "Bay of Bengal" && seaName(100, 3) === "Strait of Malacca" && seaName(38, 20) === "Red Sea", "sea names");
const routes = JSON.parse(readFileSync(new URL("../../data/sea_routes.json", import.meta.url), "utf8")).routes as { origin: string; port: string; nm: number; coords: [number, number][] }[];
let worst = 0;
for (const r of routes) {
  const pts = densify(r.coords, 1);
  const nm = cumulative(pts).at(-1)!;
  worst = Math.max(worst, Math.abs(nm - r.nm) / r.nm);
}
console.log(`${routes.length} sea routes; drawn length within ${(worst * 100).toFixed(1)}% of searoute's distance`);
check(routes.length === 42 && worst < 0.05, "sea routes: all 42 pairs, drawn length within 5% of the stated distance");

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all hull checks passed");
