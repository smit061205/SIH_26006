import { Environment as EnvMap } from "@react-three/drei";
import { useFrame, useLoader } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { Sky as SkyMesh } from "three/examples/jsm/objects/Sky.js";
import { asset } from "./materials";
import type { SeaLook } from "./Ocean";
import { TIER, useStage } from "./quality";

export type SkyPreset = "day" | "golden" | "dusk";

interface Preset {
  elevation: number; // sun, degrees above the horizon
  azimuth: number; // degrees
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  sunColor: string;
  sunIntensity: number;
  exposure: number;
  /** Haze at the horizon, matched to the sky so the sea fades into it. */
  fog: string;
  sea: SeaLook;
  /** Image-based light: a CC0 sky photograph (Poly Haven), turned so its sun lines up with ours. */
  hdri: string;
  envIntensity: number;
  /** Cloud layer: cover (0-1), lit and shadowed colours. */
  clouds: { cover: number; lit: string; shade: string };
  /** 0 by day, 1 at night: lights come on. */
  night: number;
}

/**
 * Three lighting setups: a clear afternoon for the light theme, golden hour
 * for the landing page, and dusk for the dark theme.
 */
export const SKY: Record<SkyPreset, Preset> = {
  day: {
    elevation: 34,
    azimuth: 200,
    turbidity: 4.5,
    rayleigh: 1.1,
    mie: 0.004,
    mieG: 0.8,
    sunColor: "#fff3e2",
    sunIntensity: 3.2,
    exposure: 1.0,
    fog: "#b7cbd9",
    sea: { deep: "#0a3346", shallow: "#1c6a72" },
    hdri: "kloofendal_48d_partly_cloudy_puresky_1k.hdr",
    envIntensity: 0.55,
    clouds: { cover: 0.5, lit: "#ffffff", shade: "#8e9cae" },
    night: 0,
  },
  golden: {
    // Low sun ahead of the landing page's camera, so the sky glows behind the ship.
    elevation: 6,
    azimuth: 330,
    turbidity: 8,
    rayleigh: 2.8,
    mie: 0.005,
    mieG: 0.88,
    sunColor: "#ffc488",
    sunIntensity: 3.6,
    exposure: 0.9,
    fog: "#d9b79a",
    sea: { deep: "#0b2c3d", shallow: "#27616a" },
    hdri: "belfast_sunset_puresky_1k.hdr",
    envIntensity: 0.5,
    clouds: { cover: 0.38, lit: "#ffd2a6", shade: "#6f5a66" },
    night: 0.25,
  },
  dusk: {
    elevation: 2.2,
    azimuth: 150,
    turbidity: 9,
    rayleigh: 3,
    mie: 0.005,
    mieG: 0.8,
    sunColor: "#ff9a6b",
    sunIntensity: 1.6,
    exposure: 0.85,
    fog: "#4a4e63",
    sea: { deep: "#07202c", shallow: "#15434d" },
    hdri: "belfast_sunset_puresky_1k.hdr",
    envIntensity: 0.32,
    clouds: { cover: 0.5, lit: "#f39a78", shade: "#383a52" },
    night: 1,
  },
};

export function sunDirection(p: Preset) {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.elevation), THREE.MathUtils.degToRad(p.azimuth));
}

// three.js objects are mutable by design; the writes live outside the components.
function asEquirect(t: THREE.Texture) {
  t.mapping = THREE.EquirectangularReflectionMapping;
}
function setCloudTime(m: THREE.ShaderMaterial, t: number) {
  m.uniforms.uTime.value = t;
}

function Exposure({ value }: { value: number }) {
  const { setExposure } = useStage();
  useEffect(() => {
    // Tone mapping itself (AgX) is the post-processing pass's; views share one
    // renderer, so each view keeps its own exposure and sets it as it renders.
    setExposure(value);
  }, [value, setExposure]);
  return null;
}

function setSkyUniforms(sky: SkyMesh, v: { sun: THREE.Vector3; turbidity: number; rayleigh: number; mie: number; mieG: number }) {
  const u = sky.material.uniforms;
  u.sunPosition.value.copy(v.sun);
  u.turbidity.value = v.turbidity;
  u.rayleigh.value = v.rayleigh;
  u.mieCoefficient.value = v.mie;
  u.mieDirectionalG.value = v.mieG;
}

/**
 * The Preetham sky dome. three.js's own Sky, one material per instance: the
 * three-stdlib version drei wraps shares a single material across every
 * canvas, so one view's dusk would repaint another view's afternoon.
 */
function PhysicalSky({ p, sun, distance }: { p: Preset; sun: THREE.Vector3; distance: number }) {
  const sky = useMemo(() => {
    const m = new SkyMesh();
    m.userData.fwSky = true;
    return m;
  }, []);
  useLayoutEffect(() => setSkyUniforms(sky, { sun, turbidity: p.turbidity, rayleigh: p.rayleigh, mie: p.mie, mieG: p.mieG }), [sky, sun, p]);
  useEffect(
    () => () => {
      sky.geometry.dispose();
      sky.material.dispose();
    },
    [sky]
  );
  return <primitive object={sky} scale={distance} />;
}

/** Horizontal angle of the brightest pixel of an equirectangular HDR image: where its sun is. */
function sunAngle(texture: THREE.DataTexture) {
  const { data, width, height } = texture.image as { data: ArrayLike<number>; width: number; height: number };
  const half = data instanceof Uint16Array;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  let best = -1;
  let col = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const v = read(i) + read(i + 1) + read(i + 2);
      if (v > best) {
        best = v;
        col = x;
      }
    }
  }
  // three.js samples equirect maps with u = atan(z, x) / 2pi + 0.5.
  return ((col + 0.5) / width - 0.5) * Math.PI * 2;
}

/** Image-based light from the sky photograph, rotated so its sun sits where the scene's sun is. */
function SkyLight({ p, sun }: { p: Preset; sun: THREE.Vector3 }) {
  const texture = useLoader(HDRLoader, asset(p.hdri)) as THREE.DataTexture;
  const rotation = useMemo(() => {
    asEquirect(texture);
    // A rotation by theta about +y moves an angle psi = atan2(z, x) to psi - theta.
    const theta = sunAngle(texture) - Math.atan2(sun.z, sun.x);
    return new THREE.Euler(0, theta, 0);
  }, [texture, sun]);
  return <EnvMap map={texture} environmentIntensity={p.envIntensity} environmentRotation={rotation} />;
}

const CLOUD_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // on the far plane, behind everything
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSun, uLit, uShade;
uniform float uCover, uTime;
varying vec3 vDir;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { v += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v + a; // the missing octaves' mean, so cover is the same at any octave count
}
void main() {
  vec3 d = normalize(vDir);
  if (d.y < 0.005) discard;
  // Project onto a cloud deck 1.2 km up; drift slowly with the wind.
  vec2 p = d.xz / max(d.y, 0.015) * 0.42 + vec2(uTime * 0.004, uTime * 0.0015);
  float base = fbm(p * 0.9);
  float density = smoothstep(1.0 - uCover, 1.0 - uCover + 0.28, base);
  if (density < 0.01) discard;
  // Self-shadowing: denser towards the sun means this side is in shade.
  float toward = fbm(p * 0.9 + normalize(uSun.xz) * 0.08);
  float lit = clamp(0.55 + (base - toward) * 5.0, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lit);
  // Silver lining close to the sun.
  float glow = pow(max(dot(d, normalize(uSun)), 0.0), 12.0);
  col += uLit * glow * (1.0 - density) * 1.6;
  // Thin out towards the horizon, where the deck is seen edge-on and the haze takes over.
  float horizon = smoothstep(0.004, 0.06, d.y);
  gl_FragColor = vec4(col, density * horizon * 0.92);
  #include <colorspace_fragment>
}`;

/** A deck of clouds over the sea, lit from the sun's side, drifting on the wind. */
function CloudLayer({ p, sun, animate, octaves }: { p: Preset; sun: THREE.Vector3; animate: boolean; octaves: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        defines: { OCTAVES: octaves },
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uSun: { value: sun.clone() },
          uLit: { value: new THREE.Color(p.clouds.lit) },
          uShade: { value: new THREE.Color(p.clouds.shade) },
          uCover: { value: p.clouds.cover },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
      }),
    [p, sun, octaves]
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    if (animate) setCloudTime(material, clock.elapsedTime);
  });
  return (
    <mesh material={material} renderOrder={-1} frustumCulled={false} userData={{ fwSky: true }}>
      <sphereGeometry args={[3000, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
    </mesh>
  );
}

/**
 * Sky, sunlight and reflections: the physical sky model (Preetham) as the
 * background with a deck of drifting clouds; image-based light from a real
 * sky photograph lined up with the sun, so paint, glass and metal pick up
 * believable reflections; a sun that casts soft shadows over `shadowSize`
 * metres round the origin; and horizon haze.
 */
export function Environment({
  preset,
  shadowSize = 200,
  fogNear = 1400,
  fogFar = 4200,
  animate = true,
}: {
  preset: SkyPreset;
  shadowSize?: number;
  fogNear?: number;
  fogFar?: number;
  animate?: boolean;
}) {
  const p = SKY[preset];
  const { quality, setNight } = useStage();
  const tier = TIER[quality];
  const sun = useMemo(() => sunDirection(p), [p]);
  useLayoutEffect(() => setNight(p.night), [p.night, setNight]);
  const light = sun.clone().multiplyScalar(shadowSize * 3);
  return (
    <>
      <Exposure value={p.exposure} />
      <PhysicalSky p={p} sun={sun} distance={4500} />
      {tier.clouds && <CloudLayer p={p} sun={sun} animate={animate} octaves={quality === "high" ? 6 : 4} />}
      <SkyLight p={p} sun={sun} />
      <hemisphereLight args={[p.fog, "#0b2733", 0.25]} />
      <fog attach="fog" args={[p.fog, fogNear, fogFar]} />
      <directionalLight
        key={tier.shadowMap}
        position={light.toArray()}
        intensity={p.sunIntensity}
        color={p.sunColor}
        castShadow
        shadow-mapSize={[tier.shadowMap, tier.shadowMap]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.4}
        shadow-camera-left={-shadowSize}
        shadow-camera-right={shadowSize}
        shadow-camera-top={shadowSize}
        shadow-camera-bottom={-shadowSize}
        shadow-camera-near={shadowSize * 0.5}
        shadow-camera-far={shadowSize * 6}
      />
    </>
  );
}
