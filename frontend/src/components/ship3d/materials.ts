import { useTexture } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { type HullForm, type ShipSpec, deckHeight, hullForm } from "./hull";
import { PAINT } from "./paint";

export { PAINT };

const BASE = import.meta.env.BASE_URL;
export const asset = (name: string) => `${BASE}3d/${name}`;

/** Small value noise, shared by the paint shaders for weathering. */
const NOISE_GLSL = /* glsl */ `
float fwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fwHash(i), fwHash(i + vec2(1.0, 0.0)), u.x), mix(fwHash(i + vec2(0.0, 1.0)), fwHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Tri-planar sampling of the painted-steel scan (colour, normal, roughness):
 * each surface takes the texture projected along the axis it faces, so boxes,
 * extrusions and the hull all get paint chips, dents and rust spots at a true
 * scale without UVs. Coordinates are the part's own (not the world's), so the
 * paint doesn't slide over a ship as it rolls.
 */
const TRIPLANAR_GLSL = /* glsl */ `
uniform sampler2D uSteelC, uSteelN, uSteelR;
uniform float uDetail;
vec3 fwTriW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec4 fwTri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
vec3 fwTriNormal(vec3 p, vec3 n, vec3 w, float k) {
  vec3 tx = texture2D(uSteelN, p.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(uSteelN, p.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(uSteelN, p.xy).xyz * 2.0 - 1.0;
  vec3 d = vec3(0.0, tx.y, tx.x) * w.x + vec3(ty.x, 0.0, ty.y) * w.y + vec3(tz.x, tz.y, 0.0) * w.z;
  return normalize(n + d * k);
}
`;

export interface SteelMaps {
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

/** The painted-steel PBR scan (ambientCG PaintedMetal012, CC0). Suspends until loaded. */
export function useSteelMaps(): SteelMaps {
  return useTexture(
    { color: asset("painted-steel-color.jpg"), normal: asset("painted-steel-normal.jpg"), roughness: asset("painted-steel-roughness.jpg") },
    (maps) => {
      for (const [key, t] of Object.entries(maps as Record<string, THREE.Texture>)) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        t.colorSpace = key === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      }
    }
  ) as unknown as SteelMaps;
}

function steelUniforms(maps: SteelMaps, detail: number) {
  return {
    uSteelC: { value: maps.color },
    uSteelN: { value: maps.normal },
    uSteelR: { value: maps.roughness },
    uDetail: { value: detail },
  };
}

/**
 * Paint with weathering, for decks, covers, superstructure and cargo gear:
 * blotches and grime from noise, plus the painted-steel scan's chips, rust
 * spots, dents and roughness, fading out with distance so far surfaces
 * don't shimmer. `scale` is texture tiles per metre.
 */
export function weatheredMaterial(
  color: string,
  opts: { roughness?: number; metalness?: number; scale?: number; weather?: number } = {},
  maps?: SteelMaps
) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.05 });
  const scale = opts.scale ?? 0.6;
  const weather = opts.weather ?? 1;
  material.onBeforeCompile = (shader) => {
    if (maps) Object.assign(shader.uniforms, steelUniforms(maps, weather));
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjP;\nvarying vec3 vWorldP;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
{
  vec4 op = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  op = instanceMatrix * op;
  #endif
  vObjP = op.xyz;
  vWorldP = (modelMatrix * op).xyz;
}`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vObjP;\nvarying vec3 vWorldP;\n${NOISE_GLSL}\n${maps ? TRIPLANAR_GLSL : ""}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
diffuseColor.rgb *= 0.9 + 0.16 * fwNoise(vObjP.xz * ${scale.toFixed(3)} + vObjP.y * 0.3);
${
  maps
    ? `float fwNear = 1.0 - smoothstep(40.0, 320.0, distance(cameraPosition, vWorldP));
vec3 fwP = vObjP * 0.45;
vec3 fwW = fwTriW(normalize(cross(dFdx(vObjP), dFdy(vObjP))));
vec3 fwSteel = fwTri(uSteelC, fwP, fwW).rgb;
float fwLum = dot(fwSteel, vec3(0.299, 0.587, 0.114));
float fwRustSpot = clamp((fwSteel.r - fwSteel.b) * 2.2 - 0.15, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, clamp(fwLum / 0.72, 0.7, 1.12), 0.55 * uDetail * fwNear);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.16, 0.08), fwRustSpot * 0.45 * uDetail * fwNear);`
    : ""
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
${maps ? "roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.55 + 0.9 * fwTri(uSteelR, fwP, fwW).g, uDetail * fwNear), 0.04, 1.0);" : ""}`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
${
  maps
    ? `{
  vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  // Object-space axes for the projection: the dominant axis of the face.
  wn = fwTriNormal(fwP, wn, fwW, 0.55 * uDetail * fwNear);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`
    : ""
}`
      );
  };
  material.customProgramCacheKey = () => `fw-weathered-${scale}-${maps ? "pbr" : "flat"}`;
  return material;
}

/** Shared paint materials for every ship (one shader program each, built once). */
const paintCache = new Map<string, ReturnType<typeof buildPaint>>();

function buildPaint(maps: SteelMaps) {
  return {
    deck: weatheredMaterial(PAINT.deck, { roughness: 0.85, scale: 0.4 }, maps),
    coaming: weatheredMaterial(PAINT.hatch, { roughness: 0.7, scale: 0.9 }, maps),
    cover: weatheredMaterial(PAINT.hatch, { roughness: 0.62, scale: 0.5 }, maps),
    white: weatheredMaterial(PAINT.superstructure, { roughness: 0.55, scale: 0.8, weather: 0.8 }, maps),
    crane: weatheredMaterial(PAINT.crane, { roughness: 0.5, scale: 1.2 }, maps),
    steel: weatheredMaterial(PAINT.darkSteel, { roughness: 0.6, metalness: 0.3, scale: 1.5 }, maps),
    topsides: weatheredMaterial(PAINT.topsides, { roughness: 0.6, scale: 0.8 }, maps),
    orange: weatheredMaterial(PAINT.lifeboat, { roughness: 0.45, scale: 1.5, weather: 0.4 }, maps),
    frame: weatheredMaterial("#b9c0c6", { roughness: 0.55, metalness: 0.2, scale: 1.4 }, maps),
    blue: weatheredMaterial("#2f5f9e", { roughness: 0.5, scale: 1.2 }, maps),
  };
}

export type Paint = ReturnType<typeof buildPaint>;

/** The shared paint set, once the steel scan has loaded (suspends until then). */
export function usePaint(): Paint {
  const maps = useSteelMaps();
  return useMemo(() => {
    const key = maps.normal.uuid;
    if (!paintCache.has(key)) paintCache.set(key, buildPaint(maps));
    return paintCache.get(key)!;
  }, [maps]);
}

/** Canvas atlas of the draft-mark glyphs 0-9 and M, white on clear. */
function glyphAtlas() {
  const w = 64;
  const h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w * 11;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${h * 1.02}px "Source Sans 3 Variable", "Arial Narrow", Arial, sans-serif`;
  "0123456789M".split("").forEach((c, i) => ctx.fillText(c, w * i + w / 2, h * 0.97, w * 0.92));
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let glyphs: THREE.Texture | null = null;
function sharedGlyphs() {
  if (!glyphs) glyphs = glyphAtlas();
  return glyphs;
}

/** White lettering on clear: one line (the bow name) or two (the stern: name over port of registry). */
export function nameTexture(text: string, second?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = second ? 256 : 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 100px "Source Sans 3 Variable", Arial, sans-serif`;
  ctx.fillText(text.toUpperCase(), 512, 68, 1000);
  if (second) {
    ctx.font = `600 72px "Source Sans 3 Variable", Arial, sans-serif`;
    ctx.fillText(second.toUpperCase(), 512, 188, 700);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Port of registry painted on the stern under the name. */
export const PORT_OF_REGISTRY = "Mumbai";

/**
 * Hull shell paint: topsides and antifouling split at the summer draft,
 * weathering streaks, and the markings every ship carries, drawn in the
 * shader so they stay sharp at any zoom:
 * - draft marks at the stern, amidships and bow: metric figures 10 cm high
 *   every 20 cm, with "M" at each whole metre;
 * - the load line mark amidships: deck line, the 300 mm disc with its 450 mm
 *   bar at the summer draft, and the load lines (S, W, T, F, TF);
 * - the ship's name on each bow, and on the transom over the port of registry;
 * - welded plating: strakes about 2.6 m high and butts every 11.5 m, as fine
 *   raised seams; rust run-off below the hawse pipes and the deck scuppers;
 *   a band of weed at the waterline.
 */
export function hullMaterial(spec: ShipSpec, name: THREE.Texture, stern: THREE.Texture, maps?: SteelMaps, waterNormals?: THREE.Texture) {
  const f: HullForm = hullForm(spec);
  const displacement = (spec.payload_tonnes ?? 0) / 0.84;
  // Fresh water allowance: displacement / (4 x TPC), in mm.
  const fwa = spec.tpc ? displacement / (4 * spec.tpc) / 1000 : f.T / 48;
  const material = new THREE.MeshStandardMaterial({ color: PAINT.topsides, roughness: 0.58, metalness: 0.08 });
  const sternDeck = deckHeight(f, 0);
  const uniforms = {
    uSplit: { value: f.T + 0.05 },
    uTop: { value: new THREE.Color(PAINT.topsides) },
    uBottom: { value: new THREE.Color(PAINT.bottom) },
    uRust: { value: new THREE.Color(PAINT.rust) },
    uGlyphs: { value: sharedGlyphs() },
    uMarkX: { value: new THREE.Vector3(f.rudder.x + 1.5, f.L / 2 - 6, f.L - f.stemRakeAbove - 2.5) },
    uLoadLine: { value: new THREE.Vector4(f.L / 2, f.T, deckHeight(f, f.L / 2), f.T / 48) },
    uFwa: { value: fwa },
    uName: { value: name },
    uNameBox: { value: new THREE.Vector4(0.905 * f.L, deckHeight(f, 0.905 * f.L) - 1.9, Math.min(26, 0.1 * f.L), 3.2) },
    uStern: { value: stern },
    uSternBox: { value: new THREE.Vector4(0, sternDeck - 3.4, Math.min(18, f.B * 0.52), 4.2) },
    uHawse: { value: new THREE.Vector2(0.94 * f.L, deckHeight(f, 0.94 * f.L) - 3.2) },
    uDeckY: { value: f.D },
    uWaterN: { value: waterNormals ?? null },
    uTime: { value: 0 },
    ...(maps ? steelUniforms(maps, 0.7) : {}),
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;\nvarying vec3 vLocalN;\nvarying vec3 vWorldP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;\nvLocalN = normal;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vWorldP;
uniform float uSplit;
uniform vec3 uTop, uBottom, uRust;
uniform sampler2D uGlyphs;
uniform vec3 uMarkX;
uniform vec4 uLoadLine;
uniform float uFwa;
uniform sampler2D uName;
uniform vec4 uNameBox;
uniform sampler2D uStern;
uniform vec4 uSternBox;
uniform vec2 uHawse;
uniform float uDeckY;
uniform sampler2D uWaterN;
uniform float uTime;
${NOISE_GLSL}
${maps ? TRIPLANAR_GLSL : ""}
float fwGlyph(float code, vec2 g) {
  if (g.x < 0.0 || g.x > 1.0 || g.y < 0.0 || g.y > 1.0) return 0.0;
  return texture2D(uGlyphs, vec2((code + 0.08 + g.x * 0.84) / 11.0, g.y)).a;
}
// Metric draft marks: 10 cm figures every 20 cm, "M" at each metre.
float fwDraftMarks(vec3 p, float side) {
  float a = 0.0;
  for (int k = 0; k < 3; k++) {
    float u = (p.x - uMarkX[k]) * side;
    if (u < 0.0 || u > 0.26 || p.y < 1.0) continue;
    float n = floor(p.y / 0.2 + 1e-4);
    float fy = (p.y - n * 0.2) / 0.1;
    if (fy > 1.0) continue;
    float metres = floor(n / 5.0 + 1e-4);
    float sub = n - metres * 5.0;
    float gw = 0.075;
    float gi = floor(u / gw);
    vec2 g = vec2(fract(u / gw), fy);
    float code = -1.0;
    if (sub < 0.5) {
      float tens = floor(metres / 10.0 + 1e-4);
      float ones = metres - tens * 10.0;
      if (tens > 0.5) code = gi < 0.5 ? tens : gi < 1.5 ? ones : gi < 2.5 ? 10.0 : -1.0;
      else code = gi < 0.5 ? ones : gi < 1.5 ? 10.0 : -1.0;
    } else if (gi < 0.5) {
      code = sub * 2.0;
    }
    if (code >= 0.0) a = max(a, fwGlyph(code, g));
  }
  return a;
}
float fwBox(vec2 p, vec2 lo, vec2 hi) { return step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y); }
// Load line mark (Load Lines Convention): lines 25 mm thick.
float fwLoadLine(vec3 p, float side) {
  vec2 q = vec2((p.x - uLoadLine.x) * side, p.y - uLoadLine.y);
  if (abs(q.x) > 1.2 || q.y < -1.0 || p.y > uLoadLine.z + 0.1) return 0.0;
  float t = 0.025;
  float r = length(q);
  float m = step(0.15 - t, r) * step(r, 0.15);
  m = max(m, fwBox(q, vec2(-0.225, -t * 0.5), vec2(0.225, t * 0.5)));
  // Deck line, its top edge at the deck.
  m = max(m, fwBox(vec2(q.x, p.y - uLoadLine.z), vec2(-0.15, -t), vec2(0.15, 0.0)));
  // Load lines: a vertical line 540 mm forward of the disc centre.
  float vx = 0.54;
  float s = 0.0, w = -uLoadLine.w, tr = uLoadLine.w, fr = uFwa, tf = uLoadLine.w + uFwa;
  m = max(m, fwBox(q, vec2(vx, w - t), vec2(vx + t, tf)));
  m = max(m, fwBox(q, vec2(vx, s - t), vec2(vx + 0.23, s)));
  m = max(m, fwBox(q, vec2(vx, w - t), vec2(vx + 0.23, w)));
  m = max(m, fwBox(q, vec2(vx, tr - t), vec2(vx + 0.23, tr)));
  m = max(m, fwBox(q, vec2(vx - 0.23, fr - t), vec2(vx, fr)));
  m = max(m, fwBox(q, vec2(vx - 0.23, tf - t), vec2(vx, tf)));
  return m;
}
float fwNameAt(vec3 p, float side) {
  vec2 q = vec2((p.x - uNameBox.x) * side / uNameBox.z + 0.5, (p.y - uNameBox.y) / uNameBox.w + 0.5);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
  return texture2D(uName, q).a;
}
// The transom, seen from astern: name over the port of registry.
float fwSternName(vec3 p) {
  vec2 q = vec2(p.z / uSternBox.z + 0.5, (p.y - uSternBox.y) / uSternBox.w + 0.5);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
  return texture2D(uStern, q).a;
}
// Welded plating: distance to the nearest strake seam (horizontal) and butt (vertical), metres.
float fwSeam(vec3 p) {
  float strake = abs(fract(p.y / 2.6 + 0.5) - 0.5) * 2.6;
  float butt = abs(fract(p.x / 11.5 + 0.5) - 0.5) * 11.5;
  return 1.0 - smoothstep(0.012, 0.045, min(strake, butt));
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float fwOnSide = smoothstep(0.35, 0.6, abs(vLocalN.z));
float fwNearCam = 1.0 - smoothstep(30.0, 260.0, distance(cameraPosition, vWorldP));
${maps ? "vec3 fwP = vLocal * 0.45;\nvec3 fwW = fwTriW(vLocalN);" : ""}
{
  float below = step(vLocal.y, uSplit);
  vec3 paint = mix(uTop, uBottom, below);
  // Weathering: faint vertical streaks and blotches, darker grime at the waterline.
  float streak = fwNoise(vec2(vLocal.x * 1.7 + vLocal.z * 0.3, vLocal.y * 0.06));
  float blotch = fwNoise(vLocal.xy * 0.35 + vLocal.z * 0.2);
  paint *= 0.94 + 0.1 * blotch;
  paint = mix(paint, uRust, smoothstep(0.8, 0.98, streak) * (1.0 - below) * 0.25);
  paint *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.5, abs(vLocal.y - uSplit)));
  // Weed and slime in a band at the waterline.
  float band = (1.0 - smoothstep(0.0, 0.45, abs(vLocal.y - uSplit + 0.05))) * fwNoise(vLocal.xy * vec2(0.8, 3.0));
  paint = mix(paint, vec3(0.13, 0.16, 0.09), band * 0.45);
  // Rust run-off: from the hawse pipes down the bow, and from each scupper down the side.
  float hawseDrop = uHawse.y - 1.2 - vLocal.y;
  float hawse = step(0.0, hawseDrop) * (1.0 - smoothstep(0.4, 1.3 + hawseDrop * 0.09, abs(vLocal.x - uHawse.x))) * (1.0 - smoothstep(0.0, 11.0, hawseDrop));
  float scupX = abs(fract(vLocal.x / 7.5) - 0.5) * 7.5;
  float scupDrop = uDeckY - 0.5 - vLocal.y;
  float scupper = step(0.0, scupDrop) * (1.0 - smoothstep(0.06, 0.28, scupX)) * (1.0 - smoothstep(0.0, 3.8, scupDrop));
  float runs = max(hawse, scupper * 0.8) * (0.55 + 0.45 * fwNoise(vec2(vLocal.x * 6.0, vLocal.y * 0.4))) * (1.0 - below);
  paint = mix(paint, uRust, runs * 0.75 * fwOnSide);
  ${
    maps
      ? `vec3 fwSteel = fwTri(uSteelC, fwP, fwW).rgb;
  float fwLum = dot(fwSteel, vec3(0.299, 0.587, 0.114));
  paint *= mix(1.0, clamp(fwLum / 0.72, 0.75, 1.1), 0.4 * fwNearCam);`
      : ""
  }
  paint *= 1.0 - 0.07 * fwSeam(vLocal) * fwOnSide;
  float side = vLocal.z >= 0.0 ? 1.0 : -1.0;
  float mark = max(max(fwDraftMarks(vLocal, side), fwLoadLine(vLocal, side)), fwNameAt(vLocal, side)) * fwOnSide;
  float onTransom = smoothstep(0.55, 0.8, -vLocalN.x);
  mark = max(mark, fwSternName(vLocal) * onTransom);
  diffuseColor.rgb = mix(paint, vec3(0.93), mark);
}`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
${
  waterNormals
    ? `if (vWorldP.y < -0.2) {
  // Caustics: sunlight focused by the waves, rippling over the hull below the waterline, fading with depth.
  vec2 cp = vec2(vWorldP.x + vWorldP.z * 0.6, vWorldP.y * 1.4);
  float ca = texture2D(uWaterN, cp * 0.06 + uTime * vec2(0.021, 0.016)).r;
  float cb = texture2D(uWaterN, cp * 0.083 - uTime * vec2(0.017, 0.024)).g;
  float caustic = pow(smoothstep(0.82, 1.0, 1.0 - abs(ca - cb) * 3.0), 4.0);
  totalEmissiveRadiance += vec3(0.3, 0.5, 0.46) * caustic * exp(vWorldP.y / 10.0) * 0.14;
}`
    : ""
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor *= 0.85 + 0.3 * fwNoise(vLocal.xy * 0.8);
${maps ? "roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.6 + 0.8 * fwTri(uSteelR, fwP, fwW).g, 0.6 * fwNearCam), 0.05, 1.0);" : ""}`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  // Weld seams raised a few millimetres: bump from the seam's screen-space slope.
  float h = fwSeam(vLocal) * fwOnSide * fwNearCam * 0.006;
  vec2 dH = vec2(dFdx(h), dFdy(h));
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
  ${
    maps
      ? `vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  wn = fwTriNormal(fwP, wn, fwW, 0.35 * fwNearCam);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`
      : ""
  }
}`
      );
  };
  material.customProgramCacheKey = () => `fw-hull-v3-${maps ? "pbr" : "flat"}-${waterNormals ? "caustics" : "plain"}`;
  return { material, uniforms };
}

/** A window cell (clear wall, dark glass with a frame) for superstructure bands. */
const windowCache = new Map<string, THREE.Texture>();
export function windowTexture(kind: "cabin" | "bridge") {
  const cached = windowCache.get(kind);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 64, 64);
  const [x, y, w, h] = kind === "bridge" ? [3, 10, 58, 40] : [16, 18, 32, 24];
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#3d5566");
  g.addColorStop(1, "#0f1a21");
  ctx.fillStyle = "#9aa3a6";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  windowCache.set(kind, t);
  return t;
}

/** Lit cabin windows at night: warm light in some windows, dark in others. */
export function litWindowTexture(kind: "cabin" | "bridge") {
  const key = `lit-${kind}`;
  const cached = windowCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const [x, y, w, h] = kind === "bridge" ? [3, 10, 58, 40] : [16, 18, 32, 24];
  // The bridge is kept dark at night (to see out); cabins glow.
  ctx.fillStyle = kind === "bridge" ? "#1c2a1f" : "#ffcf8a";
  ctx.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  windowCache.set(key, t);
  return t;
}

/** The Indian civil ensign: red, with the national flag in the upper canton. */
let ensign: THREE.Texture | null = null;
export function ensignTexture() {
  if (ensign) return ensign;
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c8201e";
  ctx.fillRect(0, 0, 192, 128);
  const cw = 96;
  const ch = 64;
  ctx.fillStyle = "#ff9933";
  ctx.fillRect(0, 0, cw, ch / 3);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, ch / 3, cw, ch / 3);
  ctx.fillStyle = "#138808";
  ctx.fillRect(0, (2 * ch) / 3, cw, ch / 3);
  ctx.strokeStyle = "#000080";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cw / 2, ch / 2, ch / 7.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cw, 0, 2, ch + 2);
  ctx.fillRect(0, ch, cw + 2, 2);
  ensign = new THREE.CanvasTexture(canvas);
  ensign.colorSpace = THREE.SRGBColorSpace;
  return ensign;
}
