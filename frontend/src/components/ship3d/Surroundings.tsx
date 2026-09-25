import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useStage } from "./quality";
import { type WaveTrain, surfaceHeight } from "./waves";

/** A deterministic pseudo-random sequence, so the scene is the same every visit. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Other ships far off: simple bulk-carrier silhouettes near the horizon, hazed by distance. */
function HorizonShips({ count = 6, animate }: { count?: number; animate: boolean }) {
  const hulls = useRef<THREE.InstancedMesh>(null);
  const houses = useRef<THREE.InstancedMesh>(null);
  const ships = useMemo(() => {
    const r = rng(42);
    return Array.from({ length: count }, () => {
      const angle = r() * Math.PI * 2;
      const dist = 1400 + r() * 1500;
      return { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, heading: r() * Math.PI, length: 160 + r() * 130, speed: 2 + r() * 4 };
    });
  }, [count]);
  const hullMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#26303a", roughness: 0.7 }), []);
  const houseMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#dfe2dc", roughness: 0.6 }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(), back: new THREE.Vector3(), q: ships.map((s) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.heading, 0))) }), [ships]);
  const place = (t: number) => {
    const { m, p, s: sc, back } = tmp;
    ships.forEach((s, i) => {
      const q = tmp.q[i];
      const dx = Math.cos(s.heading) * s.speed * t;
      const dz = -Math.sin(s.heading) * s.speed * t;
      m.compose(p.set(s.x + dx, s.length * 0.035, s.z + dz), q, sc.set(s.length, s.length * 0.07, s.length * 0.15));
      hulls.current?.setMatrixAt(i, m);
      back.set(-s.length * 0.42, 0, 0).applyQuaternion(q);
      m.compose(p.set(s.x + dx + back.x, s.length * 0.11, s.z + dz + back.z), q, sc.set(s.length * 0.07, s.length * 0.09, s.length * 0.11));
      houses.current?.setMatrixAt(i, m);
    });
    if (hulls.current) hulls.current.instanceMatrix.needsUpdate = true;
    if (houses.current) houses.current.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => place(0));
  useFrame(({ clock }) => {
    if (animate) place(clock.elapsedTime);
  });
  return (
    <group>
      <instancedMesh ref={hulls} args={[undefined, hullMat, count]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <instancedMesh ref={houses} args={[undefined, houseMat, count]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </group>
  );
}

/** A low coastline along part of the horizon, ridged hills fading into the haze. */
function Coastline({ distance = 3750, span = Math.PI * 0.4, heading = 2.9 }: { distance?: number; span?: number; heading?: number }) {
  const geometry = useMemo(() => {
    const segs = 160;
    const positions: number[] = [];
    const indices: number[] = [];
    const r = rng(7);
    const bumps = Array.from({ length: 12 }, () => ({ f: 2 + r() * 14, p: r() * 6, a: r() }));
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const a = heading - span / 2 + span * u;
      const edge = Math.sin(u * Math.PI) ** 0.6;
      // Low hills, 10-35 m, so at this distance they sit just above the horizon in the haze.
      const h = (18 + bumps.reduce((s, b) => s + b.a * 14 * Math.sin(u * b.f + b.p), 0) * 0.5) * edge;
      const x = Math.cos(a) * distance;
      const z = Math.sin(a) * distance;
      positions.push(x, -2, z, x * 1.03, Math.max(4, h), z * 1.03);
      if (i < segs) {
        const k = i * 2;
        indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [distance, span, heading]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#6f7d78" roughness={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Seagulls wheeling over the ship: instanced gull shapes flapping on their circles. */
function Gulls({ count = 14, radius, height, animate }: { count?: number; radius: number; height: number; animate: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    // Two swept wings and a body, in the x-z plane (x forward).
    const g = new THREE.BufferGeometry();
    const v = [0.4, 0, 0, -0.5, 0, 0, 0, 0, 0.9, 0.4, 0, 0, 0, 0, -0.9, -0.5, 0, 0, 0.2, 0, 0.9, -0.3, 0, 1.4, 0, 0, 0.9, 0.2, 0, -0.9, 0, 0, -0.9, -0.3, 0, -1.4];
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f3f3f0", side: THREE.DoubleSide, roughness: 0.8 }), []);
  const birds = useMemo(() => {
    const r = rng(99);
    return Array.from({ length: count }, () => ({ r: radius * (0.25 + r() * 0.6), h: height * (0.7 + r() * 0.8), speed: 0.12 + r() * 0.1, phase: r() * Math.PI * 2, flap: 5 + r() * 3, dir: r() > 0.5 ? 1 : -1, cx: (r() - 0.5) * radius * 0.4 }));
  }, [count, radius, height]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const place = (t: number) => {
    const { m, q, e, p, s: sc } = tmp;
    birds.forEach((b, i) => {
      const a = b.phase + t * b.speed * b.dir;
      const flap = Math.sin(t * b.flap + b.phase) * 0.55;
      q.setFromEuler(e.set(flap * 0.2, -a - (b.dir * Math.PI) / 2, Math.sin(a) * 0.15));
      m.compose(p.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 0.7 + b.phase) * 3, Math.sin(a) * b.r), q, sc.set(1.1, 1 + flap, 1.1));
      ref.current?.setMatrixAt(i, m);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => place(0));
  useFrame(({ clock }) => {
    if (animate) place(clock.elapsedTime);
  });
  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />;
}

/** Channel buoys (red to port, green to starboard coming in), riding the waves, lights blinking. */
export function Buoys({ positions, waves, animate }: { positions: { x: number; z: number; side: "port" | "starboard" }[]; waves: WaveTrain[]; animate: boolean }) {
  const { night } = useStage();
  const group = useRef<THREE.Group>(null);
  const lamps = useMemo(
    () => positions.map((p) => new THREE.MeshBasicMaterial({ color: p.side === "port" ? "#ff3322" : "#33ff66" })),
    [positions]
  );
  useFrame(({ clock }) => {
    const t = animate ? clock.elapsedTime : 0;
    group.current?.children.forEach((c, i) => {
      const p = positions[i];
      c.position.y = surfaceHeight(waves, p.x, p.z, t) - 0.6;
      c.rotation.z = Math.sin(t * 1.3 + i) * 0.08;
      const on = Math.sin(t * 2.2 + i * 1.7) > 0.3 ? 1 : 0.15;
      lamps[i].color.set(p.side === "port" ? "#ff3322" : "#33ff66").multiplyScalar(0.5 + on * (1 + night * 10));
    });
  });
  return (
    <group ref={group}>
      {positions.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh castShadow>
            <cylinderGeometry args={[1.1, 1.4, 2.4, 14]} />
            <meshStandardMaterial color={p.side === "port" ? "#c62d22" : "#1f8a3b"} roughness={0.6} />
          </mesh>
          <mesh position={[0, 2.8, 0]} castShadow>
            {p.side === "port" ? <cylinderGeometry args={[0.55, 0.55, 2.2, 10]} /> : <coneGeometry args={[0.8, 2.2, 10]} />}
            <meshStandardMaterial color={p.side === "port" ? "#c62d22" : "#1f8a3b"} roughness={0.6} />
          </mesh>
          <mesh position={[0, 4.2, 0]} material={lamps[i]}>
            <sphereGeometry args={[0.25, 8, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The world round a ship at sea: other ships on the horizon, a coastline in
 * the haze, and gulls wheeling overhead. `around` is the size of the scene's
 * centre (a ship's length), so the gulls keep to it.
 */
export function Surroundings({ animate, around, birds = true, coast = true }: { waves: WaveTrain[]; animate: boolean; around: number; birds?: boolean; coast?: boolean }) {
  const { quality } = useStage();
  return (
    <group>
      <HorizonShips count={quality === "low" ? 3 : 7} animate={animate} />
      {coast && <Coastline />}
      {birds && quality !== "low" && <Gulls radius={around * 0.7} height={around * 0.22 + 25} animate={animate} />}
    </group>
  );
}
