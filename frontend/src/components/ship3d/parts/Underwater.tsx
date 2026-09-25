import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { type HullForm, halfBreadth } from "../hull";
import { PAINT } from "../materials";

const BRONZE = "#b58c52";

/** One blade: a skewed, rounded outline, thin, pitched about its radial axis. */
function bladeGeometry(radius: number) {
  const hub = radius * 0.18;
  const s = new THREE.Shape();
  const span = radius - hub;
  const chord = radius * 0.55;
  // Outline in (radial, chordwise) coordinates, skewed back towards the tip.
  s.moveTo(hub, -chord * 0.35);
  s.bezierCurveTo(hub + span * 0.5, -chord * 0.6, hub + span * 0.95, -chord * 0.35, radius, chord * 0.05);
  s.bezierCurveTo(hub + span * 0.9, chord * 0.45, hub + span * 0.4, chord * 0.5, hub, chord * 0.3);
  s.lineTo(hub, -chord * 0.35);
  const g = new THREE.ExtrudeGeometry(s, { depth: radius * 0.025, bevelEnabled: true, bevelThickness: radius * 0.01, bevelSize: radius * 0.01, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -radius * 0.0125);
  return g;
}

/**
 * Fixed-pitch propeller on the shaft boss (turning slowly when animated),
 * the rudder behind it, and bilge keels along the turn of the bilge.
 */
export function Underwater({ form, spin }: { form: HullForm; spin: number }) {
  const { prop, rudder } = form;
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && spin) ref.current.rotation.x += dt * spin;
  });
  const blade = useMemo(() => bladeGeometry(prop.radius), [prop.radius]);
  const rudderGeo = useMemo(() => {
    // Streamlined section (NACA-like), extruded over the rudder's height.
    const c = rudder.chord;
    const t = rudder.thickness * 2.2;
    const s = new THREE.Shape();
    s.moveTo(-c / 2, 0);
    s.bezierCurveTo(-c / 2, t * 0.6, -c * 0.2, t * 0.55, c / 2, 0);
    s.bezierCurveTo(-c * 0.2, -t * 0.55, -c / 2, -t * 0.6, -c / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: rudder.yTop - rudder.yBottom, bevelEnabled: false, curveSegments: 12 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [rudder.chord, rudder.thickness, rudder.yTop, rudder.yBottom]);
  const bilgeKeel = useMemo(() => {
    const from = 0.3 * form.L;
    const to = 0.68 * form.L;
    const r = form.bilgeRadius;
    const w = halfBreadth(form, form.L / 2, r) - r;
    // Along the bilge at 45 degrees, standing out 0.4 m.
    const z = w + r * Math.sin(Math.PI / 4) + 0.2;
    const y = r - r * Math.cos(Math.PI / 4) - 0.2;
    return { x: (from + to) / 2, length: to - from, y, z };
  }, [form]);
  return (
    <group>
      <group ref={ref} position={[prop.x, prop.y, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[prop.radius * 0.16, prop.radius * 0.2, prop.radius * 0.45, 20]} />
          <meshStandardMaterial color={BRONZE} roughness={0.3} metalness={0.85} />
        </mesh>
        {Array.from({ length: prop.blades }, (_, i) => (
          // Each blade radial in the y-z plane, pitched about its own axis.
          <group key={i} rotation={[(i * 2 * Math.PI) / prop.blades, 0, 0]}>
            <mesh geometry={blade} rotation={[0, Math.PI / 2 - 0.55, Math.PI / 2]} castShadow>
              <meshStandardMaterial color={BRONZE} roughness={0.28} metalness={0.85} side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh geometry={rudderGeo} position={[rudder.x, rudder.yBottom, 0]} castShadow>
        <meshStandardMaterial color={PAINT.bottom} roughness={0.65} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[bilgeKeel.x, bilgeKeel.y, s * bilgeKeel.z]} rotation={[-s * (Math.PI / 4), 0, 0]}>
          <boxGeometry args={[bilgeKeel.length, 0.8, 0.05]} />
          <meshStandardMaterial color={PAINT.bottom} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}
