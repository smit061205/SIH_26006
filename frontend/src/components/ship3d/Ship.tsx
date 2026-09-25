import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { type HullMesh, type ShipSpec, arrangement, deckMesh, hullForm, hullMesh } from "./hull";
import { PORT_OF_REGISTRY, asset, hullMaterial, nameTexture, usePaint, useSteelMaps } from "./materials";
import { DeckGear } from "./parts/DeckGear";
import { Fittings } from "./parts/Fittings";
import { Hatches } from "./parts/Hatches";
import { Superstructure } from "./parts/Superstructure";
import { Underwater } from "./parts/Underwater";

function toGeometry(m: HullMesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
  g.setIndex(m.indices);
  g.computeVertexNormals();
  return g;
}

export type Detail = "full" | "medium";

function setHullTime(u: { uTime: { value: number } }, t: number) {
  u.uTime.value = t;
}

/**
 * One bulk carrier built from its particulars. The group's origin is the
 * keel at the transom (x forward, y up, z to port); the parent places it so
 * the sea surface is at the draft it floats at.
 *
 * Each class shows its own features: the hull's fullness from its block
 * coefficient, folding hatch covers and deck cranes with grabs on the geared
 * Handysize and Supramax, side-rolling covers on the gearless classes, and
 * accommodation, funnel and fittings scaled to the ship.
 *
 * `detail="medium"` leaves out railings, bollards, anchors, cover ribs and the
 * smaller fittings, for scenes with many ships or seen from far away.
 * `working`: hatches open and cranes working cargo (alongside the berth).
 */
export function Ship({ spec, detail = "full", animate = false, working = false }: { spec: ShipSpec; detail?: Detail; animate?: boolean; working?: boolean }) {
  const maps = useSteelMaps();
  const paint = usePaint();
  const hull = useMemo(() => toGeometry(hullMesh(spec, detail === "full" ? 1.4 : 0.9)), [spec, detail]);
  const deck = useMemo(() => toGeometry(deckMesh(spec, detail === "full" ? 1.4 : 0.9)), [spec, detail]);
  const name = useMemo(() => nameTexture(`FW ${spec.name}`), [spec.name]);
  const stern = useMemo(() => nameTexture(`FW ${spec.name}`, PORT_OF_REGISTRY), [spec.name]);
  const waterNormals = useTexture(asset("waternormals.jpg")) as THREE.Texture;
  const { material: shell, uniforms: shellUniforms } = useMemo(() => hullMaterial(spec, name, stern, maps, waterNormals), [spec, name, stern, maps, waterNormals]);
  useFrame(({ clock }) => {
    if (animate) setHullTime(shellUniforms, clock.elapsedTime);
  });
  const layout = useMemo(() => arrangement(spec), [spec]);
  const form = useMemo(() => hullForm(spec), [spec]);

  useEffect(
    () => () => {
      hull.dispose();
      deck.dispose();
      shell.dispose();
      name.dispose();
      stern.dispose();
    },
    [hull, deck, shell, name, stern]
  );

  return (
    <group>
      <mesh geometry={hull} material={shell} castShadow receiveShadow />
      <mesh geometry={deck} material={paint.deck} receiveShadow />
      <Hatches hatches={layout.hatches} kind={layout.hatchCover} detail={detail} paint={paint} open={working} />
      <Superstructure layout={layout} detail={detail} animate={animate} paint={paint} />
      <DeckGear spec={spec} layout={layout} detail={detail} paint={paint} working={working} />
      <Fittings layout={layout} detail={detail} paint={paint} animate={animate} />
      <Underwater form={form} spin={animate ? 0.9 : 0} />
    </group>
  );
}
