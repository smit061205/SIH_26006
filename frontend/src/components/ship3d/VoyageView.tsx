import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { type PublicRoutes, type VoyageRoute, getPublicRoutes, getRoute } from "../../api";
import { num } from "../../lib/format";
import { translate, useLang, useT } from "../../lib/i18n";
import { Skeleton } from "../ui/feedback";
import { Figure, FigureRow } from "../ui/figures";
import { Segmented, Slider } from "../ui/inputs";
import { prefersReducedMotion, useShipColors } from "./colors";
import { type Vec3, cumulative, densify, extent, pointAlong, seaName, toLonLat, toVec } from "./geo";
import { type LandPolygons, loadLand } from "./land";
import { use3d } from "./ShipView";

const GlobeScene = lazy(() => import("./Globe").then((m) => ({ default: m.GlobeScene })));

/** "Australia (Hay Point/Dalrymple Bay)" -> "Hay Point". */
export function shortOrigin(origin: string) {
  return origin.match(/\(([^/)]+)/)?.[1]?.trim() ?? origin;
}

/** Camera distance (in globe radii) that frames points spread over `radius` radians. */
function frameDistance(radius: number) {
  return Math.min(4.3, Math.max(1.55, 1.3 + 2.4 * radius));
}

/** The land as an SVG path on an equirectangular map, W x H. */
function landPath(land: LandPolygons, w: number, h: number) {
  const x = (lon: number) => (((lon + 180) / 360) * w).toFixed(1);
  const y = (lat: number) => (((90 - lat) / 180) * h).toFixed(1);
  return land
    .flatMap((polygon) =>
      polygon.map((ring) => {
        // Skip the date-line seam instead of drawing a line across the map.
        let d = "";
        ring.forEach(([lon, lat], i) => {
          const jump = i > 0 && Math.abs(lon - ring[i - 1][0]) > 180;
          d += `${i === 0 || jump ? "M" : "L"}${x(lon)} ${y(lat)}`;
        });
        return d + "Z";
      })
    )
    .join("");
}

/**
 * Flat map for phones, print and browsers without WebGL: the routes on an
 * equirectangular projection, cropped to `box` [lonMin, lonMax, latMin, latMax].
 */
export function FlatMap({
  routes,
  points,
  ship,
  box,
  label,
}: {
  routes: { coords: [number, number][]; highlight?: boolean }[];
  points: { lon: number; lat: number; kind: "load" | "discharge"; name?: string }[];
  ship?: [number, number];
  box: [number, number, number, number];
  label: string;
}) {
  const colors = useShipColors();
  const [land, setLand] = useState<LandPolygons | null>(null);
  useEffect(() => {
    let alive = true;
    void loadLand().then((l) => alive && setLand(l));
    return () => {
      alive = false;
    };
  }, []);
  const W = 3600;
  const H = 1800;
  const x = (lon: number) => ((lon + 180) / 360) * W;
  const y = (lat: number) => ((90 - lat) / 180) * H;
  const d = useMemo(() => (land ? landPath(land, W, H) : ""), [land]);
  const [x0, x1, y0, y1] = [x(box[0]), x(box[1]), y(box[3]), y(box[2])];
  const scale = (x1 - x0) / 800;
  const line = (coords: [number, number][]) => coords.map(([lon, lat], i) => `${i ? "L" : "M"}${x(lon).toFixed(1)} ${y(lat).toFixed(1)}`).join("");
  return (
    <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} className="block h-auto w-full" role="img" aria-label={label}>
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={colors.dark ? "#0f1d27" : "#d9e6ee"} />
      <path d={d} fill={colors.dark ? "#2a3643" : "#f6f4ef"} stroke={colors.dark ? "#46576a" : "#aab6be"} strokeWidth={0.8 * scale} />
      {routes.map((r, i) => (
        <path
          key={i}
          d={line(r.coords)}
          fill="none"
          stroke={r.highlight ? colors.accent : colors.ink3}
          strokeOpacity={r.highlight ? 1 : 0.55}
          strokeWidth={(r.highlight ? 3 : 1.4) * scale}
          strokeLinejoin="round"
        />
      ))}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.lon)} cy={y(p.lat)} r={(p.name ? 5 : 3.5) * scale} fill={p.kind === "load" ? colors.signal : colors.accent} />
          {p.name && (
            // Near the right edge the name goes on the marker's left, so it isn't cut off.
            <text
              x={x(p.lon) + (x(p.lon) > x1 - 200 * scale ? -8 : 8) * scale}
              y={y(p.lat) + 4 * scale}
              textAnchor={x(p.lon) > x1 - 200 * scale ? "end" : "start"}
              fontSize={13 * scale}
              fill={colors.label}
              fontWeight={600}
            >
              {p.name}
            </text>
          )}
        </g>
      ))}
      {ship && <circle cx={x(ship[0])} cy={y(ship[1])} r={7 * scale} fill="none" stroke={colors.accent} strokeWidth={2.5 * scale} />}
    </svg>
  );
}

type Focus = "route" | "departure" | "arrival";

/** Where the ship is on `day` of the voyage, and what to say about it. */
function voyagePosition(route: VoyageRoute, points: Vec3[], cum: number[], day: number) {
  const fraction = route.transit_days > 0 ? day / route.transit_days : 0;
  const { at, ahead } = pointAlong(points, cum, fraction);
  const [lon, lat] = toLonLat(at);
  const total = cum[cum.length - 1];
  return { at, ahead, lon, lat, left: total * (1 - Math.min(1, fraction)), total, sea: seaName(lon, lat) };
}

/**
 * The plan's voyage on a globe: the real sea route from the load port to the
 * discharge port (Malacca, Suez or the open ocean), and the ship part-way
 * along. Drag the day to see where it is, which sea, and how far is left.
 */
export function VoyageView({ origin, port, height = 380 }: { origin: string; port: string; height?: number }) {
  const t = useT();
  const threeD = use3d(640);
  const route = useQuery({ queryKey: ["route", origin, port], queryFn: ({ signal }) => getRoute(origin, port, signal), staleTime: Infinity });
  const [day, setDay] = useState(0);
  const [focus, setFocus] = useState<Focus>("route");
  const data = route.data;
  const geometry = useMemo(() => {
    if (!data) return null;
    const points = densify(data.coords, 1);
    return { points, cum: cumulative(points), ext: extent(points) };
  }, [data]);
  if (route.isError) return <p className="text-[14px] text-ink-3">{t("The route map isn't available right now.")}</p>;
  if (!data || !geometry) return <div style={{ height }}><Skeleton className="h-full w-full" /></div>;

  const pos = voyagePosition(data, geometry.points, geometry.cum, day);
  const loadName = data.load_port.name;
  const where =
    day <= 0
      ? t("Loading at {port}", { port: loadName })
      : day >= data.transit_days
        ? t("Arrived at {port}", { port })
        : t("Day {d} of {n}: in the {sea}", { d: num(day, day % 1 ? 1 : 0), n: num(data.transit_days), sea: t(pos.sea) });
  const label = t("Sea route from {from} to {to}, {nm} nautical miles. {where}.", { from: loadName, to: port, nm: num(data.nm), where });
  const start = toVec(data.load_port.lon, data.load_port.lat);
  const end = toVec(data.discharge.lon, data.discharge.lat);
  const view =
    focus === "departure"
      ? { centre: start, distance: 1.7 }
      : focus === "arrival"
        ? { centre: end, distance: 1.7 }
        : { centre: geometry.ext.centre, distance: frameDistance(geometry.ext.radius) };
  const lons = data.coords.map((c) => c[0]);
  const lats = data.coords.map((c) => c[1]);
  const box: [number, number, number, number] = [
    Math.max(-180, Math.min(...lons) - 12),
    Math.min(180, Math.max(...lons) + 12),
    Math.max(-80, Math.min(...lats) - 10),
    Math.min(85, Math.max(...lats) + 10),
  ];
  const markers = [
    { name: loadName, at: start, kind: "load" as const, label: true },
    { name: port, at: end, kind: "discharge" as const, label: true },
  ];
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius-control)] border border-rule bg-sunken">
        {threeD && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-surface px-3 py-2 print:hidden">
            <Segmented
              label={t("Globe view")}
              value={focus}
              onChange={setFocus}
              options={[
                { value: "route", label: t("Whole route") },
                { value: "departure", label: t("Departure") },
                { value: "arrival", label: t("Arrival") },
              ]}
            />
            <p className="text-[13.5px] text-ink-2" aria-live="polite">
              {where}
            </p>
          </div>
        )}
        {threeD ? (
          <div className="print:hidden">
            <Suspense fallback={<div style={{ height }}><Skeleton className="h-full w-full" /></div>}>
              <GlobeScene
                routes={[{ coords: data.coords, highlight: true }]}
                markers={markers}
                ship={{ at: pos.at, ahead: pos.ahead }}
                centre={view.centre}
                distance={view.distance}
                focusKey={`${focus}:${origin}:${port}`}
                height={height}
                animate={!prefersReducedMotion()}
                label={label}
              />
            </Suspense>
          </div>
        ) : null}
        <div className={threeD ? "hidden print:block" : ""}>
          <FlatMap
            routes={[{ coords: data.coords, highlight: true }]}
            points={[
              { ...data.load_port, kind: "load" },
              { ...data.discharge, kind: "discharge" },
            ]}
            ship={[pos.lon, pos.lat]}
            box={box}
            label={label}
          />
        </div>
      </div>
      <Slider
        label={t("Day of the voyage")}
        value={day}
        min={0}
        max={data.transit_days}
        step={0.5}
        onChange={setDay}
        format={(v) => t("Day {d}", { d: num(v, v % 1 ? 1 : 0) })}
        valueText={where}
      />
      <FigureRow>
        <Figure label="Sea route" value={num(data.nm)} unit=" nm" note={t("{from} to {to}", { from: loadName, to: port })} />
        <Figure label="At sea" value={num(data.transit_days)} unit={` ${t("days")}`} note={t("at about 13.5 knots")} />
        <Figure label="Still to go" value={num(pos.left)} unit=" nm" note={where} />
      </FigureRow>
    </div>
  );
}

/**
 * Every route the planner covers, on one globe: six load ports to India's
 * seven east-coast discharge ports. For the landing page; public data only.
 */
export function CoverageGlobe({ height = 460 }: { height?: number }) {
  const t = useT();
  const threeD = use3d(640);
  const lang = useLang();
  const q = useQuery({ queryKey: ["public-routes"], queryFn: ({ signal }) => getPublicRoutes(signal), staleTime: Infinity });
  const data: PublicRoutes | undefined = q.data;
  const layout = useMemo(() => {
    if (!data) return null;
    const markers = [
      ...Object.entries(data.load_ports).map(([o, p]) => ({ name: shortOrigin(o), at: toVec(p.lon, p.lat), kind: "load" as const, label: true })),
      ...Object.entries(data.ports).map(([name, p]) => ({ name, at: toVec(p.lon, p.lat), kind: "discharge" as const })),
      // One name for the cluster of seven discharge ports, rather than seven overlapping ones.
      { name: translate(lang, "India east coast · {n} ports", { n: Object.keys(data.ports).length }), at: toVec(90.5, 17), kind: "discharge" as const, label: true, noDot: true },
    ];
    // India's east coast, where every route ends, with the Indian Ocean round it.
    return { markers, centre: toVec(88, 12) };
  }, [data, lang]);
  if (!data || !layout) return <div style={{ height }}><Skeleton className="h-full w-full" /></div>;
  const label = t("Sea routes from {n} load ports to {m} discharge ports on India's east coast.", {
    n: Object.keys(data.load_ports).length,
    m: Object.keys(data.ports).length,
  });
  const routes = data.routes.map((r) => ({ coords: r.coords, highlight: r.port === "Paradip" }));
  if (!threeD)
    return (
      <FlatMap
        routes={routes}
        points={[
          ...Object.entries(data.load_ports).map(([o, p]) => ({ ...p, kind: "load" as const, name: shortOrigin(o) })),
          ...Object.values(data.ports).map((p) => ({ ...p, kind: "discharge" as const })),
        ]}
        box={[-85, 160, -45, 68]}
        label={label}
      />
    );
  return (
    <Suspense fallback={<div style={{ height }}><Skeleton className="h-full w-full" /></div>}>
      <GlobeScene
        routes={routes}
        markers={layout.markers}
        centre={layout.centre}
        distance="fit"
        focusKey="coverage"
        height={height}
        animate={!prefersReducedMotion()}
        label={label}
      />
    </Suspense>
  );
}
