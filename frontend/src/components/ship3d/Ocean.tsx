import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { asset } from "./materials";
import { type Footprint, TIER, useStage } from "./quality";
import { MAX_WAVES, type WaveTrain } from "./waves";

const MAX_SHIPS = 12;

/**
 * A disc of sea, dense near the centre (where the ship is) and coarse towards
 * the horizon, in the x-z plane.
 */
function seaGeometry(radius: number, rings = 120, segments = 192) {
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const r = radius * (i / rings) ** 2.2;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segments; j++) indices.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segments;
    const b0 = 1 + i * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      indices.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(indices);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
  return g;
}

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec4 uWaveA[${MAX_WAVES}];
uniform vec2 uWaveB[${MAX_WAVES}];
uniform vec2 uFade;
varying float vHeight;
varying vec3 vSea;
varying vec2 vPlane;
`;

type OceanUniforms = {
  uTime: { value: number };
  uWaveA: { value: THREE.Vector4[] };
  uWaveB: { value: THREE.Vector2[] };
  uAmp: { value: number };
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
  uWaterN: { value: THREE.Texture | null };
  uRefl: { value: THREE.Texture | null };
  uReflMatrix: { value: THREE.Matrix4 };
  uReflStrength: { value: number };
  uShips: { value: THREE.Vector4[] };
  uShipCount: { value: number };
};

// Uniform writes live outside the component: three.js objects are mutable by design.
function applyWaves(u: OceanUniforms, waves: WaveTrain[]) {
  waves.slice(0, MAX_WAVES).forEach((w, i) => {
    u.uWaveA.value[i].set(w.dir[0], w.dir[1], w.k, w.a);
    u.uWaveB.value[i].set(w.q, w.phase);
  });
  for (let i = waves.length; i < MAX_WAVES; i++) u.uWaveA.value[i].set(1, 0, 1, 0);
  u.uAmp.value = waves.reduce((s, w) => s + w.a, 0);
}

function applyLook(u: OceanUniforms, material: THREE.MeshStandardMaterial, look: SeaLook, reflecting: boolean) {
  u.uDeep.value.set(look.deep);
  u.uShallow.value.set(look.shallow);
  const clarity = look.clarity ?? 0;
  material.transparent = clarity > 0;
  material.opacity = 1 - clarity * 0.62;
  material.depthWrite = clarity < 0.5;
  // Seen from below too: every sea scene can go under the surface.
  material.side = THREE.DoubleSide;
  // With planar reflections, the sky map only adds a little on top.
  material.envMapIntensity = reflecting ? 0.35 : 1;
  material.needsUpdate = true;
}

function setTime(u: OceanUniforms, t: number) {
  u.uTime.value = t;
}

export interface SeaLook {
  deep: string;
  shallow: string;
  /** 0 = open sea (opaque); up to 1 = clear harbour water you can see into. */
  clarity?: number;
}

/**
 * Planar reflection: the scene rendered from a camera mirrored in the sea
 * surface, into a half-float target, with an oblique near plane so nothing
 * under the water shows (three.js's Reflector technique).
 */
function useReflection(scale: number, surface: React.RefObject<THREE.Mesh | null>, u: OceanUniforms) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const dpr = gl.getPixelRatio();
  const { onPreRender } = useStage();
  const target = useMemo(() => {
    if (scale <= 0) return null;
    return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
  }, [scale]);
  useEffect(() => {
    // At most 1024 px wide: the mirror is blurred by the waves anyway.
    const w = Math.min(1024, Math.max(1, Math.round(size.width * dpr * scale)));
    target?.setSize(w, Math.max(1, Math.round((w * size.height) / Math.max(1, size.width))));
  }, [target, size, dpr, scale]);
  useEffect(() => () => target?.dispose(), [target]);
  const tmp = useMemo(
    () => ({
      cam: new THREE.PerspectiveCamera(),
      plane: new THREE.Plane(),
      clip: new THREE.Vector4(),
      q: new THREE.Vector4(),
      view: new THREE.Vector3(),
      look: new THREE.Vector3(),
      target: new THREE.Vector3(),
      rot: new THREE.Matrix4(),
      camPos: new THREE.Vector3(),
    }),
    []
  );
  useEffect(() => {
    setUniform(u, "uRefl", target?.texture ?? null);
    setUniform(u, "uReflStrength", target ? 1 : 0);
  }, [target, u]);

  // Just before the view renders: every frame while it moves, every other frame at rest.
  useEffect(() => {
    let n = 0;
    return onPreRender((busy) => {
      n += 1;
      if (!target || !surface.current || (!busy && n % 2 === 0 && n > 4)) return;
      renderMirror(gl, scene, camera, surface.current, target, tmp, u);
    });
  }, [onPreRender, target, gl, scene, camera, tmp, u, surface]);
}

type Mirror = {
  cam: THREE.PerspectiveCamera;
  plane: THREE.Plane;
  clip: THREE.Vector4;
  q: THREE.Vector4;
  view: THREE.Vector3;
  look: THREE.Vector3;
  target: THREE.Vector3;
  rot: THREE.Matrix4;
  camPos: THREE.Vector3;
};

const UP = new THREE.Vector3(0, 1, 0);
const SURFACE = new THREE.Vector3(0, -0.4, 0);

/** Renders the scene from the camera mirrored in the sea, with an oblique near plane at the surface. */
function renderMirror(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mesh: THREE.Mesh, target: THREE.WebGLRenderTarget, m: Mirror, u: OceanUniforms) {
  const { cam, plane, clip, q, view, look, rot, camPos } = m;
  camPos.setFromMatrixPosition(camera.matrixWorld);
  if (camPos.y < 0) return; // looking from under the water: no mirror
  view.set(camPos.x, -camPos.y, camPos.z);
  rot.extractRotation(camera.matrixWorld);
  look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
  m.target.set(look.x, -look.y, look.z);
  cam.position.copy(view);
  cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(UP);
  cam.lookAt(m.target);
  cam.far = (camera as THREE.PerspectiveCamera).far;
  cam.updateMatrixWorld();
  cam.projectionMatrix.copy(camera.projectionMatrix);
  u.uReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  // Oblique near plane at the sea surface (slightly below, to keep the waterline).
  plane.setFromNormalAndCoplanarPoint(UP, SURFACE).applyMatrix4(cam.matrixWorldInverse);
  clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const p = cam.projectionMatrix.elements;
  q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
  clip.multiplyScalar(2 / clip.dot(q));
  p[2] = clip.x;
  p[6] = clip.y;
  p[10] = clip.z + 1;
  p[14] = clip.w;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

  mesh.visible = false;
  const prevTarget = gl.getRenderTarget();
  const prevShadow = gl.shadowMap.autoUpdate;
  gl.shadowMap.autoUpdate = false;
  gl.setRenderTarget(target);
  gl.clear();
  gl.render(scene, cam);
  gl.setRenderTarget(prevTarget);
  gl.shadowMap.autoUpdate = prevShadow;
  mesh.visible = true;
}

function setUniform<K extends keyof OceanUniforms>(u: OceanUniforms, key: K, value: OceanUniforms[K]["value"]) {
  u[key].value = value;
}

function applyFootprints(u: OceanUniforms, footprints: Map<number, Footprint>) {
  let i = 0;
  for (const f of footprints.values()) {
    if (i >= MAX_SHIPS) break;
    u.uShips.value[i].set(f.x, f.z, f.halfLength, f.halfBeam);
    i++;
  }
  u.uShipCount.value = i;
}

/**
 * The sea surface: Gerstner waves displaced in the vertex shader (the same
 * trains the ship's motion samples), with analytic normals; fine ripples from
 * a scanned water-normal map at three scales; planar reflections of the sky,
 * clouds and ships with a Fresnel falloff; foam on the crests and where each
 * hull meets the water (thickest at the bow); and waves fading out towards
 * the horizon so the far sea doesn't shimmer.
 */
export function Ocean({
  waves,
  look,
  radius = 4000,
  animate = true,
  receiveShadow = true,
}: {
  waves: WaveTrain[];
  look: SeaLook;
  radius?: number;
  animate?: boolean;
  receiveShadow?: boolean;
}) {
  const { quality, footprints } = useStage();
  const reflectScale = (look.clarity ?? 0) > 0.3 ? TIER[quality].reflection * 0.8 : TIER[quality].reflection;
  const waterNormals = useTexture(asset("waternormals.jpg"), (t) => {
    const tex = t as THREE.Texture;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.NoColorSpace;
  }) as THREE.Texture;
  const surface = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => seaGeometry(radius), [radius]);
  const uniforms = useMemo<OceanUniforms & { uFade: { value: THREE.Vector2 } }>(
    () => ({
      uTime: { value: 0 },
      uWaveA: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
      uWaveB: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector2()) },
      uFade: { value: new THREE.Vector2(radius * 0.22, radius * 0.55) },
      uAmp: { value: 1 },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uWaterN: { value: null },
      uRefl: { value: null },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflStrength: { value: 0 },
      uShips: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector4()) },
      uShipCount: { value: 0 },
    }),
    [radius]
  );
  useEffect(() => setUniform(uniforms, "uWaterN", waterNormals), [uniforms, waterNormals]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0.0, envMapIntensity: 1.0 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
${GLSL_COMMON}
vec3 fwGerstner(vec2 p, out vec3 n) {
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, length(p));
  vec3 d = vec3(p.x, 0.0, p.y);
  vec3 nn = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 w = uWaveA[i];
    vec2 b = uWaveB[i];
    float a = w.w * fade;
    float f = w.z * dot(w.xy, p) - sqrt(9.81 * w.z) * uTime + b.y;
    float c = cos(f);
    float s = sin(f);
    d.x += b.x * a * w.x * c;
    d.z += b.x * a * w.y * c;
    d.y += a * s;
    float wa = w.z * a;
    nn.x -= w.x * wa * c;
    nn.z -= w.y * wa * c;
    nn.y -= b.x * wa * s;
  }
  n = normalize(nn);
  return d;
}`
        )
        .replace(
          "#include <beginnormal_vertex>",
          `vec3 fwN;
vec3 fwP = fwGerstner(position.xz, fwN);
vec3 objectNormal = fwN;
vHeight = fwP.y;
vSea = fwP;
vPlane = position.xz;`
        )
        .replace("#include <begin_vertex>", "vec3 transformed = fwP;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
${GLSL_COMMON}
uniform float uAmp;
uniform vec3 uDeep, uShallow;
uniform sampler2D uWaterN;
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflStrength;
uniform vec4 uShips[${MAX_SHIPS}];
uniform int uShipCount;
float fwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fwHash(i), fwHash(i + vec2(1.0, 0.0)), u.x), mix(fwHash(i + vec2(0.0, 1.0)), fwHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Foam where a hull meets the water: distance to a waterline shape with a
// parallel body and rounded ends, a wider band at the bow.
float fwHullFoam(vec2 p) {
  float foam = 0.0;
  for (int i = 0; i < ${MAX_SHIPS}; i++) {
    if (i >= uShipCount) break;
    vec4 s = uShips[i];
    vec2 q = p - s.xy;
    float body = max(abs(q.x) - (s.z - s.w * 1.4), 0.0);
    float d = length(vec2(body * 0.72, q.y)) - s.w;
    float bow = exp(-abs(q.x - s.z) / 14.0);
    float band = (1.0 - smoothstep(0.0, 2.2 + bow * 5.0, d)) * smoothstep(-0.8, 0.0, d);
    foam = max(foam, band);
  }
  return foam;
}`
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float fwCrest = clamp(vHeight / max(uAmp, 0.01), -1.0, 1.0);
float fwFar = smoothstep(uFade.x * 0.5, uFade.y, length(vSea.xz));
vec3 fwWater = mix(uDeep, uShallow, smoothstep(-0.3, 1.0, fwCrest) * 0.5 * (1.0 - fwFar));
float fwFoamNoise = fwNoise(vSea.xz * 0.3 + uTime * 0.15) * 0.6 + fwNoise(vSea.xz * 1.4 - uTime * 0.35) * 0.4;
float fwFoam = smoothstep(0.5, 0.95, fwCrest) * smoothstep(0.5, 0.82, fwFoamNoise) * smoothstep(0.4, 1.2, uAmp) * (1.0 - fwFar);
float fwHull = fwHullFoam(vSea.xz) * smoothstep(0.25, 0.75, fwNoise(vSea.xz * 0.9 + vec2(uTime * 0.4, -uTime * 0.3)) * 0.7 + fwNoise(vSea.xz * 3.1) * 0.3);
fwFoam = max(fwFoam, fwHull * 0.9);
diffuseColor.rgb = mix(fwWater, vec3(0.9, 0.93, 0.94), fwFoam);`
        )
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, fwFoam);")
        .replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>
{
  // Wave normals per pixel (not interpolated from the coarse outer grid).
  vec3 wn = vec3(0.0, 1.0, 0.0);
  float fadeN = 1.0 - smoothstep(uFade.x, uFade.y, length(vPlane));
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec4 w = uWaveA[i];
    vec2 b = uWaveB[i];
    float f = w.z * dot(w.xy, vPlane) - sqrt(9.81 * w.z) * uTime + b.y;
    float wa = w.z * w.w * fadeN;
    wn.x -= w.x * wa * cos(f);
    wn.z -= w.y * wa * cos(f);
    wn.y -= b.x * wa * sin(f);
  }
  normal = normalize((viewMatrix * vec4(normalize(wn), 0.0)).xyz);
  // Fine ripples from the scanned water-normal map, three scales drifting in different directions.
  vec2 p = vSea.xz;
  vec2 g = (texture2D(uWaterN, p * 0.016 + vec2(uTime * 0.010, uTime * 0.006)).xy * 2.0 - 1.0) * 0.5
         + (texture2D(uWaterN, p * 0.043 - vec2(uTime * 0.008, -uTime * 0.013)).xy * 2.0 - 1.0) * 0.35
         + (texture2D(uWaterN, p * 0.11 + vec2(uTime * 0.028, 0.0)).xy * 2.0 - 1.0) * 0.22;
  g *= (0.28 + 0.12 * min(uAmp, 2.0)) * (1.0 - smoothstep(60.0, 1100.0, length(p - cameraPosition.xz)));
  normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz);
}`
        )
        .replace(
          "#include <opaque_fragment>",
          `if (uReflStrength > 0.0 && gl_FrontFacing) {
  vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec4 rc = uReflMatrix * vec4(vSea.x, 0.0, vSea.z, 1.0);
  vec2 ruv = rc.xy / rc.w + nW.xz * 0.045;
  vec3 refl = texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb;
  vec3 V = normalize(cameraPosition - vSea);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(nW, V), 0.0), 5.0);
  outgoingLight = mix(outgoingLight, refl, clamp(fres * uReflStrength, 0.0, 0.95) * (1.0 - fwFoam));
}
if (!gl_FrontFacing) {
  // The underside, looking up: Snell's window (the sky, bright, within about 49 degrees of
  // straight up) and total internal reflection (the water's own colour) outside it.
  vec3 V = normalize(cameraPosition - vSea);
  float up = abs(V.y);
  float window = smoothstep(0.62, 0.78, up);
  vec3 deepBelow = vec3(0.012, 0.075, 0.085);
  vec3 skyThrough = vec3(0.35, 0.55, 0.58) + fwFoam * 0.4;
  outgoingLight = mix(deepBelow, skyThrough, window);
  diffuseColor.a = 1.0;
}
#include <opaque_fragment>`
        );
    };
    m.customProgramCacheKey = () => "fw-ocean-v3";
    return m;
  }, [uniforms]);

  useReflection(reflectScale, surface, uniforms);

  useEffect(() => applyWaves(uniforms, waves), [waves, uniforms]);
  useEffect(() => applyLook(uniforms, material, look, reflectScale > 0), [look, uniforms, material, reflectScale]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  useFrame(({ clock }) => {
    if (animate) setTime(uniforms, clock.elapsedTime);
    applyFootprints(uniforms, footprints);
  });

  return <mesh ref={surface} geometry={geometry} material={material} receiveShadow={receiveShadow} frustumCulled={false} renderOrder={1} />;
}
