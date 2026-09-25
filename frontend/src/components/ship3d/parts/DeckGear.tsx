import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { type ShipSpec, type arrangement, deckEdge, deckHeight, halfBreadth } from "../hull";
import { type Paint, PAINT } from "../materials";
import { Grab } from "./Fittings";

type Layout = ReturnType<typeof arrangement>;

/** Deck height at (x, z), with camber. */
function deckAt(layout: Layout, x: number, z: number) {
  const f = layout.form;
  return deckHeight(f, x) + f.camber * (1 - (z / (f.B / 2)) ** 2);
}

/** "SWL 30 T" as painted on a crane jib: black letters on clear. */
const swlCache = new Map<number, THREE.Texture>();
function swlTexture(swl: number) {
  const hit = swlCache.get(swl);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#111";
  ctx.font = `700 46px "Source Sans 3 Variable", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`SWL ${Math.round(swl)} T`, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  swlCache.set(swl, t);
  return t;
}

/**
 * A deck crane (geared ships): pedestal with its access ladder, slewing house
 * with the glazed driver's cab, a tapered box-girder jib with its SWL painted
 * on, the luffing tackle to the jib head, the runner wire and hook block.
 * With `grab`, the jib is raised and a grab hangs from it, as when working cargo.
 */
export function Crane({
  x,
  y,
  pedestalHeight,
  jibLength,
  facing,
  swl = 30,
  grab = false,
  slew = 0,
  paint,
}: {
  x: number;
  y: number;
  pedestalHeight: number;
  jibLength: number;
  facing: 1 | -1;
  swl?: number;
  grab?: boolean;
  slew?: number;
  paint: Paint;
}) {
  const mat = paint.crane;
  const luff = grab ? 0.75 : 0.16; // jib angle above horizontal
  const houseY = pedestalHeight + 1.6;
  const tipX = Math.cos(luff) * jibLength;
  const tipY = houseY + 0.8 + Math.sin(luff) * jibLength;
  const hookY = grab ? Math.max(3, tipY - 16) : houseY + 0.8;
  const wire = tipY - hookY;
  const swlMat = useMemo(() => new THREE.MeshBasicMaterial({ map: swlTexture(swl), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }), [swl]);
  // Luffing tackle from the top of the house to the jib head.
  const topX = -1.2;
  const topY = houseY + 3.6;
  const headX = 1.2 + tipX - 0.4;
  const tackle = Math.hypot(headX - topX, tipY - topY);
  return (
    <group position={[x, y, 0]} rotation={[0, (facing < 0 ? Math.PI : 0) + slew, 0]}>
      <mesh position={[0, pedestalHeight / 2, 0]} castShadow material={mat}>
        <cylinderGeometry args={[1.4, 1.8, pedestalHeight, 20]} />
      </mesh>
      {/* Access ladder up the pedestal */}
      <mesh position={[-1.9, pedestalHeight / 2, 0]} material={paint.steel}>
        <boxGeometry args={[0.1, pedestalHeight, 0.6]} />
      </mesh>
      {/* Slewing house and the A-frame for the luffing gear */}
      <mesh position={[-0.6, houseY, 0]} castShadow material={mat}>
        <boxGeometry args={[5.2, 3.2, 4]} />
      </mesh>
      <mesh position={[topX, houseY + 2.6, 0]} castShadow material={mat}>
        <boxGeometry args={[0.6, 2.2, 3]} />
      </mesh>
      <mesh position={[1.6, houseY + 0.5, 1.6]} castShadow material={mat}>
        <boxGeometry args={[1.8, 2.2, 1.6]} />
      </mesh>
      <mesh position={[2.52, houseY + 0.8, 1.6]}>
        <boxGeometry args={[0.05, 0.9, 1.3]} />
        <meshStandardMaterial color={PAINT.glass} roughness={0.08} metalness={0.5} />
      </mesh>
      <mesh position={[1.6, houseY + 0.8, 2.42]}>
        <boxGeometry args={[1.2, 0.8, 0.05]} />
        <meshStandardMaterial color={PAINT.glass} roughness={0.08} metalness={0.5} />
      </mesh>
      {/* Jib: two tapered box girders joined by cross-members and a head */}
      <group position={[1.2, houseY + 0.8, 0]} rotation={[0, 0, luff]}>
        {[0.9, -0.9].map((z) => (
          <mesh key={z} position={[jibLength / 2, 0, z * 0.85]} rotation={[z > 0 ? -0.018 : 0.018, 0, 0]} castShadow material={mat}>
            <boxGeometry args={[jibLength, 0.95, 0.5]} />
          </mesh>
        ))}
        {Array.from({ length: Math.max(2, Math.round(jibLength / 5)) }, (_, i) => (
          <mesh key={i} position={[(jibLength * (i + 0.5)) / Math.max(2, Math.round(jibLength / 5)), 0, 0]} material={mat}>
            <boxGeometry args={[0.3, 0.3, 1.5]} />
          </mesh>
        ))}
        <mesh position={[jibLength - 0.4, 0.2, 0]} castShadow material={mat}>
          <boxGeometry args={[1.2, 1.3, 2.2]} />
        </mesh>
        {[1, -1].map((sd) => (
          <mesh key={sd} position={[jibLength * 0.45, 0, sd * 1.05]} rotation={[0, sd > 0 ? 0 : Math.PI, 0]} material={swlMat}>
            <planeGeometry args={[4, 1]} />
          </mesh>
        ))}
      </group>
      {/* Luffing wires */}
      <mesh position={[(topX + headX) / 2, (topY + tipY) / 2, 0]} rotation={[0, 0, Math.atan2(tipY - topY, headX - topX) - Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, tackle, 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      {/* Runner wire and hook block, or a grab when working */}
      <mesh position={[headX, hookY + wire / 2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, Math.max(0.1, wire), 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      {grab ? (
        <Grab position={[headX, hookY - 3.2, 0]} open={0.4} material={paint.steel} />
      ) : (
        <mesh position={[headX, hookY - 0.3, 0]} castShadow material={mat}>
          <boxGeometry args={[0.8, 1.2, 0.6]} />
        </mesh>
      )}
      {/* Jib rest at the stowed end */}
      {!grab && (
        <mesh position={[1.2 + tipX - 1.5, (houseY + 0.8 + tipY) / 2 - 0.6, 0]} castShadow material={mat}>
          <boxGeometry args={[0.6, Math.max(1, tipY - 1), 0.6]} />
        </mesh>
      )}
    </group>
  );
}

function Instanced({ matrices, geometry, material, castShadow = true }: { matrices: THREE.Matrix4[]; geometry: THREE.BufferGeometry; material: THREE.Material; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} castShadow={castShadow} />;
}

/** Railings: stanchions every 1.5 m and two rails, following the deck edge. */
function Railing({ spec, from, to }: { spec: ShipSpec; from: number; to: number }) {
  const { stanchions, rails } = useMemo(() => {
    const pts = deckEdge(spec, from, to, 1.5);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const stanchions: THREE.Matrix4[] = [];
    const rails: THREE.TubeGeometry[] = [];
    for (const side of [1, -1]) {
      for (const [x, y, z] of pts) {
        m.compose(new THREE.Vector3(x, y + 0.55, side * (z - 0.25)), q, new THREE.Vector3(1, 1, 1));
        stanchions.push(m.clone());
      }
      for (const h of [0.55, 1.1]) {
        const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y + h, side * (z - 0.25))));
        rails.push(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), 0.03, 4, false));
      }
    }
    return { stanchions, rails };
  }, [spec, from, to]);
  const geometry = useMemo(() => new THREE.CylinderGeometry(0.03, 0.03, 1.1, 4), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: PAINT.rail, roughness: 0.5 }), []);
  return (
    <group>
      <Instanced matrices={stanchions} geometry={geometry} material={material} castShadow={false} />
      {rails.map((g, i) => (
        <mesh key={i} geometry={g} material={material} />
      ))}
    </group>
  );
}

/** Solid bulwark round the forecastle, in the hull colour. */
function Bulwark({ spec, from, to }: { spec: ShipSpec; from: number; to: number }) {
  const geometry = useMemo(() => {
    const pts = deckEdge(spec, from, to, 0.8);
    const positions: number[] = [];
    const indices: number[] = [];
    // Port edge forward, round the stem, starboard edge aft: one continuous wall.
    const path = [...pts.map(([x, y, z]) => [x, y, z]), ...[...pts].reverse().map(([x, y, z]) => [x, y, -z])];
    path.forEach(([x, y, z]) => positions.push(x, y, z, x, y + 1.3, z));
    for (let i = 0; i < path.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [spec, from, to]);
  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial color={PAINT.topsides} roughness={0.6} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Everything on deck apart from hatches and superstructure: cranes, the
 * forecastle's windlasses, chain and foremast, anchors in their hawse
 * pockets, bollards, railings, and the free-fall lifeboat on its stern ramp.
 */
export function DeckGear({ spec, layout, detail, paint, working = false }: { spec: ShipSpec; layout: Layout; detail: "full" | "medium"; paint: Paint; working?: boolean }) {
  const f = layout.form;
  const steel = paint.steel;
  const bollards = useMemo(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    return layout.bollards.flatMap((b) => [-0.9, 0.9].map((dx) => m.compose(new THREE.Vector3(b.x + dx, b.y + 0.45, b.z), q, new THREE.Vector3(1, 1, 1)).clone()));
  }, [layout.bollards]);
  const bollardGeo = useMemo(() => new THREE.CylinderGeometry(0.32, 0.36, 0.9, 12), []);
  const lb = layout.lifeboat;
  const fm = layout.foremast;
  return (
    <group>
      {layout.cranes.map((c, i) => (
        <Crane
          key={i}
          x={c.x}
          y={deckAt(layout, c.x, 0)}
          pedestalHeight={c.pedestalHeight}
          jibLength={c.jibLength}
          facing={c.facing}
          swl={c.swl}
          paint={paint}
          grab={working && i % 2 === 0}
          slew={working && i % 2 === 0 ? -c.facing * 0.9 : 0}
        />
      ))}
      {/* Windlasses with the chain running forward to the hawse pipes */}
      {layout.windlasses.map((w, i) => {
        const y = deckAt(layout, w.x, w.z);
        const hawseX = 0.975 * f.L;
        return (
          <group key={i}>
            <mesh position={[w.x, y + 0.9, w.z]} rotation={[Math.PI / 2, 0, 0]} castShadow material={steel}>
              <cylinderGeometry args={[0.9, 0.9, 2.2, 16]} />
            </mesh>
            <mesh position={[w.x - 1.6, y + 0.7, w.z]} castShadow material={steel}>
              <boxGeometry args={[1.6, 1.4, 1.6]} />
            </mesh>
            <mesh position={[(w.x + hawseX) / 2, y + 0.25, w.z * 0.85]} rotation={[0, Math.atan2(w.z * 0.15, hawseX - w.x), 0]}>
              <boxGeometry args={[hawseX - w.x, 0.22, 0.35]} />
              <meshStandardMaterial color="#3a3a38" roughness={0.8} metalness={0.4} />
            </mesh>
          </group>
        );
      })}
      {/* Anchors stowed in their pockets on each bow */}
      {detail === "full" &&
        layout.anchors.map((a, i) => {
          const zHull = halfBreadth(f, a.x, a.y);
          const slope = Math.atan2(halfBreadth(f, a.x + 2, a.y) - halfBreadth(f, a.x - 2, a.y), 4);
          return (
            <group key={i} position={[a.x, a.y, a.side * (zHull + 0.15)]} rotation={[0, -a.side * slope, 0]}>
              <mesh>
                <boxGeometry args={[3.6, 3.4, 0.4]} />
                <meshStandardMaterial color="#141719" roughness={0.9} />
              </mesh>
              <mesh position={[0, -0.2, a.side * 0.35]} rotation={[0, 0, 0.1]} castShadow>
                <boxGeometry args={[0.6, 2.8, 0.45]} />
                <meshStandardMaterial color={PAINT.anchor} roughness={0.6} metalness={0.5} />
              </mesh>
              <mesh position={[0, -1.5, a.side * 0.4]} castShadow>
                <boxGeometry args={[2.6, 0.7, 0.5]} />
                <meshStandardMaterial color={PAINT.anchor} roughness={0.6} metalness={0.5} />
              </mesh>
            </group>
          );
        })}
      {detail === "full" && <Instanced matrices={bollards} geometry={bollardGeo} material={steel} />}
      {/* Foremast on the forecastle */}
      <mesh position={[fm.x, fm.y + fm.height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.35, fm.height, 10]} />
        <meshStandardMaterial color={PAINT.crane} roughness={0.5} />
      </mesh>
      <mesh position={[fm.x, fm.y + fm.height * 0.7, 0]}>
        <boxGeometry args={[0.2, 0.2, 3.2]} />
        <meshStandardMaterial color={PAINT.crane} roughness={0.5} />
      </mesh>
      {/* Free-fall lifeboat on its launching ramp over the stern, bow pointing aft and down */}
      <group position={[lb.x, lb.y, 0]} rotation={[0, 0, lb.pitch]}>
        {[1.1, -1.1].map((z) => (
          <mesh key={z} position={[0, -1.9, z]} castShadow>
            <boxGeometry args={[lb.length + 2, 0.4, 0.3]} />
            <meshStandardMaterial color={PAINT.superstructure} roughness={0.6} />
          </mesh>
        ))}
        <mesh rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 1.05]} castShadow>
          <capsuleGeometry args={[1.5, lb.length - 3, 6, 16]} />
          <meshStandardMaterial color={PAINT.lifeboat} roughness={0.45} />
        </mesh>
        <mesh position={[1.2, 1.2, 0]} castShadow>
          <boxGeometry args={[2.2, 0.9, 1.6]} />
          <meshStandardMaterial color={PAINT.lifeboat} roughness={0.45} />
        </mesh>
      </group>
      {/* Davit frame over the ramp */}
      <group position={[lb.x + 1, deckHeight(f, lb.x) + 0.1, 0]}>
        {[1.9, -1.9].map((z) => (
          <mesh key={z} position={[0, 3.5, z]} castShadow>
            <boxGeometry args={[0.5, 7, 0.5]} />
            <meshStandardMaterial color={PAINT.superstructure} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, 7, 0]} castShadow>
          <boxGeometry args={[0.5, 0.5, 4.3]} />
          <meshStandardMaterial color={PAINT.superstructure} roughness={0.6} />
        </mesh>
      </group>
      {detail === "full" && (
        <>
          <Railing spec={spec} from={0.012 * f.L} to={f.forecastle.start - 0.3} />
          <Bulwark spec={spec} from={f.forecastle.start} to={f.L - 0.4} />
        </>
      )}
    </group>
  );
}
