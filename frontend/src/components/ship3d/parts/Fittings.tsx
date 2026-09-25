import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { arrangement } from "../hull";
import { type Paint, PAINT, ensignTexture } from "../materials";
import { useStage } from "../quality";

type Layout = ReturnType<typeof arrangement>;

const unit = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

function Instances({ matrices, geometry, material, castShadow = true }: { matrices: THREE.Matrix4[]; geometry: THREE.BufferGeometry; material: THREE.Material; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  if (!matrices.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} castShadow={castShadow} />;
}

const mat = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** A clamshell grab: head, two jaws closed, the closing wires' sheaves. Stowed on deck or hanging from a crane. */
export function Grab({ position, open = 0, material }: { position: [number, number, number]; open?: number; material: THREE.Material }) {
  return (
    <group position={position}>
      <mesh position={[0, 2.3, 0]} castShadow material={material}>
        <boxGeometry args={[1.4, 1.1, 1.4]} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s} position={[0, 1.7, s * 0.2]} rotation={[s * (0.15 + open * 0.5), 0, 0]}>
          <mesh position={[0, -0.85, s * 0.75]} castShadow material={material}>
            <boxGeometry args={[2.6, 1.7, 1.5]} />
          </mesh>
        </group>
      ))}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.9, 2.1, 0]} rotation={[0, 0, s * 0.35]} material={material}>
          <boxGeometry args={[0.18, 1.4, 0.18]} />
        </mesh>
      ))}
    </group>
  );
}

/** A light that shows its colour by day and glows (and blooms) as night falls. */
function NavLight({ position, color, size = 0.32 }: { position: readonly [number, number, number]; color: string; size?: number }) {
  const { night } = useStage();
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color, toneMapped: true }), [color]);
  useLayoutEffect(() => {
    material.color.set(color).multiplyScalar(0.6 + night * 14);
  }, [material, color, night]);
  return (
    <mesh position={position as [number, number, number]} material={material}>
      <sphereGeometry args={[size, 12, 8]} />
    </mesh>
  );
}

/** The ensign's cloth waves in the vertex shader (more at the fly than at the hoist): no per-frame CPU work. */
function ensignMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: ensignTexture(), side: THREE.DoubleSide, roughness: 0.85 });
  const uniforms = { uTime: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float fly = -position.x / 3.0;
transformed.z += sin(position.x * 2.2 + uTime * 6.0) * 0.22 * fly;`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
objectNormal = normalize(vec3(-cos(position.x * 2.2 + uTime * 6.0) * 0.48 * (-position.x / 3.0), 0.0, 1.0));`
      );
  };
  m.customProgramCacheKey = () => "fw-ensign";
  return { material: m, uniforms };
}

function setEnsignTime(u: { uTime: { value: number } }, t: number) {
  u.uTime.value = t;
}

/** The ensign on the stern flagstaff, its cloth rippling in the wind. */
function Ensign({ x, y, height, animate }: { x: number; y: number; height: number; animate: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(3, 2, 12, 4);
    g.translate(-1.5, 0, 0); // hoist at the staff, flying aft
    return g;
  }, []);
  const { material, uniforms } = useMemo(() => ensignMaterial(), []);
  useFrame(({ clock }) => {
    if (animate) setEnsignTime(uniforms, clock.elapsedTime);
  });
  return (
    <group position={[x, y, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.09, height, 6]} />
        <meshStandardMaterial color="#d8dad5" roughness={0.5} />
      </mesh>
      <mesh geometry={geometry} material={material} position={[-0.05, height - 1.1, 0]} />
    </group>
  );
}

/** A rescue boat (open, orange) in its cradle under a single-arm davit. */
function RescueBoat({ b, paint }: { b: Layout["rescueBoat"]; paint: Paint }) {
  return (
    <group position={[b.x, b.y, b.z]}>
      <mesh rotation={[0, 0, Math.PI / 2]} scale={[0.75, 1, 1.25]} castShadow material={paint.orange}>
        <capsuleGeometry args={[0.9, b.length - 1.8, 4, 12]} />
      </mesh>
      <mesh position={[0, 0.55, 0]} material={paint.white}>
        <boxGeometry args={[b.length - 1.6, 0.1, 1.5]} />
      </mesh>
      {/* Davit: post and arm over the boat */}
      <mesh position={[0, 2.2, 1.8]} castShadow material={paint.white}>
        <boxGeometry args={[0.45, 4.6, 0.45]} />
      </mesh>
      <mesh position={[0, 4.3, 0.8]} rotation={[0.35, 0, 0]} castShadow material={paint.white}>
        <boxGeometry args={[0.4, 0.4, 2.4]} />
      </mesh>
      <mesh position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 3.2, 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}

/** The provision crane: a small knuckle crane on the accommodation side for stores. */
function ProvisionCrane({ c, paint }: { c: Layout["provisionCrane"]; paint: Paint }) {
  return (
    <group position={[c.x, c.y, c.z]}>
      <mesh position={[0, 1.2, 0]} castShadow material={paint.crane}>
        <cylinderGeometry args={[0.35, 0.45, 2.4, 10]} />
      </mesh>
      <mesh position={[1.9, 2.6, 0]} rotation={[0, 0, 0.3]} castShadow material={paint.crane}>
        <boxGeometry args={[4.2, 0.4, 0.4]} />
      </mesh>
    </group>
  );
}

/**
 * The fittings that make a bulk carrier read as a working ship up close:
 * stowed grabs by each crane, hold vents and air pipes, mooring winches and
 * fairleads fore and aft, liferafts, lifebuoys, the rescue boat and the
 * provision crane, accommodation ladders stowed along the side, pilot-ladder
 * reels, satellite domes and whistle, the ensign on its staff, and the
 * navigation and deck lights.
 */
export function Fittings({ layout, detail, paint, animate }: { layout: Layout; detail: "full" | "medium"; paint: Paint; animate: boolean }) {
  const { night } = useStage();
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f2f3ef", roughness: 0.35 }), []);
  const ropeDrum = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6b5a3f", roughness: 0.9 }), []);
  const buoy = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ff5a1f", roughness: 0.5 }), []);
  const flood = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff4dc" }), []);
  useLayoutEffect(() => {
    flood.color.set("#fff1d6").multiplyScalar(0.4 + night * 9);
  }, [flood, night]);

  const inst = useMemo(() => {
    const vents: THREE.Matrix4[] = [];
    const ventCaps: THREE.Matrix4[] = [];
    const winches: THREE.Matrix4[] = [];
    const drums: THREE.Matrix4[] = [];
    const chocks: THREE.Matrix4[] = [];
    const rafts: THREE.Matrix4[] = [];
    const buoys: THREE.Matrix4[] = [];
    const ladders: THREE.Matrix4[] = [];
    const reels: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    for (const v of layout.vents) {
      if (v.kind === "pipe") {
        vents.push(mat(v.x, v.y + 0.75, v.z, 0.35, 1.5, 0.35));
        ventCaps.push(mat(v.x, v.y + 1.6, v.z, 0.6, 0.35, 0.6));
      } else {
        vents.push(mat(v.x, v.y + 0.5, v.z, 0.7, 1.0, 0.7));
        ventCaps.push(mat(v.x, v.y + 1.1, v.z, 1.3, 0.4, 1.3));
      }
    }
    for (const w of layout.mooringWinches) {
      winches.push(mat(w.x, w.y + 0.6, w.z, 2.2, 1.2, 1.4));
      drums.push(mat(w.x, w.y + 0.95, w.z + Math.sign(w.z) * 1.3, 1.6, 1.4, 1.6, Math.PI / 2));
    }
    for (const c of layout.fairleads) chocks.push(mat(c.x, c.y + 0.45, c.z, 1.2, 0.9, 0.5));
    for (const r of layout.liferafts) rafts.push(mat(r.x, r.y + 0.35, r.z, 0.7, 1.5, 0.7, 0, 0, Math.PI / 2));
    for (const b of layout.lifebuoys) buoys.push(mat(b.x, b.y, b.z, 1, 1, 1, 0, 0, 0));
    for (const l of layout.accommodationLadders) {
      ladders.push(mat(l.x, l.y, l.z, l.length, 0.35, 0.9));
      ladders.push(mat(l.x, l.y + 0.55, l.z + l.side * 0.35, l.length, 0.06, 0.06));
    }
    for (const r of layout.pilotReels) reels.push(mat(r.x, r.y + 0.6, r.z, 1.2, 1.2, 0.9, Math.PI / 2));
    for (const f of layout.floodlights) lamps.push(mat(f[0], f[1], f[2], 0.35, 0.28, 0.5));
    return { vents, ventCaps, winches, drums, chocks, rafts, buoys, ladders, reels, lamps };
  }, [layout]);

  const torus = useMemo(() => new THREE.TorusGeometry(0.36, 0.1, 8, 16), []);
  const full = detail === "full";
  const nl = layout.navLights;

  return (
    <group>
      {layout.grabs.map((g, i) => (
        <Grab key={i} position={[g.x, g.y, g.z]} material={paint.steel} />
      ))}
      <Instances matrices={inst.vents} geometry={cyl} material={paint.cover} />
      <Instances matrices={inst.ventCaps} geometry={cyl} material={paint.cover} castShadow={false} />
      <Instances matrices={inst.winches} geometry={unit} material={paint.steel} />
      <Instances matrices={inst.drums} geometry={cyl} material={ropeDrum} />
      {full && <Instances matrices={inst.chocks} geometry={unit} material={paint.steel} castShadow={false} />}
      {full && <Instances matrices={inst.rafts} geometry={cyl} material={white} />}
      {full && <Instances matrices={inst.buoys} geometry={torus} material={buoy} castShadow={false} />}
      {full && <Instances matrices={inst.ladders} geometry={unit} material={paint.frame} castShadow={false} />}
      {full && <Instances matrices={inst.reels} geometry={cyl} material={paint.steel} castShadow={false} />}
      <Instances matrices={inst.lamps} geometry={unit} material={flood} castShadow={false} />
      {full && <RescueBoat b={layout.rescueBoat} paint={paint} />}
      {full && <ProvisionCrane c={layout.provisionCrane} paint={paint} />}
      {layout.satDomes.map((d, i) => (
        <group key={i} position={[d.x, d.y, d.z]}>
          <mesh position={[0, 0.5, 0]} material={paint.white}>
            <cylinderGeometry args={[0.12, 0.12, 1, 6]} />
          </mesh>
          <mesh position={[0, 1 + d.r * 0.8, 0]} castShadow material={white}>
            <sphereGeometry args={[d.r, 16, 12]} />
          </mesh>
        </group>
      ))}
      {/* Whistle on the front of the radar mast */}
      <mesh position={[layout.radarMast.x + 0.7, layout.radarMast.y + layout.radarMast.height * 0.55, 0]} rotation={[0, 0, -Math.PI / 2]} material={paint.steel}>
        <coneGeometry args={[0.35, 1.1, 10]} />
      </mesh>
      <Ensign x={layout.flagstaff.x} y={layout.flagstaff.y} height={layout.flagstaff.height} animate={animate} />
      {/* Navigation lights: masthead white, port red, starboard green, stern white */}
      <NavLight position={nl.mastheadFwd} color="#fffbe8" />
      <NavLight position={nl.mastheadAft} color="#fffbe8" />
      <NavLight position={nl.port} color="#ff2a1f" />
      <NavLight position={nl.starboard} color="#27ff6a" />
      <NavLight position={nl.stern} color="#fffbe8" />
      {/* At night, the deck floodlights light the hatches and the accommodation front. */}
      {night > 0.5 && full && (
        <>
          <pointLight position={[layout.accFront + 6, layout.accTop - 4, 0]} intensity={500 * night} distance={70} decay={2} color="#ffe2b0" />
          <pointLight position={[layout.foremast.x - 4, layout.foremast.y + layout.foremast.height * 0.6, 0]} intensity={220 * night} distance={45} decay={2} color="#ffe2b0" />
        </>
      )}
    </group>
  );
}

export { PAINT };
