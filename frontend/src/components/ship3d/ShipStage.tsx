import { OrbitControls, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Minus, Plus } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import * as THREE from "three";
import { Vector3 } from "three";
import { useShipColors } from "./colors";
import { Environment, SKY, type SkyPreset } from "./Environment";
import { type ShipSpec, arrangement } from "./hull";
import { Label } from "./Label";
import { asset } from "./materials";
import { Ocean } from "./Ocean";
import { useStage } from "./quality";
import { removeSlot, setSlot } from "./slots";
import { type Detail, Ship } from "./Ship";
import { Surroundings } from "./Surroundings";
import { type WaveTrain, seaState, shipMotion } from "./waves";

type ZoomApi = { zoom: (factor: number) => void };

/** Lets buttons outside the canvas move the camera closer or further. */
function ZoomBridge({ onReady }: { onReady: (api: ZoomApi) => void }) {
  const get = useThree((s) => s.get);
  const { kick } = useStage();
  useEffect(() => {
    onReady({
      zoom: (factor) => {
        const { camera, controls: ctl } = get();
        const controls = ctl as unknown as (OrbitLike & { minDistance: number; maxDistance: number }) | null;
        if (!controls) return;
        const offset = camera.position.clone().sub(controls.target);
        const d = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
        camera.position.copy(controls.target).add(offset.setLength(d));
        controls.update();
        kick(600);
      },
    });
  }, [onReady, get, kick]);
  return null;
}

function ZoomButtons({ api }: { api: RefObject<ZoomApi | null> }) {
  const t = useT();
  const button = "grid h-8 w-8 place-items-center bg-surface/85 text-ink-2 backdrop-blur hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div className="absolute bottom-3 right-3 z-[21] flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-rule shadow-sm print:hidden">
      <button type="button" className={button} aria-label={t("Zoom in")} title={t("Zoom in")} onClick={() => api.current?.zoom(0.75)}>
        <Plus size={16} />
      </button>
      <button type="button" className={`${button} border-t border-rule`} aria-label={t("Zoom out")} title={t("Zoom out")} onClick={() => api.current?.zoom(1.33)}>
        <Minus size={16} />
      </button>
    </div>
  );
}

/**
 * A 3D view: a box on the page that the one shared WebGL canvas
 * (SharedCanvas) draws into. The scene (children) runs in that canvas with its
 * own camera, controls and post-processing; the box keeps the accessible
 * description, a "Preparing" placeholder until the first frames are drawn,
 * and the zoom buttons.
 */
export function Stage({
  children,
  height,
  animated,
  label,
  className = "",
  zoomButtons = true,
  placeholder = true,
  onReady,
  background,
  post = true,
}: {
  /** CSS background behind a transparent view (the globe's space backdrop). */
  background?: string;
  /** Show "Preparing the 3D view" until the first frames are drawn. */
  placeholder?: boolean;
  /** Called once the scene has drawn (for callers that fade it in themselves). */
  onReady?: () => void;
  children: ReactNode;
  height: number | string;
  /** Waves and motion: redraw at the idle frame rate; otherwise only when something changes. */
  animated: boolean;
  label?: string;
  className?: string;
  zoomButtons?: boolean;
  /** Post-processing (occlusion, bloom, AgX, SMAA); off for a transparent view. */
  post?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const zoom = useRef<ZoomApi | null>(null);
  const onZoomReady = useCallback((api: ZoomApi) => {
    zoom.current = api;
  }, []);
  const [drawn, setDrawn] = useState(false);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  });
  const opts = useMemo(
    () => ({
      animated,
      post,
      onReady: () => {
        setDrawn(true);
        readyRef.current?.();
      },
    }),
    [animated, post]
  );
  // Hand the scene to the shared canvas on every render (new props reach it at once).
  useLayoutEffect(() => {
    if (!el) return;
    setSlot({
      id,
      el,
      opts,
      children: (
        <>
          <ZoomBridge onReady={onZoomReady} />
          {children}
        </>
      ),
    });
  });
  useEffect(() => () => removeSlot(id), [id]);
  return (
    <div style={{ height, background }} className={`relative w-full ${className}`}>
      {/* The picture is described for screen readers here; the zoom buttons stay outside it. */}
      <div ref={setEl} className="absolute inset-0 touch-none select-none" role={label ? "img" : undefined} aria-label={label} />
      {/* Until the first frames are drawn (shaders compiling), a quiet placeholder */}
      {placeholder && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-[21] grid place-items-center bg-sunken transition-opacity duration-500 ${drawn ? "opacity-0" : "opacity-100"}`}
        >
          <span className="animate-pulse text-[13px] text-ink-3">{t("Preparing the 3D view…")}</span>
        </div>
      )}
      {zoomButtons && <ZoomButtons api={zoom} />}
    </div>
  );
}

/** Registers a ship's waterline on the sea, for the foam round its hull. */
function useFootprint(spec: ShipSpec, at: [number, number]) {
  const { footprints } = useStage();
  const id = useId();
  const key = useMemo(() => Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)), [id]);
  const [ax, az] = at;
  useEffect(() => {
    footprints.set(key, { x: ax, z: az, halfLength: spec.loa_m / 2, halfBeam: spec.beam_m / 2 });
    return () => {
      footprints.delete(key);
    };
  }, [footprints, key, ax, az, spec.loa_m, spec.beam_m]);
}

/**
 * A ship afloat: lowered to its draft and moving with the sea under it
 * (heave, pitch and roll sampled from the same waves the ocean draws).
 */
export function Afloat({
  spec,
  draft,
  waves,
  animate,
  detail = "full",
  at = [0, 0],
  children,
  working = false,
}: {
  spec: ShipSpec;
  draft: number;
  waves: WaveTrain[];
  animate: boolean;
  detail?: Detail;
  /** Midship position on the sea (x, z). */
  at?: [number, number];
  children?: ReactNode;
  /** Alongside and discharging: hatches open, cranes working. */
  working?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  useFootprint(spec, at);
  // Eased draft, so dragging the load slider sinks or lifts the ship smoothly. Only the
  // first draft is a prop; later changes are eased in useFrame (no one-frame jump).
  const current = useRef(draft);
  const [initialDraft] = useState(draft);
  const { kick } = useStage();
  useEffect(() => kick(400), [draft, kick]);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    current.current += (draft - current.current) * Math.min(1, dt * 4);
    if (Math.abs(draft - current.current) > 0.005) kick();
    const m = shipMotion(waves, spec.loa_m, spec.beam_m, animate ? clock.elapsedTime : 0, at[0], at[1]);
    g.position.set(at[0], m.heave, at[1]);
    g.rotation.set(m.roll, 0, m.pitch);
    const hull = g.children[0];
    if (hull) hull.position.y = -current.current;
  });
  return (
    <group ref={ref}>
      <group position={[-spec.loa_m / 2, -initialDraft, 0]}>
        <Ship spec={spec} detail={detail} animate={animate} working={working} />
        {children}
      </group>
    </group>
  );
}

// Always look from the same quarter (port side, a little ahead of the beam, from above).
const VIEW_DIRECTION = new Vector3(-0.45, 0.17, 0.88).normalize();
// The landing page's view: the starboard quarter, looking towards the low sun.
const HERO_DIRECTION = new Vector3(0.5, 0.12, -0.86).normalize();

type OrbitLike = { target: Vector3; update: () => void };

/** Camera distance that fits a ship `length` long across the frame (from the quarter it looks shorter). */
function fitDistance(camera: THREE.PerspectiveCamera, size: { width: number; height: number }, length: number, height: number) {
  const aspect = size.width / Math.max(1, size.height);
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const fitWidth = (length * 0.85) / 2 / Math.tan(hfov / 2);
  const fitHeight = (height * 1.6) / 2 / Math.tan(vfov / 2);
  return Math.max(fitWidth, fitHeight) * 1.35;
}

/** Close-up viewpoints on one ship. */
export type Viewpoint = "overview" | "bow" | "bridge" | "stern" | "loadline" | "underwater" | "hero";

/** Camera position and target for a viewpoint, the ship's midship at the origin floating at `draft`. */
const UNDER_VIEW = new Vector3(0.85, 0, 1).normalize();

function viewpointPose(spec: ShipSpec, draft: number, view: Viewpoint, overviewDistance: number) {
  const L = spec.loa_m;
  const B = spec.beam_m;
  const a = arrangement(spec);
  const lift = -draft; // hull y to world y
  const pose = (target: [number, number, number], offset: [number, number, number]) => {
    const t = new Vector3(...target);
    return { target: t, position: t.clone().add(new Vector3(...offset)) };
  };
  switch (view) {
    case "bow":
      return pose([0.43 * L, Math.max(2, lift + spec.depth_m * 0.6), B * 0.12], [0.17 * L, 0.045 * L, 0.24 * L]);
    case "bridge":
      return pose([a.accFront - a.accLength / 2 - L / 2, a.accTop + lift - 8, 0], [0.2 * L, 0.06 * L, 0.2 * L]);
    case "stern":
      return pose([-0.44 * L, Math.max(3, lift + spec.depth_m * 0.8), 0], [-0.17 * L, 0.05 * L, 0.22 * L]);
    case "underwater": {
      // Below the waterline, off the quarter: the bulb, the flat bottom, the propeller and rudder.
      // Far enough off to take in the whole underwater body, close enough to see through the haze.
      const t = new Vector3(0.06 * L, lift * 0.3, 0);
      const position = t.clone().addScaledVector(UNDER_VIEW, overviewDistance * 0.64);
      position.y = -Math.max(10, draft * 1.6);
      return { target: t, position };
    }
    case "loadline":
      return pose([-2.5, Math.max(1.5, lift + spec.draft_laden_m + 0.6), B / 2], [-1.5, 1.2, 11]);
    case "hero": {
      // From the starboard quarter, bow pointing left, the ship right of centre so the
      // headline on the left doesn't cover the accommodation.
      const height = a.topHeight - draft;
      const right = HERO_DIRECTION.clone().negate().cross(new Vector3(0, 1, 0)).normalize();
      const t = new Vector3(0, height * 0.3, 0).addScaledVector(right, -0.24 * L);
      return { target: t, position: t.clone().addScaledVector(HERO_DIRECTION, overviewDistance * 1.08) };
    }
    default: {
      const height = a.topHeight - draft;
      const t = new Vector3(0, height * 0.22, 0);
      return { target: t, position: t.clone().addScaledVector(VIEW_DIRECTION, overviewDistance) };
    }
  }
}

/**
 * Moves the camera to a viewpoint: eased over about a second, or at once when
 * reduced motion is on. Refits the overview when the canvas is resized.
 */
export function CameraRig({ spec, draft, view, animate }: { spec: ShipSpec; draft: number; view: Viewpoint; animate: boolean }) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const invalidate = useStage().kick;
  const goal = useRef<{ position: Vector3; target: Vector3; t: number } | null>(null);
  useEffect(() => {
    const { camera } = get();
    const height = arrangement(spec).topHeight - draft;
    const pose = viewpointPose(spec, draft, view, fitDistance(camera as THREE.PerspectiveCamera, size, spec.loa_m, height));
    goal.current = { ...pose, t: animate ? 0 : 1 };
    invalidate();
    // The draft only changes the goal slightly; keep the camera where it is for draft changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, size, spec, view, animate, invalidate]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g) return;
    const { camera, controls: ctl } = get();
    const controls = ctl as unknown as OrbitLike | null;
    g.t = Math.min(1, g.t + dt / 0.9);
    const k = g.t >= 1 ? 1 : 1 - (1 - g.t) ** 3;
    camera.position.lerp(g.position, k);
    controls?.target.lerp(g.target, k);
    controls?.update();
    if (g.t >= 1) goal.current = null;
    else invalidate();
  });
  return null;
}

/** Below the surface the haze turns blue-green and close, as water looks; above, the sky's haze returns. */
function UnderwaterHaze() {
  const saved = useRef<{ color: THREE.Color; near: number; far: number; env: number } | null>(null);
  const fill = useRef<THREE.HemisphereLight>(null);
  useFrame(({ scene, camera }) => {
    const fog = scene.fog as THREE.Fog | null;
    if (!fog) return;
    const below = camera.position.y < -0.5;
    if (below && !saved.current) {
      saved.current = { color: fog.color.clone(), near: fog.near, far: fog.far, env: scene.environmentIntensity };
      setUnderwater(scene, fog, fill.current, { color: "#1f5560", near: 6, far: 420, env: 0.3, fill: true });
    } else if (!below && saved.current) {
      const s = saved.current;
      setUnderwater(scene, fog, fill.current, { color: s.color, near: s.near, far: s.far, env: s.env, fill: false });
      saved.current = null;
    }
  });
  // Light filtered through the water: teal from above, darker from below.
  // Always present (intensity 0 above water), so going under doesn't change the light count and recompile shaders.
  return <hemisphereLight ref={fill} args={["#7fd0cb", "#24585c", 0]} />;
}

/** Below the surface: water-coloured haze, the sky's reflections dimmed (no bright glints under water), a teal fill. */
function setUnderwater(
  scene: THREE.Scene,
  fog: THREE.Fog,
  fill: THREE.HemisphereLight | null,
  v: { color: THREE.ColorRepresentation; near: number; far: number; env: number; fill: boolean }
) {
  setFog(fog, v.color, v.near, v.far);
  scene.environmentIntensity = v.env;
  // The sky dome and clouds aren't fogged: under water, hide them and fill with the water's colour.
  scene.background = v.fill ? new THREE.Color(v.color) : null;
  for (const child of scene.children) if (child.userData.fwSky) child.visible = !v.fill;
  if (fill) fill.intensity = v.fill ? 12 : 0;
}

function setFog(fog: THREE.Fog, color: THREE.ColorRepresentation, near: number, far: number) {
  fog.color.set(color);
  fog.near = near;
  fog.far = far;
}

/**
 * Orbit controls for a view in the shared canvas: they listen on the view's
 * own box. Dragging or zooming draws at full frame rate (and for a moment
 * after, while the damping settles). Every sea scene can go below the
 * surface, where the haze turns to water.
 */
export function Controls({ maxDistance = 3000, zoom = true }: { maxDistance?: number; zoom?: boolean }) {
  const { el, kick } = useStage();
  const held = useRef(false);
  useFrame(() => {
    if (held.current) kick(1500);
  });
  if (!el) return null;
  return (
    <>
      <UnderwaterHaze />
      <UnderwaterMotes />
      <OrbitControls
        makeDefault
        domElement={el}
        enablePan={false}
        // Mouse wheel and trackpad pinch (a Ctrl+wheel event) zoom; the +/- buttons do too.
        enableZoom={zoom}
        zoomSpeed={0.8}
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={maxDistance}
        minPolarAngle={0.15}
        // Down past the horizon and under the water.
        maxPolarAngle={Math.PI * 0.62}
        onStart={() => {
          held.current = true;
          kick(1500);
        }}
        onChange={() => kick(1500)}
        onEnd={() => {
          held.current = false;
          kick(1500);
        }}
      />
    </>
  );
}

/** Sky preset for the current theme: afternoon in light mode, dusk in dark mode. */
export function useThemeSky(): SkyPreset {
  return useShipColors().dark ? "dusk" : "day";
}

/** Depth drawn under ships at sea: deep enough to vanish in the underwater haze. */
const OPEN_SEA_DEPTH = 60;

/** Caustic light on the seabed, from the water-normal texture scrolled two ways (shallow water shows it most). */
function causticMaterial(waterNormals: THREE.Texture, depth: number) {
  const m = new THREE.MeshStandardMaterial({ color: "#8f8264", roughness: 1 });
  const uniforms = { uWaterN: { value: waterNormals }, uTime: { value: 0 }, uStrength: { value: 0.9 * Math.exp(-depth / 22) } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSeabedP;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvSeabedP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSeabedP;\nuniform sampler2D uWaterN;\nuniform float uTime, uStrength;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec2 p = vSeabedP.xz;
  float a = texture2D(uWaterN, p * 0.045 + uTime * vec2(0.018, 0.013)).r;
  float b = texture2D(uWaterN, p * 0.063 - uTime * vec2(0.015, 0.021)).g;
  float c = pow(smoothstep(0.8, 1.0, 1.0 - abs(a - b) * 3.0), 4.0);
  totalEmissiveRadiance += vec3(0.45, 0.62, 0.58) * c * uStrength * 0.35;
}`
      );
  };
  m.customProgramCacheKey = () => "fw-seabed-caustics";
  return { material: m, uniforms };
}

function setCausticTime(u: { uTime: { value: number } }, t: number) {
  u.uTime.value = t;
}

/** A sandy seabed at `depth` below the surface, lit by caustics, with an optional label. */
export function Seabed({ depth, size, label }: { depth: number; size: [number, number]; label?: string }) {
  const colors = useShipColors();
  const waterNormals = useTexture(asset("waternormals.jpg")) as THREE.Texture;
  const { material, uniforms } = useMemo(() => causticMaterial(waterNormals, depth), [waterNormals, depth]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => setCausticTime(uniforms, clock.elapsedTime));
  return (
    <group position={[0, -depth, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={material}>
        <planeGeometry args={size} />
      </mesh>
      {label && <Label text={label} position={[-size[0] * 0.06, 3, size[1] * 0.16]} color={colors.label} background={colors.labelBackground} height={9} />}
    </group>
  );
}

const MOTE_VERT = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
attribute float aSeed;
varying float vFade;
void main() {
  // Motes fill a 50 m box that travels with the camera (wrapped, so none are ever re-placed on the CPU).
  vec3 p = position + vec3(sin(uTime * 0.2 + aSeed) * 0.6, uTime * 0.12, cos(uTime * 0.17 + aSeed) * 0.6);
  p = mod(p - uCam + 25.0, 50.0) - 25.0 + uCam;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = 1.0 - smoothstep(10.0, 25.0, length(mv.xyz));
  gl_PointSize = clamp(90.0 / -mv.z, 1.0, 4.0);
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */ `
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(0.75, 0.9, 0.85, (1.0 - smoothstep(0.2, 0.5, d)) * 0.45 * vFade);
}`;

function setMotes(u: { uCam: { value: THREE.Vector3 }; uTime: { value: number } }, cam: THREE.Vector3, t: number) {
  u.uCam.value.copy(cam);
  u.uTime.value = t;
}

/** Particles drifting in the water: shown only while the camera is below the surface. */
function UnderwaterMotes() {
  const { quality } = useStage();
  const ref = useRef<THREE.Points>(null);
  const { geometry, material, uniforms } = useMemo(() => {
    const n = 700;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let x = 3;
    const rand = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < n; i++) {
      pos.set([rand() * 50 - 25, rand() * 50 - 25, rand() * 50 - 25], i * 3);
      seed[i] = rand() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const u = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 } };
    const m = new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: u, transparent: true, depthWrite: false, fog: false });
    return { geometry: g, material: m, uniforms: u };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );
  useFrame(({ camera, clock }) => {
    const p = ref.current;
    if (!p) return;
    p.visible = camera.position.y < -0.5;
    if (p.visible) setMotes(uniforms, camera.position, clock.elapsedTime);
  });
  if (quality === "low") return null;
  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}

/**
 * One ship on the sea: floating at `draft`, in waves of significant height
 * `hs` metres (the port's forecast), under the theme's sky. With
 * `seabedDepth`, the water is clearer and the seabed shows at the port's
 * usable depth, so the clearance under the keel is visible.
 */
export function SingleShip({
  spec,
  draft,
  hs = 1,
  seabedDepth,
  seabedLabel,
  height = 260,
  animate = true,
  preset,
  label,
  view = "overview",
  zoomButtons = true,
  wheelZoom = zoomButtons,
  onReady,
}: {
  spec: ShipSpec;
  draft: number;
  view?: Viewpoint;
  zoomButtons?: boolean;
  /** Whether the mouse wheel zooms; off where the page around it should keep scrolling. */
  wheelZoom?: boolean;
  /** When set, the caller fades the view in itself: no placeholder, and this is called once drawn. */
  onReady?: () => void;
  hs?: number;
  seabedDepth?: number | null;
  seabedLabel?: string;
  height?: number | string;
  animate?: boolean;
  preset?: SkyPreset;
  label?: string;
}) {
  const themeSky = useThemeSky();
  const sky = preset ?? themeSky;
  const waves = useMemo(() => seaState(hs), [hs]);
  const look = useMemo(() => ({ ...SKY[sky].sea, clarity: seabedDepth != null ? 0.55 : 0 }), [sky, seabedDepth]);
  // The open sea is deep: a seabed far down, lost in the underwater haze, so looking down shows water, not a void.
  return (
    <Stage animated={animate} height={height} label={label} zoomButtons={zoomButtons} placeholder={!onReady} onReady={onReady}>
      <Environment preset={sky} shadowSize={spec.loa_m * 0.62} animate={animate} />
      <Ocean waves={waves} look={look} animate={animate} />
      <Afloat spec={spec} draft={draft} waves={waves} animate={animate} />
      <Surroundings waves={waves} animate={animate} around={spec.loa_m} />
      {seabedDepth != null ? (
        <Seabed depth={seabedDepth} size={[spec.loa_m * 2.4, spec.beam_m * 8]} label={seabedLabel} />
      ) : (
        <Seabed depth={OPEN_SEA_DEPTH} size={[spec.loa_m * 6, spec.loa_m * 6]} />
      )}
      <CameraRig spec={spec} draft={draft} view={view} animate={animate} />
      <Controls zoom={wheelZoom} />
    </Stage>
  );
}

function FleetShip({ spec, z, x0, waves, animate, onSelect, labelColor, labelBackground }: {
  spec: ShipSpec;
  z: number;
  x0: number;
  waves: WaveTrain[];
  animate: boolean;
  onSelect: () => void;
  labelColor: string;
  labelBackground: string;
}) {
  const top = arrangement(spec).topHeight;
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      userData={{ ship: spec.name }}
    >
      <Afloat spec={spec} draft={spec.draft_laden_m} waves={waves} animate={animate} detail="medium" at={[x0 + spec.loa_m / 2, z]}>
        <Label text={spec.name} position={[spec.loa_m * 0.1, top + 14, 0]} color={labelColor} background={labelBackground} height={14} />
      </Afloat>
    </group>
  );
}

/** Moves the camera to the selected ship, or back to the whole fleet, from the same quarter view. */
// Below the waterline, looking a little up at the hulls: drafts and bulbs side by side.
const UNDER_DIRECTION = new Vector3(-0.45, -0.02, 0.88).normalize();

function FleetCamera({ focus, animate, below }: { focus: { x: number; z: number; length: number; height: number } | { width: number; length: number }; animate: boolean; below: boolean }) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const invalidate = useStage().kick;
  const goal = useRef<{ position: Vector3; target: Vector3; t: number } | null>(null);
  const key = JSON.stringify(focus);
  useEffect(() => {
    const camera = get().camera as THREE.PerspectiveCamera;
    const f = JSON.parse(key) as { x?: number; z?: number; length: number; height?: number; width?: number };
    const target = f.z != null ? new Vector3(f.x ?? 0, below ? -9 : (f.height ?? 30) * 0.22, f.z) : new Vector3(0, below ? -10 : 8, 0);
    const distance = f.z != null ? fitDistance(camera, size, f.length, f.height ?? 30) * 1.22 : fitDistance(camera, size, Math.max(f.length, (f.width ?? 0) * 1.6), 60) * 1.05;
    // Under water the haze closes in, so come nearer.
    const position = target.clone().addScaledVector(below ? UNDER_DIRECTION : VIEW_DIRECTION, below ? Math.min(distance, 260) : distance);
    goal.current = { target, position, t: animate ? 0 : 1 };
    invalidate();
  }, [get, size, key, animate, invalidate, below]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g) return;
    const { camera, controls: ctl } = get();
    const controls = ctl as unknown as OrbitLike | null;
    g.t = Math.min(1, g.t + dt / 0.9);
    const k = g.t >= 1 ? 1 : 1 - (1 - g.t) ** 3;
    camera.position.lerp(g.position, k);
    controls?.target.lerp(g.target, k);
    controls?.update();
    if (g.t >= 1) goal.current = null;
    else invalidate();
  });
  return null;
}

/** Every class side by side on one sea, sterns lined up so lengths compare. */
export function Fleet({
  specs,
  selected,
  onSelect,
  height = 380,
  animate = true,
  label,
  below = false,
}: {
  specs: ShipSpec[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  height?: number;
  animate?: boolean;
  label?: string;
  /** Look at the hulls from below the waterline. */
  below?: boolean;
}) {
  const colors = useShipColors();
  const sky = useThemeSky();
  const waves = useMemo(() => seaState(0.8), []);
  const maxL = Math.max(...specs.map((s) => s.loa_m));
  const gap = 55;
  // Side by side across the sea, each ship's centreline one gap from the next.
  const starts = specs.map((_, i) => specs.slice(0, i).reduce((sum, p) => sum + p.beam_m + gap, 0));
  const width = specs.reduce((sum, p) => sum + p.beam_m + gap, 0);
  const placed = specs.map((s, i) => ({ s, at: starts[i] + s.beam_m / 2 }));
  const offset = width / 2;
  const picked = placed.find(({ s }) => s.name === selected);
  const focus = picked
    ? { x: -maxL / 2 + picked.s.loa_m / 2, z: picked.at - offset, length: picked.s.loa_m, height: arrangement(picked.s).topHeight - picked.s.draft_laden_m }
    : { width, length: maxL };
  return (
    <Stage animated={animate} height={height} label={label}>
      <Environment preset={sky} shadowSize={maxL * 0.9} animate={animate} />
      <Ocean waves={waves} look={SKY[sky].sea} animate={animate} />
      <Surroundings waves={waves} animate={animate} around={maxL * 1.4} birds={false} />
      {placed
          // Looking closer at one ship: the others would block the view.
          .filter(({ s }) => !selected || s.name === selected)
          .map(({ s, at }) => (
            <FleetShip
              key={s.name}
              spec={s}
              z={at - offset}
              x0={-maxL / 2}
              waves={waves}
              animate={animate}
              onSelect={() => onSelect(s.name)}
              labelColor={colors.label}
              labelBackground={colors.labelBackground}
            />
          ))}
      <FleetCamera focus={focus} animate={animate} below={below} />
      <Controls />
    </Stage>
  );
}
