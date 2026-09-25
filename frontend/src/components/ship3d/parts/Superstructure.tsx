import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { arrangement } from "../hull";
import { type Paint, PAINT, litWindowTexture, windowTexture } from "../materials";
import { useStage } from "../quality";

type Layout = ReturnType<typeof arrangement>;

function glow(m: THREE.MeshStandardMaterial, v: number) {
  m.emissiveIntensity = v;
}

/** A strip of windows `count` wide on a plane, facing +z before rotation. */
function WindowBand({
  width,
  height,
  count,
  kind,
  position,
  rotation,
}: {
  width: number;
  height: number;
  count: number;
  kind: "cabin" | "bridge";
  position: [number, number, number];
  rotation: [number, number, number];
}) {
  const { night } = useStage();
  const { geometry, material } = useMemo(() => {
    const g = new THREE.PlaneGeometry(width, height);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * count);
    // Glass reflects the sky by day; at night the cabins glow warm (the bridge stays dark).
    const m = new THREE.MeshStandardMaterial({
      map: windowTexture(kind),
      emissiveMap: litWindowTexture(kind),
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0,
      transparent: true,
      alphaTest: 0.4,
      roughness: 0.08,
      metalness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return { geometry: g, material: m };
  }, [width, height, count, kind]);
  useLayoutEffect(() => {
    glow(material, kind === "cabin" ? night * 2.4 : night * 0.3);
  }, [material, night, kind]);
  return <mesh geometry={geometry} material={material} position={position} rotation={rotation} />;
}

/** A funnel's plan: a stadium (rectangle with round ends), extruded upwards. */
function stadium(length: number, width: number) {
  const r = width / 2;
  const s = new THREE.Shape();
  const half = Math.max(0, length / 2 - r);
  s.moveTo(-half, -r);
  s.lineTo(half, -r);
  s.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-half, r);
  s.absarc(-half, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

function FunnelSection({ layout, from, to, color, scale = 1 }: { layout: Layout; from: number; to: number; color: string; scale?: number }) {
  const f = layout.funnel;
  const geometry = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(stadium(f.lx * scale, f.lz * scale), { depth: to - from, bevelEnabled: false, curveSegments: 12 });
    g.rotateX(-Math.PI / 2); // extrude upwards
    return g;
  }, [f.lx, f.lz, from, to, scale]);
  const base = f.y - f.ly / 2;
  return (
    <mesh geometry={geometry} position={[f.x, base + from, 0]} castShadow>
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.1} />
    </mesh>
  );
}

function Radar({ position, length, spin }: { position: [number, number, number]; length: number; spin: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current && spin) ref.current.rotation.y += dt * spin;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 0.6, 12]} />
        <meshStandardMaterial color={PAINT.superstructure} roughness={0.5} />
      </mesh>
      <mesh ref={ref} position={[0, 0.8, 0]}>
        <boxGeometry args={[0.35, 0.45, length]} />
        <meshStandardMaterial color="#f4f5f2" roughness={0.4} />
      </mesh>
    </group>
  );
}

/**
 * Accommodation block, wheelhouse and bridge wings, funnel and radar mast.
 * Tiers step in slightly as they rise; every tier has a deck edge lip and a
 * band of windows; the wheelhouse has continuous bridge glazing.
 */
export function Superstructure({ layout, detail, animate, paint }: { layout: Layout; detail: "full" | "medium"; animate: boolean; paint: Paint }) {
  const white = paint.white;
  const { tiers, wheelhouse, bridgeWings, funnel, casing, radarMast, accFront } = layout;
  const B = layout.form.B;
  const funnelTop = funnel.ly;
  return (
    <group>
      {tiers.map((t, i) => {
        const isBridge = i === tiers.length - 1;
        const kind = isBridge ? "bridge" : "cabin";
        const bandH = isBridge ? 1.5 : 1.1;
        const bandY = t.y + (isBridge ? 0.15 : 0.1);
        const front = t.x + t.lx / 2 + 0.02;
        return (
          <group key={i}>
            <mesh position={[t.x, t.y, t.z]} castShadow receiveShadow material={white}>
              <boxGeometry args={[t.lx, t.ly, t.lz]} />
            </mesh>
            {/* Deck edge lip over each tier */}
            <mesh position={[t.x, t.y + t.ly / 2 - 0.12, 0]} castShadow material={white}>
              <boxGeometry args={[t.lx + 0.6, 0.24, t.lz + 0.6]} />
            </mesh>
            {i > 0 && (
              <>
                <WindowBand width={t.lz - 2} height={bandH} count={isBridge ? Math.round(t.lz / 1.6) : t.windows} kind={kind} position={[front, bandY, 0]} rotation={[0, Math.PI / 2, 0]} />
                {detail === "full" &&
                  [1, -1].map((s) => (
                    <WindowBand
                      key={s}
                      width={t.lx - 2}
                      height={bandH}
                      count={Math.max(2, Math.round((t.lx - 2) / (isBridge ? 1.6 : 2.6)))}
                      kind={kind}
                      position={[t.x, bandY, s * (t.lz / 2 + 0.02)]}
                      rotation={[0, s > 0 ? 0 : Math.PI, 0]}
                    />
                  ))}
              </>
            )}
          </group>
        );
      })}
      {/* Bridge wings reach out to the ship's side, with a bulwark */}
      <mesh position={[bridgeWings.x, bridgeWings.y - wheelhouse.ly / 2 + 0.1, 0]} castShadow receiveShadow material={white}>
        <boxGeometry args={[bridgeWings.lx, 0.35, B]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[bridgeWings.x, bridgeWings.y - wheelhouse.ly / 2 + 0.75, s * ((B + wheelhouse.lz) / 4)]} castShadow material={white}>
          <boxGeometry args={[bridgeWings.lx, 1.1, (B - wheelhouse.lz) / 2]} />
        </mesh>
      ))}
      {/* Compass deck rail and the radar mast on the wheelhouse top */}
      <group position={[radarMast.x, radarMast.y, 0]}>
        <mesh position={[0, radarMast.height / 2, 0]} castShadow>
          <boxGeometry args={[0.9, radarMast.height, 0.9]} />
          <meshStandardMaterial color={PAINT.superstructure} roughness={0.5} />
        </mesh>
        <mesh position={[0, radarMast.height * 0.72, 0]} castShadow>
          <boxGeometry args={[0.35, 0.35, Math.min(14, B * 0.42)]} />
          <meshStandardMaterial color={PAINT.superstructure} roughness={0.5} />
        </mesh>
        <mesh position={[1.6, radarMast.height * 0.45, 0]}>
          <boxGeometry args={[3.2, 0.3, 3.2]} />
          <meshStandardMaterial color={PAINT.superstructure} roughness={0.5} />
        </mesh>
        <Radar position={[2.2, radarMast.height * 0.45 + 0.15, 0]} length={3.8} spin={animate ? 2.4 : 0} />
        <Radar position={[0, radarMast.height, 0]} length={5.2} spin={animate ? 2.0 : 0} />
        <mesh position={[0, radarMast.height + 2, 0]}>
          <cylinderGeometry args={[0.06, 0.08, 2.4, 6]} />
          <meshStandardMaterial color={PAINT.superstructure} />
        </mesh>
      </group>
      {/* Engine casing and funnel: hull colour, a white band with a stripe, black top */}
      <mesh position={[casing.x, casing.y, 0]} castShadow receiveShadow material={white}>
        <boxGeometry args={[casing.lx, casing.ly, casing.lz]} />
      </mesh>
      <FunnelSection layout={layout} from={0} to={funnelTop * 0.62} color={PAINT.funnel} />
      <FunnelSection layout={layout} from={funnelTop * 0.62} to={funnelTop * 0.82} color={PAINT.funnelBand} />
      <FunnelSection layout={layout} from={funnelTop * 0.69} to={funnelTop * 0.75} color={PAINT.funnelStripe} scale={1.006} />
      <FunnelSection layout={layout} from={funnelTop * 0.82} to={funnelTop} color="#15181b" />
      {detail === "full" &&
        [-0.25, 0, 0.25].map((dz, i) => (
          <mesh key={i} position={[funnel.x - funnel.lx * 0.1, funnel.y + funnel.ly / 2 + 1, dz * funnel.lz]}>
            <cylinderGeometry args={[0.35 + (i === 1 ? 0.2 : 0), 0.35 + (i === 1 ? 0.2 : 0), 2.4, 12]} />
            <meshStandardMaterial color="#202326" roughness={0.6} metalness={0.4} />
          </mesh>
        ))}
      {/* Mast light on the front of the wheelhouse top */}
      <mesh position={[accFront - 1.2, wheelhouse.y + wheelhouse.ly / 2 + 0.6, 0]}>
        <boxGeometry args={[0.6, 1.2, 3]} />
        <meshStandardMaterial color={PAINT.superstructure} roughness={0.6} />
      </mesh>
    </group>
  );
}
