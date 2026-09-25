import type { MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

export type LandPolygons = [number, number][][][];

let cache: Promise<LandPolygons> | null = null;

/**
 * The world's coastlines (Natural Earth 1:110m via world-atlas, public domain /
 * ISC), as polygons of [lon, lat] rings. Loaded once, only when a map is shown.
 */
export function loadLand(): Promise<LandPolygons> {
  cache ??= import("world-atlas/land-110m.json").then((m) => {
    const topo = m.default as unknown as Topology<{ land: GeometryCollection }>;
    const fc = feature(topo, topo.objects.land);
    const polygons: LandPolygons = [];
    for (const f of fc.features) {
      const g = f.geometry as Polygon | MultiPolygon;
      if (g.type === "Polygon") polygons.push(g.coordinates as [number, number][][]);
      else if (g.type === "MultiPolygon") polygons.push(...(g.coordinates as [number, number][][][]));
    }
    return polygons;
  });
  return cache;
}
