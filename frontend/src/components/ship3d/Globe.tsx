import { OrbitControls, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useStage } from "./quality";
import { type ShipColors, useShipColors } from "./colors";
import { type Vec3, densify } from "./geo";
import { Label } from "./Label";
import { asset } from "./materials";
import { Stage } from "./ShipStage";

const R = 100;

export interface GlobeRoute {
  coords: [number, number][];
  highlight?: boolean;
}

export interface GlobeMarker {
  name: string;
  at: Vec3;
  kind: "load" | "discharge";
  /** Draw the name next to the marker. */
  label?: boolean;
  /** Leave out the dot (a label for a group of markers). */
  noDot?: boolean;
}

/** The Earth maps (NASA Blue Marble and Black Marble, public domain; three.js normal, specular and clouds, MIT). */
function useEarthMaps() {
  const maps = useTexture({
    day: asset("earth-day-4k.jpg"),
    night: asset("earth-night-2k.jpg"),
    normal: asset("earth-normal-2k.jpg"),
    specular: asset("earth-specular-2k.jpg"),
    clouds: asset("earth-clouds-1k.jpg"),
  }) as unknown as Record<"day" | "night" | "normal" | "specular" | "clouds", THREE.Texture>;
  return useMemo(() => {
    for (const [k, t] of Object.entries(maps)) {
      t.colorSpace = k === "day" || k === "night" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    return maps;
  }, [maps]);
}

// The sun stays off the viewer's left shoulder: the side you look at is in daylight, with the
// night side's city lights round the right-hand limb.
const SUN_OFFSET = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1.05);

function followSun(sun: THREE.Vector3, camera: THREE.Camera) {
  sun.copy(camera.position).normalize().applyQuaternion(SUN_OFFSET);
  sun.y += 0.25;
  sun.normalize();
}

/**
 * The Earth: the Blue Marble by day (with relief from the normal map and the
 * sun's glint on the sea only), city lights on the night side, and drifting
 * clouds that cast a faint shadow.
 */
function Earth({ animate }: { animate: boolean }) {
  const maps = useEarthMaps();
  const sun = useMemo(() => new THREE.Vector3(1, 0.3, 0), []);
  const light = useRef<THREE.DirectionalLight>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const { material, uniforms } = useMemo(() => {
    const u = { uNight: { value: maps.night }, uSpec: { value: maps.specular }, uClouds: { value: maps.clouds }, uSun: { value: sun }, uCloudShift: { value: 0 } };
    const m = new THREE.MeshStandardMaterial({ map: maps.day, normalMap: maps.normal, normalScale: new THREE.Vector2(0.85, 0.85), roughness: 0.85, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vEarthUv;\nvarying vec3 vEarthN;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvEarthUv = uv;\nvEarthN = normalize(mat3(modelMatrix) * normal);");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec2 vEarthUv;\nvarying vec3 vEarthN;\nuniform sampler2D uNight, uSpec, uClouds;\nuniform vec3 uSun;\nuniform float uCloudShift;"
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
float earthSea = texture2D(uSpec, vEarthUv).r;
roughnessFactor = mix(0.92, 0.32, earthSea);`
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
{
  float ndl = dot(normalize(vEarthN), normalize(uSun));
  // City lights come up through dusk and are full on the night side.
  float dark = 1.0 - smoothstep(-0.18, 0.12, ndl);
  // Only the lights themselves: the Black Marble's dim land and sea stay dark.
  vec3 lights = max(texture2D(uNight, vEarthUv).rgb - 0.14, 0.0) / 0.86;
  float glow = dot(lights, vec3(0.3, 0.55, 0.15));
  totalEmissiveRadiance += vec3(1.0, 0.74, 0.42) * pow(glow, 1.3) * dark * 2.2;
}`
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
{
  // Cloud shadows: the cloud layer's density, shifted a little away from the sun.
  float cl = texture2D(uClouds, vEarthUv + vec2(uCloudShift - 0.0015, 0.001)).r;
  diffuseColor.rgb *= 1.0 - cl * 0.35;
}`
        );
    };
    m.customProgramCacheKey = () => "fw-earth-v2";
    return { material: m, uniforms: u };
  }, [maps, sun]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera, clock }) => {
    followSun(sun, camera);
    light.current?.position.copy(sun).multiplyScalar(R * 10);
    if (clouds.current && animate) {
      const turn = clock.elapsedTime * 0.004;
      clouds.current.rotation.y = turn;
      setCloudShift(uniforms, turn / (Math.PI * 2));
    }
  });
  return (
    <group>
      <directionalLight ref={light} intensity={2.4} color="#fff6ea" />
      <ambientLight intensity={0.05} />
      <mesh material={material}>
        <sphereGeometry args={[R, 192, 128]} />
      </mesh>
      <mesh ref={clouds} scale={1.008}>
        <sphereGeometry args={[R, 128, 96]} />
        <meshStandardMaterial alphaMap={maps.clouds} color="#ffffff" transparent opacity={0.5} depthWrite={false} roughness={1} />
      </mesh>
      <Atmosphere sun={sun} />
    </group>
  );
}

function setCloudShift(u: { uCloudShift: { value: number } }, v: number) {
  u.uCloudShift.value = -v;
}

/** The atmosphere: a glow round the limb, blue on the day side, fading into the night. */
function Atmosphere({ sun }: { sun: THREE.Vector3 }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: sun } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying vec3 vW;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            vW = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uSun; varying vec3 vN; varying vec3 vV; varying vec3 vW;
          void main() {
            float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
            float lit = smoothstep(-0.35, 0.45, dot(vW, normalize(uSun)));
            vec3 col = mix(vec3(0.18, 0.32, 0.62), vec3(0.42, 0.7, 1.0), lit);
            gl_FragColor = vec4(col, rim * (0.25 + 0.75 * lit) * 0.9);
          }`,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [sun]
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} scale={1.045}>
      <sphereGeometry args={[R, 96, 64]} />
    </mesh>
  );
}

const ROUTE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // How squarely this bit of the tube faces the viewer: 1 along its centre line, 0 at its edges.
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const ROUTE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uLength, uOpacity, uFlow, uGlow;
varying vec2 vUv;
varying float vFacing;
void main() {
  // Comets running along the route towards the destination, one every ~55 route units:
  // a bright head with a tail fading behind it.
  float s = fract(vUv.x * uLength / 55.0 - uTime * 0.28);
  float comet = pow(s, 10.0) * uFlow;
  float edge = uGlow > 0.5 ? pow(vFacing, 2.6) : smoothstep(0.0, 0.55, vFacing);
  vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), comet * 0.75) * (1.0 + comet * 1.6);
  float a = clamp(uOpacity * edge * (1.0 + comet * (uGlow > 0.5 ? 2.5 : 0.4)), 0.0, 1.0);
  // The glow is max-blended (premultiplied), so routes sharing a lane don't pile up into white.
  gl_FragColor = uGlow > 0.5 ? vec4(col * a, a) : vec4(col, a);
  #include <colorspace_fragment>
}`;

/**
 * A sea route: a slender line along the real shipping lanes, lifted just clear
 * of the clouds, in a soft glow, with comets of light running towards the
 * discharge port. Dimmer and finer when it isn't the route in focus.
 */
function RouteTube({ coords, color, highlight, animate }: { coords: [number, number][]; color: string; highlight: boolean; animate: boolean }) {
  const { core, halo, length } = useMemo(() => {
    const pts = densify(coords, 1).map((p) => new THREE.Vector3(...p).multiplyScalar(R * 1.012));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    const segments = Math.max(64, pts.length * 5);
    return {
      core: new THREE.TubeGeometry(curve, segments, highlight ? 0.2 : 0.11, 10, false),
      halo: new THREE.TubeGeometry(curve, segments, highlight ? 0.95 : 0.42, 12, false),
      length: curve.getLength(),
    };
  }, [coords, highlight]);
  const mats = useMemo(() => {
    const make = (opacity: number, flow: number, glow: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: ROUTE_VERT,
        fragmentShader: ROUTE_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uTime: { value: 0 },
          uLength: { value: length },
          uOpacity: { value: opacity },
          uFlow: { value: flow },
          uGlow: { value: glow ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
        ...(glow ? { blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation } : { blending: THREE.NormalBlending }),
      });
    return { core: make(highlight ? 1 : 0.7, highlight ? 1 : 0.45, false), halo: make(highlight ? 0.32 : 0.12, highlight ? 1 : 0.4, true) };
  }, [color, length, highlight]);
  useEffect(
    () => () => {
      core.dispose();
      halo.dispose();
      mats.core.dispose();
      mats.halo.dispose();
    },
    [core, halo, mats]
  );
  useFrame(({ clock }) => {
    if (animate) setRouteTime(mats, clock.elapsedTime);
  });
  return (
    <group>
      <mesh geometry={halo} material={mats.halo} renderOrder={2} />
      {/* The route in focus draws over the others where they share a lane. */}
      <mesh geometry={core} material={mats.core} renderOrder={highlight ? 4 : 3} />
    </group>
  );
}

function setRouteTime(m: { core: THREE.ShaderMaterial; halo: THREE.ShaderMaterial }, t: number) {
  m.core.uniforms.uTime.value = t;
  m.halo.uniforms.uTime.value = t;
}

/** Shows its children only while their point faces the camera (labels on the far side hide). */
function Facing({ at, children }: { at: Vec3; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const normal = useMemo(() => new THREE.Vector3(...at).normalize(), [at]);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (ref.current) ref.current.visible = normal.dot(dir.copy(camera.position).normalize()) > 0.2;
  });
  return <group ref={ref}>{children}</group>;
}

function Marker({ marker, colors, labelSize }: { marker: GlobeMarker; colors: ShipColors; labelSize: number }) {
  const p = useMemo(() => new THREE.Vector3(...marker.at).multiplyScalar(R * 1.016), [marker.at]);
  const color = marker.kind === "load" ? colors.signal : colors.accent;
  return (
    <Facing at={marker.at}>
      {!marker.noDot && (
        <mesh position={p}>
          <sphereGeometry args={[marker.label ? 1.0 : 0.7, 16, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      )}
      {marker.label && (
        <Label text={marker.name} position={p.clone().multiplyScalar(1.05).toArray() as Vec3} color={colors.label} background={colors.labelBackground} height={labelSize} />
      )}
    </Facing>
  );
}

/** The ship on its route: a small hull pointing along the way ahead, with a ring round it. */
function ShipMarker({ at, ahead, colors }: { at: Vec3; ahead: Vec3; colors: ShipColors }) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const p = new THREE.Vector3(...at).multiplyScalar(R * 1.02);
    g.position.copy(p);
    g.up.copy(p.clone().normalize());
    g.lookAt(new THREE.Vector3(...ahead).multiplyScalar(R * 1.02));
  }, [at, ahead]);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 2.5));
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[1.1, 0.6, 3.4]} />
        <meshBasicMaterial color={colors.label} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.4, 2]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.55, 1.1, 4]} />
        <meshBasicMaterial color={colors.label} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.6, 3.1, 40]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.7} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Eases the camera to look at `centre` from `distance` globe radii whenever the focus changes. */
function GlobeCamera({ centre, distance, focusKey, animate }: { centre: Vec3; distance: number | "fit"; focusKey: string; animate: boolean }) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const invalidate = useStage().kick;
  const goal = useRef<{ to: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    const camera = get().camera as THREE.PerspectiveCamera;
    // "fit": the whole Earth, its disc (with the atmosphere) filling most of the shorter side.
    const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * (size.width / Math.max(1, size.height)));
    const fit = 1.05 / Math.sin(0.94 * Math.min(halfV, halfH));
    const d = distance === "fit" ? fit : distance;
    goal.current = { to: new THREE.Vector3(...centre).normalize().multiplyScalar(R * d), t: animate ? 0 : 1 };
    invalidate();
    // A new focus key (or canvas size) moves the camera; the same focus recomputed doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, animate, invalidate, size.width, size.height]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g) return;
    const { camera, controls } = get();
    g.t = Math.min(1, g.t + dt / 1.2);
    const k = g.t >= 1 ? 1 : 1 - (1 - g.t) ** 3;
    // Swing round the globe rather than through it: interpolate direction and distance separately.
    const from = camera.position.clone();
    const dir = from.clone().normalize().lerp(g.to.clone().normalize(), k).normalize();
    const len = THREE.MathUtils.lerp(from.length(), g.to.length(), k);
    camera.position.copy(dir.multiplyScalar(len));
    camera.lookAt(0, 0, 0);
    (controls as unknown as { update?: () => void } | null)?.update?.();
    if (g.t >= 1) goal.current = null;
    else invalidate();
  });
  return null;
}

/** Drag to turn, wheel or pinch to zoom, on the view's own box; moving draws at full rate. */
function GlobeControls() {
  const { el, kick } = useStage();
  if (!el) return null;
  return (
    <OrbitControls
      makeDefault
      domElement={el}
      enablePan={false}
      enableZoom
      zoomSpeed={1.1}
      rotateSpeed={0.45}
      minDistance={R * 1.25}
      maxDistance={R * 6}
      onStart={() => kick(1500)}
      onChange={() => kick(1500)}
      onEnd={() => kick(1500)}
    />
  );
}

/** A faint starfield far behind the globe (dark theme). */
function Stars({ count = 2400 }: { count?: number }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const shade = new Float32Array(count * 3);
    // A fixed pseudo-random sky, the same on every visit.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * 3000;
      positions.set([Math.cos(a) * r, u * 3000, Math.sin(a) * r], i * 3);
      const b = 0.35 + rand() * rand() * 0.65;
      shade.set([b, b, b * (0.9 + rand() * 0.15)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(shade, 3));
    return g;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry}>
      <pointsMaterial size={1.6} sizeAttenuation={false} vertexColors transparent opacity={0.85} depthWrite={false} toneMapped={false} />
    </points>
  );
}

/**
 * A globe with sea routes: the voyage's route highlighted (or every route
 * dimmed), port markers, and optionally the ship part-way along, against a
 * space backdrop. Drag to turn it; scroll, pinch or the + and − buttons zoom.
 */
export function GlobeScene({
  routes,
  markers,
  ship,
  centre,
  distance,
  focusKey,
  height = 360,
  animate = true,
  label,
}: {
  routes: GlobeRoute[];
  markers: GlobeMarker[];
  ship?: { at: Vec3; ahead: Vec3 };
  centre: Vec3;
  /** Camera distance in globe radii, or "fit" to show the whole Earth. */
  distance: number | "fit";
  focusKey: string;
  height?: number | string;
  animate?: boolean;
  label?: string;
}) {
  const colors = useShipColors();
  // Deep space in the dark theme, a pale sky-haze in the light one.
  const background = colors.dark
    ? "radial-gradient(ellipse 70% 80% at 50% 50%, #142a45 0%, #0a1422 42%, #04070c 100%)"
    : "radial-gradient(ellipse 70% 80% at 50% 50%, #1c3350 0%, #0e1c2e 48%, #070d16 100%)";
  return (
    <Stage animated={animate} height={height} label={label} background={background} post={false}>
      <Stars />
      <Earth animate={animate} />
      {routes.map((r, i) => (
        <RouteTube key={i} coords={r.coords} color={r.highlight ? "#ffb04a" : "#8ec5ff"} highlight={!!r.highlight} animate={animate} />
      ))}
      {markers.map((m) => (
        <Marker key={`${m.kind}:${m.name}`} marker={m} colors={colors} labelSize={distance === "fit" ? 6.5 : 3.6} />
      ))}
      {ship && <ShipMarker at={ship.at} ahead={ship.ahead} colors={colors} />}
      <GlobeCamera centre={centre} distance={distance} focusKey={focusKey} animate={animate} />
      <GlobeControls />
    </Stage>
  );
}
