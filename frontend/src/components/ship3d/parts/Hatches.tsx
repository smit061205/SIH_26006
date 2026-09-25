import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Box } from "../hull";
import type { Paint } from "../materials";

const COAMING = 1.8;
const FOLD_PANELS = 4;

type Kind = "folding" | "side_rolling";

function Instances({ matrices, material, geometry, castShadow = true }: { matrices: THREE.Matrix4[]; material: THREE.Material; geometry: THREE.BufferGeometry; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  if (!matrices.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} castShadow={castShadow} receiveShadow />;
}

const box = new THREE.BoxGeometry(1, 1, 1);
const wheel = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 12).rotateX(Math.PI / 2);
const hinge = new THREE.CylinderGeometry(0.16, 0.16, 1, 8).rotateX(Math.PI / 2);
const m4 = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz));

/**
 * Hatch coamings and covers, by type:
 * - side-rolling (Panamax, Post-Panamax, Capesize): two heavy panels per hatch
 *   meeting on the centreline, each on wheels running on rails across the deck
 *   to a stowage platform outboard of the coaming; opened, they sit there;
 * - hydraulic folding (geared Handysize and Supramax): four panels per hatch,
 *   hinged in pairs, which fold up and stand at each end of the hatch when
 *   open, with the lifting cylinders on the coaming ends.
 * Opened covers show the coal in the hold.
 */
export function Hatches({ hatches, kind, detail, paint, open = false }: { hatches: Box[]; kind: Kind; detail: "full" | "medium"; paint: Paint; open?: boolean }) {
  const coal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#16161a", roughness: 0.95 }), []);
  const rubber = useMemo(() => new THREE.MeshStandardMaterial({ color: "#141517", roughness: 0.8 }), []);

  const parts = useMemo(() => {
    const coamings: THREE.Matrix4[] = [];
    const covers: THREE.Matrix4[] = [];
    const ribs: THREE.Matrix4[] = [];
    const brackets: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const platforms: THREE.Matrix4[] = [];
    const wheels: THREE.Matrix4[] = [];
    const hinges: THREE.Matrix4[] = [];
    const cylinders: THREE.Matrix4[] = [];
    const seals: THREE.Matrix4[] = [];
    for (const h of hatches) {
      const deck = h.y - h.ly / 2;
      const top = deck + COAMING;
      const coverH = h.ly - COAMING;
      // Coaming: four walls (open inside), a top bar, and stays down the sides.
      coamings.push(m4(h.x, deck + COAMING / 2, h.lz / 2 - 0.15, h.lx, COAMING, 0.3));
      coamings.push(m4(h.x, deck + COAMING / 2, -h.lz / 2 + 0.15, h.lx, COAMING, 0.3));
      coamings.push(m4(h.x + h.lx / 2 - 0.15, deck + COAMING / 2, 0, 0.3, COAMING, h.lz));
      coamings.push(m4(h.x - h.lx / 2 + 0.15, deck + COAMING / 2, 0, 0.3, COAMING, h.lz));
      if (detail === "full") {
        const nb = Math.max(3, Math.round(h.lx / 3));
        for (let i = 0; i <= nb; i++) {
          const x = h.x - h.lx / 2 + (i * h.lx) / nb;
          for (const s of [1, -1]) brackets.push(m4(x, deck + COAMING * 0.45, s * (h.lz / 2 + 0.35), 0.14, COAMING * 0.9, 0.7));
        }
        // Compression-bar seal (rubber) round the top of the coaming.
        for (const s of [1, -1]) seals.push(m4(h.x, top + 0.04, s * (h.lz / 2 - 0.15), h.lx, 0.08, 0.34));
      }

      if (kind === "side_rolling") {
        const shift = open ? h.lz / 2 + 0.9 : 0;
        for (const s of [1, -1]) {
          const z = s * (h.lz / 4 + shift);
          const y = open ? top + 0.35 + coverH / 2 : top + coverH / 2;
          covers.push(m4(h.x, y, z, h.lx + 0.5, coverH, h.lz / 2 + 0.2, s * -0.018));
          if (detail === "full") {
            const n = Math.max(3, Math.round(h.lx / 2.4));
            for (let i = 0; i < n; i++) {
              const x = h.x - h.lx / 2 + ((i + 0.5) * h.lx) / n;
              ribs.push(m4(x, y + coverH / 2 + 0.08, z, 0.22, 0.16, h.lz / 2 - 0.4));
            }
            // Wheels at each end of the panel, on the rails.
            for (const e of [1, -1]) for (const w of [0.3, 0.7]) wheels.push(m4(h.x + e * (h.lx / 2 + 0.05), y - coverH / 2 - 0.1, s * (shift + h.lz * w * 0.5), 1, 1, 1));
          }
          // Rails across the deck at each hatch end, out to the stowage platform, and the platform itself.
          for (const e of [1, -1]) {
            rails.push(m4(h.x + e * (h.lx / 2 + 0.05), top - 0.05, s * (h.lz / 2 + (h.lz / 2 + 1) / 2), 0.3, 0.2, h.lz / 2 + 1));
            platforms.push(m4(h.x + e * (h.lx / 2 + 0.05), (deck + top) / 2 - 0.1, s * (h.lz * 0.75 + 0.9), 0.6, COAMING - 0.2, 0.6));
          }
        }
        // Centre ridge where the panels meet (closed).
        if (!open) covers.push(m4(h.x, deck + h.ly + 0.05, 0, h.lx + 0.3, 0.3, 0.6));
      } else {
        const pl = h.lx / FOLD_PANELS;
        if (!open) {
          for (let i = 0; i < FOLD_PANELS; i++) {
            const x = h.x - h.lx / 2 + pl * (i + 0.5);
            covers.push(m4(x, top + coverH / 2, 0, pl - 0.06, coverH, h.lz + 0.4));
            // Hinge knuckles between the panels of each pair, and the joint seals.
            if (i < FOLD_PANELS - 1) hinges.push(m4(x + pl / 2, top + coverH * 0.9, 0, 1, 1, h.lz * 0.94));
          }
        } else {
          // Each pair folded up and standing at its end of the hatch.
          for (const e of [1, -1]) {
            for (const k of [0, 1]) {
              const x = h.x + e * (h.lx / 2 - 0.4 - k * (coverH + 0.15));
              covers.push(m4(x, top + pl / 2, 0, coverH, pl - 0.06, h.lz + 0.4, 0, e * (k === 0 ? 0.08 : -0.08)));
            }
            hinges.push(m4(h.x + e * (h.lx / 2 - 0.4 - coverH / 2), top + pl, 0, 1, 1, h.lz * 0.94));
          }
        }
        // Hydraulic lifting cylinders on the coaming ends, both sides.
        if (detail === "full")
          for (const e of [1, -1])
            for (const s of [1, -1]) cylinders.push(m4(h.x + e * (h.lx / 2 + 0.35), top + (open ? 1.4 : 0.5), s * (h.lz / 2 - 0.6), 0.4, open ? 2.8 : 1.1, 0.4, 0, open ? e * 0.35 : e * 1.25));
      }
    }
    return { coamings, covers, ribs, brackets, rails, platforms, wheels, hinges, cylinders, seals };
  }, [hatches, kind, detail, open]);

  return (
    <group>
      <Instances matrices={parts.coamings} material={paint.coaming} geometry={box} />
      <Instances matrices={parts.covers} material={paint.cover} geometry={box} />
      <Instances matrices={parts.ribs} material={paint.cover} geometry={box} />
      <Instances matrices={parts.brackets} material={paint.coaming} geometry={box} castShadow={false} />
      <Instances matrices={parts.rails} material={paint.steel} geometry={box} castShadow={false} />
      <Instances matrices={parts.platforms} material={paint.coaming} geometry={box} />
      <Instances matrices={parts.wheels} material={paint.steel} geometry={wheel} castShadow={false} />
      <Instances matrices={parts.hinges} material={paint.steel} geometry={hinge} castShadow={false} />
      <Instances matrices={parts.cylinders} material={paint.steel} geometry={box} castShadow={false} />
      <Instances matrices={parts.seals} material={rubber} geometry={box} castShadow={false} />
      {/* The hold floor and the coal in it, seen when the covers are open */}
      {open &&
        hatches.map((h, i) => (
          <mesh key={i} position={[h.x, h.y - h.ly / 2 - 1.2 - (i % 2) * 1.5, 0]} rotation={[-Math.PI / 2, 0, 0]} material={coal} receiveShadow>
            <planeGeometry args={[h.lx - 0.6, h.lz - 0.6]} />
          </mesh>
        ))}
    </group>
  );
}
