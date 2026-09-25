/**
 * Geography for the voyage globe and its flat fallback: positions on a
 * sphere, great-circle distances along a route, where a ship is after a share
 * of the voyage, and which sea that is. Plain numbers, no three.js.
 */

export const EARTH_RADIUS_NM = 3440.065;

export type Vec3 = [number, number, number];

/**
 * A longitude/latitude on a sphere of radius r, matching three.js's
 * SphereGeometry UVs, so an equirectangular map lines up with the points.
 */
export function toVec(lon: number, lat: number, r = 1): Vec3 {
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return [-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta)];
}

export function toLonLat([x, y, z]: Vec3): [number, number] {
  const r = Math.hypot(x, y, z);
  const lat = 90 - (Math.acos(y / r) * 180) / Math.PI;
  let lon = (Math.atan2(z, -x) * 180) / Math.PI - 180;
  if (lon < -180) lon += 360;
  return [lon, lat];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Angle between two unit vectors, radians. */
export function angle(a: Vec3, b: Vec3) {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
}

/** Spherical interpolation between two unit vectors. */
export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const w = angle(a, b);
  if (w < 1e-6) return a;
  const s = Math.sin(w);
  const k1 = Math.sin((1 - t) * w) / s;
  const k2 = Math.sin(t * w) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}

/** A route's points as unit vectors, with great-circle points added so no leg is longer than `maxDeg`. */
export function densify(coords: [number, number][], maxDeg = 2): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < coords.length; i++) {
    const b = toVec(coords[i][0], coords[i][1]);
    if (i > 0) {
      const a = out[out.length - 1];
      const steps = Math.ceil((angle(a, b) * 180) / Math.PI / maxDeg);
      for (let k = 1; k < steps; k++) out.push(slerp(a, b, k / steps));
    }
    out.push(b);
  }
  return out;
}

/** Cumulative great-circle distance along points, nautical miles. */
export function cumulative(points: Vec3[]) {
  const d = [0];
  for (let i = 1; i < points.length; i++) d.push(d[i - 1] + angle(points[i - 1], points[i]) * EARTH_RADIUS_NM);
  return d;
}

/** Where the ship is after `fraction` of the distance, and the next point it heads for. */
export function pointAlong(points: Vec3[], cum: number[], fraction: number): { at: Vec3; ahead: Vec3 } {
  const total = cum[cum.length - 1];
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const leg = cum[i] - cum[i - 1] || 1;
  const at = norm(slerp(points[i - 1], points[i], (target - cum[i - 1]) / leg));
  return { at, ahead: points[Math.min(points.length - 1, i)] };
}

/** Centre and angular radius (radians) of a set of unit vectors, for framing a camera. */
export function extent(points: Vec3[]) {
  const c = norm(points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]));
  return { centre: c, radius: Math.max(...points.map((p) => angle(c, p))) };
}

// Seas and straits on the routes to India's east coast, most specific first:
// [name, lonMin, lonMax, latMin, latMax].
const SEAS: [string, number, number, number, number][] = [
  ["Singapore Strait", 103, 104.8, 0.8, 1.6],
  ["Strait of Malacca", 95.5, 103.5, 0.5, 7],
  ["Suez Canal", 32, 33, 29.8, 31.4],
  ["Bab-el-Mandeb", 42.5, 44, 12, 13.5],
  ["Strait of Gibraltar", -6.5, -5, 35.5, 36.3],
  ["Torres Strait", 141, 144, -11, -9],
  ["Lombok Strait", 115.5, 116.1, -9, -8],
  ["Makassar Strait", 116, 120, -5, 2],
  ["Palk Strait", 79, 80.5, 9, 10.5],
  ["Red Sea", 32, 43, 12.5, 30],
  ["Gulf of Aden", 43, 52, 10, 15],
  ["Baltic Sea", 10, 30.5, 53, 66],
  ["North Sea", -4, 10, 50.5, 62],
  ["English Channel", -6, 2, 48.5, 51.2],
  ["Mediterranean Sea", -6, 36, 30, 46],
  ["Bay of Bengal", 79, 95, 5, 23],
  ["Arabian Sea", 50, 77.5, 5, 25],
  ["Mozambique Channel", 34, 45, -26, -11],
  ["Java Sea", 105, 117, -8, -3],
  ["South China Sea", 104, 121, 0, 23],
  ["Celebes Sea", 118, 126, 1, 7],
  ["Sulu Sea", 118, 123, 6, 12],
  ["East China Sea", 120, 131, 24, 34],
  ["Sea of Japan", 127, 142, 34, 52],
  ["Philippine Sea", 121, 140, 5, 30],
  ["Timor Sea", 122, 130, -14, -8],
  ["Arafura Sea", 130, 141, -11, -5],
  ["Coral Sea", 142, 165, -30, -9],
  ["Indian Ocean", 20, 120, -60, 25],
  ["Atlantic Ocean", -80, 20, -60, 70],
  ["Pacific Ocean", -180, 180, -60, 70],
];

/** The sea a point is in, e.g. "Bay of Bengal". */
export function seaName(lon: number, lat: number) {
  for (const [name, x0, x1, y0, y1] of SEAS) if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) return name;
  return "open sea";
}

type Ring = [number, number][];

/**
 * Draws land polygons on an equirectangular canvas (x from lon -180..180,
 * y from lat 90..-90). Rings that cross the date line are unwrapped and drawn
 * three times, shifted by the map width, so nothing streaks across the map.
 */
export function drawLand(ctx: CanvasRenderingContext2D, polygons: Ring[][], w: number, h: number) {
  const x = (lon: number) => ((lon + 180) / 360) * w;
  const y = (lat: number) => ((90 - lat) / 180) * h;
  for (const shift of [0, -w, w]) {
    ctx.beginPath();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        let prev = ring[0][0];
        let offset = 0;
        ring.forEach(([lon, lat], i) => {
          if (i > 0 && Math.abs(lon - prev) > 180) offset += lon < prev ? 360 : -360;
          prev = lon;
          const px = x(lon + offset) + shift;
          if (i === 0) ctx.moveTo(px, y(lat));
          else ctx.lineTo(px, y(lat));
        });
        ctx.closePath();
      }
    }
    ctx.fill("evenodd");
    ctx.stroke();
  }
}
