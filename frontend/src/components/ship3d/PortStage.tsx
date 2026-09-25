import { useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Vector3 } from "three";
import { useShipColors } from "./colors";
import { Environment, SKY } from "./Environment";
import { type ShipSpec, arrangement } from "./hull";
import { Label } from "./Label";
import { PAINT, type Paint, asset, usePaint } from "./materials";
import { Ocean } from "./Ocean";
import { useStage } from "./quality";
import { Grab } from "./parts/Fittings";
import { Buoys, Surroundings } from "./Surroundings";
import { type WaveTrain, surfaceHeight } from "./waves";
import { Afloat, Controls, Seabed, Stage, useThemeSky } from "./ShipStage";
import { seaState } from "./waves";

export type PortView = "berth" | "anchorage" | "keel";

const QUAY_HEIGHT = 3.5; // quay deck above the water
const QUAY_APRON = 45; // width of the quay deck behind the face

/**
 * A shore grab unloader: a portal gantry on rails along the quay with a boom
 * reaching out over the ship, a trolley, and a grab hanging into the hold.
 */
function Unloader({ x, faceZ, reach, height, grabDepth, paint }: { x: number; faceZ: number; reach: number; height: number; grabDepth: number; paint: Paint }) {
  const frame = paint.frame;
  const house = paint.blue;
  const gauge = 22;
  const legZ = [faceZ - 3, faceZ - 3 - gauge];
  const boomY = QUAY_HEIGHT + height;
  const boomFrom = faceZ - gauge - 18;
  const boomTo = faceZ + reach;
  const trolleyZ = faceZ + reach * 0.62;
  const grabTop = boomY - 2;
  const grabY = Math.max(-grabDepth, QUAY_HEIGHT - 6);
  return (
    <group position={[x, 0, 0]}>
      {legZ.map((z) =>
        [-7, 7].map((dx) => (
          <mesh key={`${z}${dx}`} position={[dx, QUAY_HEIGHT + height / 2, z]} castShadow material={frame}>
            <boxGeometry args={[1.4, height, 1.4]} />
          </mesh>
        ))
      )}
      {/* Portal beams */}
      {legZ.map((z) => (
        <mesh key={z} position={[0, boomY - 3, z]} castShadow material={frame}>
          <boxGeometry args={[16, 2.2, 2]} />
        </mesh>
      ))}
      <mesh position={[0, boomY - 3, faceZ - 3 - gauge / 2]} castShadow material={frame}>
        <boxGeometry args={[2, 2.2, gauge]} />
      </mesh>
      {/* Boom: two girders from the back stay to the tip over the ship */}
      {[-3, 3].map((dx) => (
        <mesh key={dx} position={[dx, boomY, (boomFrom + boomTo) / 2]} castShadow material={frame}>
          <boxGeometry args={[1.2, 2.4, boomTo - boomFrom]} />
        </mesh>
      ))}
      {/* Machinery house and operator cab */}
      <mesh position={[0, boomY + 3.5, faceZ - gauge - 8]} castShadow material={house}>
        <boxGeometry args={[12, 6, 14]} />
      </mesh>
      <mesh position={[4, boomY - 3.5, trolleyZ - 4]} castShadow material={house}>
        <boxGeometry args={[3, 3, 3.5]} />
      </mesh>
      {/* A-frame and stays */}
      <mesh position={[0, boomY + 9, faceZ - 6]} castShadow material={frame}>
        <boxGeometry args={[1.2, 18, 1.2]} />
      </mesh>
      {/* Trolley, wires and grab */}
      <mesh position={[0, boomY - 1.8, trolleyZ]} castShadow material={frame}>
        <boxGeometry args={[7, 1.6, 5]} />
      </mesh>
      <mesh position={[0, (grabTop + grabY) / 2, trolleyZ]}>
        <cylinderGeometry args={[0.08, 0.08, grabTop - grabY, 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <group scale={1.5}>
        <Grab position={[0, (grabY - 3.4) / 1.5, trolleyZ / 1.5]} open={0.2} material={paint.steel} />
      </group>
      {/* Hopper on the quay side of the portal, feeding the conveyor */}
      <mesh position={[0, QUAY_HEIGHT + height * 0.45, faceZ - 3 - gauge * 0.35]} castShadow material={paint.steel}>
        <cylinderGeometry args={[4.5, 1.6, 6, 4, 1, true]} />
      </mesh>
    </group>
  );
}

/**
 * A mobile harbour crane (Liebherr LHM type): a wheeled undercarriage with
 * outriggers, a tall tower with the cab near the top, and a long lattice-look
 * boom luffed out over the ship with a grab on the hoist ropes.
 */
function HarbourCrane({ x, faceZ, reach, paint, grabY }: { x: number; faceZ: number; reach: number; paint: Paint; grabY: number }) {
  const baseZ = faceZ - 12;
  const towerTop = QUAY_HEIGHT + 30;
  const tipZ = faceZ + reach;
  const tipY = towerTop + 16;
  const boomLen = Math.hypot(tipZ - baseZ, tipY - (towerTop - 4));
  const boomAngle = Math.atan2(tipY - (towerTop - 4), tipZ - baseZ);
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, QUAY_HEIGHT + 2, baseZ]} castShadow material={paint.blue}>
        <boxGeometry args={[12, 3.5, 10]} />
      </mesh>
      {[[-7, -6], [7, -6], [-7, 6], [7, 6]].map(([dx, dz], i) => (
        <mesh key={i} position={[dx, QUAY_HEIGHT + 0.6, baseZ + dz]} material={paint.steel}>
          <boxGeometry args={[2, 1.2, 2]} />
        </mesh>
      ))}
      <mesh position={[0, (QUAY_HEIGHT + 3 + towerTop) / 2, baseZ]} castShadow material={paint.frame}>
        <boxGeometry args={[3.4, towerTop - QUAY_HEIGHT - 3, 3.4]} />
      </mesh>
      <mesh position={[2.6, towerTop - 3, baseZ + 1.5]} castShadow material={paint.blue}>
        <boxGeometry args={[2.4, 2.6, 2.6]} />
      </mesh>
      <mesh position={[0, towerTop - 4 + (Math.sin(boomAngle) * boomLen) / 2, baseZ + (Math.cos(boomAngle) * boomLen) / 2]} rotation={[-boomAngle, 0, 0]} castShadow material={paint.frame}>
        <boxGeometry args={[1.8, 1.8, boomLen]} />
      </mesh>
      <mesh position={[0, (tipY + grabY) / 2, tipZ]}>
        <cylinderGeometry args={[0.07, 0.07, Math.max(0.1, tipY - grabY), 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <Grab position={[0, grabY - 3, tipZ]} open={0.3} material={paint.steel} />
    </group>
  );
}

/** A floating crane: a pontoon with a slewing crane, alongside the ship at anchor, and the barge it loads. */
function FloatingCrane({ x, z, paint, waves, animate }: { x: number; z: number; paint: Paint; waves: WaveTrain[]; animate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = surfaceHeight(waves, x, z, animate ? clock.elapsedTime : 0) - 1.2;
  });
  return (
    <group ref={ref} position={[x, 0, z]}>
      <mesh position={[0, 1.6, 0]} castShadow material={paint.topsides}>
        <boxGeometry args={[60, 4.4, 22]} />
      </mesh>
      <mesh position={[8, 6, 0]} castShadow material={paint.white}>
        <boxGeometry args={[12, 6, 12]} />
      </mesh>
      <mesh position={[-4, 20, -9]} rotation={[0.65, 0, 0]} castShadow material={paint.crane}>
        <boxGeometry args={[1.8, 1.8, 42]} />
      </mesh>
      <Grab position={[-4, 18, -24]} open={0.4} material={paint.steel} />
      {/* The barge on the far side, part loaded */}
      <mesh position={[0, 0.8, 22]} castShadow material={paint.steel}>
        <boxGeometry args={[70, 3.4, 16]} />
      </mesh>
      <mesh position={[0, 2.4, 22]}>
        <boxGeometry args={[64, 0.4, 12]} />
        <meshStandardMaterial color="#17171a" roughness={1} />
      </mesh>
    </group>
  );
}

/** A harbour tug pushing on the ship's side: small hull, high wheelhouse, fendered bow. */
function Tug({ x, z, heading, waves, animate, paint, bob = 0 }: { x: number; z: number; heading: number; waves: WaveTrain[]; animate: boolean; paint: Paint; bob?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = animate ? clock.elapsedTime : 0;
    if (!ref.current) return;
    ref.current.position.y = surfaceHeight(waves, x, z, t) - 0.9;
    ref.current.rotation.z = Math.sin(t * 1.1 + bob) * 0.04;
  });
  return (
    <group ref={ref} position={[x, 0, z]} rotation={[0, heading, 0]}>
      <mesh position={[0, 1.2, 0]} castShadow material={paint.topsides}>
        <boxGeometry args={[30, 3.6, 11]} />
      </mesh>
      <mesh position={[0, 3.2, 0]} material={paint.orange}>
        <boxGeometry args={[30.4, 0.4, 11.4]} />
      </mesh>
      <mesh position={[3, 5.2, 0]} castShadow material={paint.white}>
        <boxGeometry args={[8, 3.6, 7]} />
      </mesh>
      <mesh position={[4, 8.2, 0]} castShadow material={paint.white}>
        <boxGeometry args={[5, 2.4, 6]} />
      </mesh>
      <mesh position={[-2, 8, 0]} material={paint.orange}>
        <cylinderGeometry args={[0.9, 1.1, 3, 10]} />
      </mesh>
      <mesh position={[15.6, 1.4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[1.6, 1.6, 1.2, 12]} />
        <meshStandardMaterial color="#141414" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** The pilot boat circling out in the roads, orange hull with "PILOT" on its wheelhouse. */
function PilotBoat({ radius, cz, waves, animate, paint }: { radius: number; cz: number; waves: WaveTrain[]; animate: boolean; paint: Paint }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = animate ? clock.elapsedTime * 0.05 : 0.8;
    if (!ref.current) return;
    const x = Math.cos(t) * radius;
    const z = cz + Math.sin(t) * radius * 0.5;
    ref.current.position.set(x, surfaceHeight(waves, x, z, animate ? clock.elapsedTime : 0) - 0.4, z);
    ref.current.rotation.y = -t - Math.PI / 2;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.8, 0]} castShadow material={paint.orange}>
        <boxGeometry args={[16, 2, 5]} />
      </mesh>
      <mesh position={[-1, 2.6, 0]} castShadow material={paint.white}>
        <boxGeometry args={[5, 2, 3.6]} />
      </mesh>
    </group>
  );
}

/** A rubble-mound breakwater sheltering the berth, with its lighthouse at the head. */
function Breakwater({ fromX, toX, z, paint }: { fromX: number; toX: number; z: number; paint: Paint }) {
  const { night } = useStage();
  const lamp = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff4d0" }), []);
  useFrame(({ clock }) => {
    const on = Math.sin(clock.elapsedTime * 1.6) > 0.6 ? 1 : 0.1;
    lamp.color.set("#fff4d0").multiplyScalar(0.8 + on * (1 + night * 12));
  });
  const length = Math.abs(toX - fromX);
  const rocks = useMemo(() => new THREE.MeshStandardMaterial({ color: "#7c7a74", roughness: 1, flatShading: true }), []);
  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(6, 16, 9, 7, 1, false);
    g.rotateZ(Math.PI / 2);
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={geometry} position={[(fromX + toX) / 2, 0.5, z]} scale={[length / 9, 1, 1]} rotation={[0, 0, 0]} material={rocks} castShadow receiveShadow />
      <group position={[toX, 4.5, z]}>
        <mesh position={[0, 9, 0]} castShadow>
          <cylinderGeometry args={[1.6, 2.4, 18, 16]} />
          <meshStandardMaterial color="#f1f0ea" roughness={0.6} />
        </mesh>
        {[3, 9, 15].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[2.35 - y * 0.042, 2.4 - y * 0.042, 2.2, 16]} />
            <meshStandardMaterial color="#b3261e" roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, 19.2, 0]} material={lamp}>
          <cylinderGeometry args={[1.1, 1.1, 1.6, 12]} />
        </mesh>
        <mesh position={[0, 20.6, 0]} material={paint.steel}>
          <coneGeometry args={[1.5, 1.4, 12]} />
        </mesh>
      </group>
    </group>
  );
}

/** A stacker-reclaimer on its rails between two stockpiles: turret, counterweight, boom and bucket wheel. */
function StackerReclaimer({ x, z, y, paint, slew }: { x: number; z: number; y: number; paint: Paint; slew: number }) {
  return (
    <group position={[x, y, z]} rotation={[0, slew, 0]}>
      <mesh position={[0, 3, 0]} castShadow material={paint.frame}>
        <boxGeometry args={[10, 6, 9]} />
      </mesh>
      <mesh position={[0, 9, 0]} castShadow material={paint.crane}>
        <boxGeometry args={[6, 6, 6]} />
      </mesh>
      <mesh position={[-14, 12, 0]} rotation={[0, 0, -0.18]} castShadow material={paint.crane}>
        <boxGeometry args={[20, 1.6, 2]} />
      </mesh>
      <mesh position={[-24, 10.5, 0]} castShadow material={paint.steel}>
        <boxGeometry args={[4, 4, 4]} />
      </mesh>
      <mesh position={[21, 8, 0]} rotation={[0, 0, 0.12]} castShadow material={paint.crane}>
        <boxGeometry args={[40, 1.8, 2.2]} />
      </mesh>
      <mesh position={[41, 10.4, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow material={paint.steel}>
        <torusGeometry args={[3.4, 0.6, 8, 20]} />
      </mesh>
    </group>
  );
}

/** Rail siding behind the yard: track, a rake of BOXN open wagons loaded with coal, and the locomotive. */
function RailSiding({ z, y, length }: { z: number; y: number; length: number }) {
  const wagons = Math.min(16, Math.floor(length / 11));
  const wagonRef = useRef<THREE.InstancedMesh>(null);
  const coalRef = useRef<THREE.InstancedMesh>(null);
  const sleeperRef = useRef<THREE.InstancedMesh>(null);
  const sleepers = Math.floor(length / 1.6);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useLayoutEffect(() => {
    for (let i = 0; i < wagons; i++) {
      const x = -length / 2 + 30 + i * 10.7;
      m.makeTranslation(x, y + 2.1, z);
      wagonRef.current?.setMatrixAt(i, m);
      m.makeTranslation(x, y + 3.35, z);
      coalRef.current?.setMatrixAt(i, m);
    }
    for (let i = 0; i < sleepers; i++) {
      m.makeTranslation(-length / 2 + i * 1.6, y + 0.1, z);
      sleeperRef.current?.setMatrixAt(i, m);
    }
    [wagonRef, coalRef, sleeperRef].forEach((r) => r.current && (r.current.instanceMatrix.needsUpdate = true));
  }, [wagons, sleepers, length, y, z, m]);
  return (
    <group>
      {[0.84, -0.84].map((dz) => (
        <mesh key={dz} position={[0, y + 0.3, z + dz]}>
          <boxGeometry args={[length, 0.18, 0.12]} />
          <meshStandardMaterial color="#6e6a64" metalness={0.7} roughness={0.35} />
        </mesh>
      ))}
      <instancedMesh ref={sleeperRef} args={[undefined, undefined, sleepers]} receiveShadow>
        <boxGeometry args={[0.3, 0.2, 2.6]} />
        <meshStandardMaterial color="#5d5850" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={wagonRef} args={[undefined, undefined, wagons]} castShadow>
        <boxGeometry args={[10, 2.6, 3.1]} />
        <meshStandardMaterial color="#6d3326" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={coalRef} args={[undefined, undefined, wagons]}>
        <boxGeometry args={[9.6, 0.3, 2.8]} />
        <meshStandardMaterial color="#141416" roughness={1} />
      </instancedMesh>
      {/* WDG-4 type diesel locomotive at the head of the rake */}
      <group position={[-length / 2 + 16, y, z]}>
        <mesh position={[0, 2.4, 0]} castShadow>
          <boxGeometry args={[21, 3.6, 3.1]} />
          <meshStandardMaterial color="#1c4f8a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 3.6, 0]}>
          <boxGeometry args={[21.2, 0.35, 3.2]} />
          <meshStandardMaterial color="#e1a82b" roughness={0.6} />
        </mesh>
        <mesh position={[9, 4.6, 0]} castShadow>
          <boxGeometry args={[3, 1.2, 3.1]} />
          <meshStandardMaterial color="#1c4f8a" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

/** Floodlight towers round the yard, lit at dusk. */
function LightTowers({ points, height }: { points: [number, number, number][]; height: number }) {
  const { night } = useStage();
  const lamp = useMemo(() => new THREE.MeshBasicMaterial({ color: "#fff1d6" }), []);
  useLayoutEffect(() => {
    lamp.color.set("#fff1d6").multiplyScalar(0.3 + night * 10);
  }, [lamp, night]);
  return (
    <group>
      {points.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh position={[0, height / 2, 0]} castShadow>
            <cylinderGeometry args={[0.35, 0.6, height, 8]} />
            <meshStandardMaterial color="#8d9296" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[0, height + 0.6, 0]} material={lamp}>
            <boxGeometry args={[3.2, 1.2, 1.2]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A texture set with its own repeat (the loaded maps are shared, so each use clones them). */
function useSurface(name: "concrete" | "gravel", repeat: [number, number]) {
  const maps = useTexture({ map: asset(`${name}-color.jpg`), normalMap: asset(`${name}-normal.jpg`), roughnessMap: asset(`${name}-roughness.jpg`) });
  return useMemo(() => {
    const out: Record<string, THREE.Texture> = {};
    for (const [k, t] of Object.entries(maps as Record<string, THREE.Texture>)) {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      c.anisotropy = 8;
      c.colorSpace = k === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      c.needsUpdate = true;
      out[k] = c;
    }
    return out as { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture };
  }, [maps, repeat[0], repeat[1]]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The berth and the terminal behind it: quay wall down to the seabed, deck,
 * fenders, bollards and crane rails; conveyor galleries to the yard; coal
 * stockpiles worked by stacker-reclaimers; the rail siding with a rake of
 * wagons for the plant; floodlight towers and terminal buildings.
 */
function Quay({ length, faceZ, depth, paint }: { length: number; faceZ: number; depth: number; paint: Paint }) {
  const concreteMaps = useSurface("concrete", [length / 10, QUAY_APRON / 10]);
  const coalMaps = useSurface("gravel", [8, 3]);
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ ...concreteMaps, color: "#b9b6ae", roughness: 1 }), [concreteMaps]);
  const coal = useMemo(() => new THREE.MeshStandardMaterial({ ...coalMaps, color: "#2a2a2c", roughness: 1 }), [coalMaps]);
  const fenders = Math.floor(length / 16);
  const yardZ = faceZ - QUAY_APRON - 45;
  const railZ = faceZ - QUAY_APRON - 120;
  return (
    <group>
      {/* Wall and deck as one block, from below the seabed up to the quay deck */}
      <mesh position={[0, (QUAY_HEIGHT - depth - 2) / 2, faceZ - QUAY_APRON / 2]} receiveShadow castShadow material={concrete}>
        <boxGeometry args={[length, QUAY_HEIGHT + depth + 2, QUAY_APRON]} />
      </mesh>
      {/* Land behind */}
      <mesh position={[0, QUAY_HEIGHT - 0.3, faceZ - QUAY_APRON - 150]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[length * 3, 300]} />
        <meshStandardMaterial color="#6f6a5e" roughness={1} />
      </mesh>
      {Array.from({ length: fenders }, (_, i) => (
        <mesh key={i} position={[-length / 2 + 8 + i * 16, QUAY_HEIGHT - 2.2, faceZ + 0.9]} castShadow>
          <cylinderGeometry args={[0.9, 0.9, 3.5, 12]} />
          <meshStandardMaterial color={PAINT.fender} roughness={0.9} />
        </mesh>
      ))}
      {Array.from({ length: fenders }, (_, i) => (
        <mesh key={`b${i}`} position={[-length / 2 + 16 + i * 16, QUAY_HEIGHT + 0.4, faceZ - 1.5]} castShadow material={paint.steel}>
          <cylinderGeometry args={[0.4, 0.5, 0.8, 10]} />
        </mesh>
      ))}
      {/* Crane rails */}
      {[3, 25].map((d) => (
        <mesh key={d} position={[0, QUAY_HEIGHT + 0.1, faceZ - d]}>
          <boxGeometry args={[length, 0.2, 0.4]} />
          <meshStandardMaterial color="#555" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* Conveyor along the quay and galleries on trestles to the yard */}
      <mesh position={[0, QUAY_HEIGHT + 1.4, faceZ - 30]} castShadow material={paint.frame}>
        <boxGeometry args={[length, 1.6, 2.4]} />
      </mesh>
      {[-0.25, 0.2].map((fx) => (
        <group key={fx}>
          <mesh position={[length * fx, QUAY_HEIGHT + 9, faceZ - QUAY_APRON - 10]} rotation={[0.09, 0, 0]} castShadow material={paint.frame}>
            <boxGeometry args={[3, 2.6, 60]} />
          </mesh>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={[length * fx, QUAY_HEIGHT + 4, faceZ - QUAY_APRON + 12 - k * 20]} material={paint.steel}>
              <boxGeometry args={[1.2, 8 + k * 2, 1.2]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Coal stockpiles, long ridges in the yard, with a stacker-reclaimer between them */}
      {[-0.3, 0.12].map((fx, i) => (
        <mesh key={i} position={[length * fx, QUAY_HEIGHT, yardZ - i * 34]} scale={[length * 0.18, 1, 1]} castShadow receiveShadow material={coal}>
          <coneGeometry args={[1, 14, 32, 1, false, 0, Math.PI * 2]} />
        </mesh>
      ))}
      <StackerReclaimer x={-length * 0.08} z={yardZ - 17} y={QUAY_HEIGHT} paint={paint} slew={0.35} />
      <RailSiding z={railZ} y={QUAY_HEIGHT - 0.2} length={length * 0.9} />
      <LightTowers
        height={32}
        points={[
          [-length * 0.4, QUAY_HEIGHT, faceZ - QUAY_APRON + 4],
          [length * 0.05, QUAY_HEIGHT, faceZ - QUAY_APRON + 4],
          [length * 0.42, QUAY_HEIGHT, faceZ - QUAY_APRON + 4],
          [length * 0.3, QUAY_HEIGHT, yardZ - 30],
        ]}
      />
      {/* Terminal buildings: control building and a workshop */}
      <mesh position={[length * 0.46, QUAY_HEIGHT + 7, faceZ - QUAY_APRON - 20]} castShadow material={paint.white}>
        <boxGeometry args={[22, 14, 16]} />
      </mesh>
      <mesh position={[-length * 0.46, QUAY_HEIGHT + 5, faceZ - QUAY_APRON - 26]} castShadow material={paint.blue}>
        <boxGeometry args={[34, 10, 22]} />
      </mesh>
    </group>
  );
}

/** How many unloading machines to draw from the port's equipment line ("5 grab ship unloaders…"), at most one per hatch pair. */
function machineCount(equipment: string | null | undefined, hatches: number) {
  const n = Number(/(\d+)\s+(grab|mobile)/i.exec(equipment ?? "")?.[1] ?? 2);
  return Math.max(1, Math.min(Math.ceil(hatches / 2), n));
}

/** A vertical measure from the keel to the seabed, with its label. */
function Clearance({ x, z, keel, seabed, text }: { x: number; z: number; keel: number; seabed: number; text: string }) {
  const colors = useShipColors();
  const top = Math.max(keel, seabed);
  const bottom = Math.min(keel, seabed);
  const color = keel < seabed ? "#d9534f" : "#3fb37f";
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, (top + bottom) / 2, 0]}>
        <cylinderGeometry args={[0.35, 0.35, Math.max(0.05, top - bottom), 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {[top, bottom].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[5, 0.3, 0.3]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
      <Label text={text} position={[0, (top + bottom) / 2, 4]} color={colors.label} background={colors.labelBackground} height={5.5} />
    </group>
  );
}

/** Eases the camera to a pose whenever `poseKey` changes. */
function PoseRig({ position, target, poseKey, animate }: { position: Vector3; target: Vector3; poseKey: string; animate: boolean }) {
  const get = useThree((s) => s.get);
  const invalidate = useStage().kick;
  const goal = useRef<{ position: Vector3; target: Vector3; t: number } | null>(null);
  useEffect(() => {
    goal.current = { position: position.clone(), target: target.clone(), t: animate ? 0 : 1 };
    invalidate();
    // Only a new pose (not a new Vector3 of the same pose) moves the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseKey, animate, invalidate]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g) return;
    const { camera, controls: ctl } = get();
    const controls = ctl as unknown as { target: Vector3; update: () => void } | null;
    g.t = Math.min(1, g.t + dt / 1.1);
    const k = g.t >= 1 ? 1 : 1 - (1 - g.t) ** 3;
    camera.position.lerp(g.position, k);
    controls?.target.lerp(g.target, k);
    controls?.update();
    if (g.t >= 1) goal.current = null;
    else invalidate();
  });
  return null;
}

/** Anchorage spots: a loose grid offshore, every ship lying to the same wind. */
function anchorage(n: number, spacing: number) {
  const out: [number, number][] = [];
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // A little scatter so it doesn't look like a car park.
    const jx = Math.sin(i * 12.9898) * spacing * 0.18;
    const jz = Math.cos(i * 78.233) * spacing * 0.18;
    out.push([(c - (cols - 1) / 2) * spacing + jx + (r % 2) * spacing * 0.5, 650 + r * spacing * 0.8 + jz]);
  }
  return out;
}

/** Everything in the port scene that needs the loaded textures (inside the canvas's Suspense). */
function PortContents({
  spec,
  draft,
  usable,
  berth,
  waves,
  look,
  sky,
  animate,
  quayLength,
  faceZ,
  top,
  unloaders,
  handling,
}: {
  spec: ShipSpec;
  draft: number;
  usable: number;
  berth: boolean;
  waves: WaveTrain[];
  look: { deep: string; shallow: string; clarity?: number };
  sky: ReturnType<typeof useThemeSky>;
  animate: boolean;
  quayLength: number;
  faceZ: number;
  top: number;
  unloaders: { x: number }[];
  handling: "grab_unloaders" | "mobile_harbour_cranes" | "floating_cranes" | null;
}) {
  const paint = usePaint();
  const L = spec.loa_m;
  const B = spec.beam_m;
  const grabY = Math.max(-draft * 0.4, QUAY_HEIGHT - 6);
  const buoys = useMemo(
    () => [0, 1, 2].flatMap((i) => [
      { x: -L * 0.2 + i * 160, z: B * 3 + 140, side: "port" as const },
      { x: -L * 0.2 + i * 160, z: B * 3 + 260, side: "starboard" as const },
    ]),
    [L, B]
  );
  return (
    <>
      <Environment preset={sky} shadowSize={L * 0.75} animate={animate} />
      <Ocean waves={waves} look={look} animate={animate} />
      <Afloat spec={spec} draft={draft} waves={waves} animate={animate} working={berth} />
      <Surroundings waves={waves} animate={animate} around={L} coast={false} />
      <Buoys positions={buoys} waves={waves} animate={animate} />
      <PilotBoat radius={L * 1.6} cz={B * 3 + 420} waves={waves} animate={animate} paint={paint} />
      {berth ? (
        <>
          <Quay length={quayLength} faceZ={faceZ} depth={usable + 3} paint={paint} />
          {unloaders.map((h, i) =>
            handling === "mobile_harbour_cranes" ? (
              <HarbourCrane key={i} x={h.x - L / 2} faceZ={faceZ} reach={B * 0.55} paint={paint} grabY={grabY} />
            ) : (
              <Unloader key={i} x={h.x - L / 2} faceZ={faceZ} reach={B * 0.62} height={Math.max(26, top + 8)} grabDepth={draft * 0.4} paint={paint} />
            )
          )}
          <Breakwater fromX={quayLength * 0.2} toX={quayLength * 0.95} z={B * 2.2 + 80} paint={paint} />
          <Tug x={L * 0.3} z={B / 2 + 17} heading={Math.PI / 2} waves={waves} animate={animate} paint={paint} />
          <Tug x={-L * 0.32} z={B / 2 + 17} heading={Math.PI / 2} waves={waves} animate={animate} paint={paint} bob={1.3} />
        </>
      ) : (
        handling === "floating_cranes" && <FloatingCrane x={L * 0.05} z={B / 2 + 14} paint={paint} waves={waves} animate={animate} />
      )}
    </>
  );
}

/**
 * A port in 3D: the ship alongside the berth (a quay as long as the port's
 * largest ship) under the grab unloaders, the seabed at this month's usable
 * depth with the gap under the keel measured, and the ships typically
 * waiting at anchor offshore. `view` picks the camera: the berth, the
 * anchorage, or below the water beside the keel.
 */
export function PortScene({
  spec,
  draft,
  usable,
  hs,
  berth,
  maxLoa,
  queue,
  queueSpecs,
  view,
  clearanceText,
  height = 440,
  animate = true,
  label,
  handling = "grab_unloaders",
  equipment,
}: {
  /** How the port discharges coal, and its equipment line from the data. */
  handling?: "grab_unloaders" | "mobile_harbour_cranes" | "floating_cranes" | null;
  equipment?: string | null;
  spec: ShipSpec;
  draft: number;
  usable: number;
  hs: number;
  /** A quay to lie alongside; false for an offshore anchorage port. */
  berth: boolean;
  maxLoa: number | null;
  queue: number;
  queueSpecs: ShipSpec[];
  view: PortView;
  clearanceText: string;
  height?: number;
  animate?: boolean;
  label?: string;
}) {
  const sky = useThemeSky();
  // The berth is sheltered by breakwaters: the harbour sea is calmer than the offshore forecast.
  const waves = useMemo(() => seaState(Math.max(0.1, hs * 0.45)), [hs]);
  const look = useMemo(() => ({ ...SKY[sky].sea, clarity: 0.6 }), [sky]);
  const L = spec.loa_m;
  const B = spec.beam_m;
  const faceZ = -(B / 2 + 2.6);
  const quayLength = Math.max(L * 1.25, maxLoa ? maxLoa * 1.1 : 0);
  const layout = arrangement(spec);
  const top = layout.topHeight - draft;
  // Shore machines spread over the hatches, as many as the port has (one per hatch pair at most).
  const count = machineCount(equipment, layout.hatches.length);
  const unloaders = layout.hatches.filter((_, i) => i % 2 === 1).slice(0, count);
  const spots = useMemo(() => anchorage(queue, Math.max(...queueSpecs.map((s) => s.loa_m), L) * 1.35), [queue, queueSpecs, L]);
  const pose = useMemo(() => {
    if (view === "anchorage") return { target: new Vector3(0, 0, 700), position: new Vector3(-L * 2.2, L * 0.9, -L * 0.8) };
    if (view === "keel") return { target: new Vector3(0, -draft - 1, 0), position: new Vector3(L * 0.78, -draft * 0.6, B * 1.6) };
    return { target: new Vector3(0, top * 0.25, faceZ / 2), position: new Vector3(-L * 0.62, top * 1.5 + 20, L * 0.95) };
  }, [view, L, B, draft, top, faceZ]);
  return (
    <Stage animated={animate} height={height} label={label}>
      <PortContents
        spec={spec}
        draft={draft}
        usable={usable}
        berth={berth}
        waves={waves}
        look={look}
        sky={sky}
        animate={animate}
        quayLength={quayLength}
        faceZ={faceZ}
        top={top}
        unloaders={unloaders}
        handling={handling}
      />
      <Seabed depth={usable} size={[quayLength * 1.4, 420]} />
      <Clearance x={L * 0.12} z={B / 2 + 5} keel={-draft} seabed={-usable} text={clearanceText} />
      {spots.map(([x, z], i) => {
        const s = queueSpecs[i % queueSpecs.length];
        return <Afloat key={i} spec={s} draft={s.draft_laden_m} waves={waves} animate={animate} detail="medium" at={[x, z]} />;
      })}
      <PoseRig position={pose.position} target={pose.target} poseKey={`${view}:${spec.name}`} animate={animate} />
      <Controls maxDistance={4500} />
    </Stage>
  );
}
