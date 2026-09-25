import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Rendering quality for the 3D views.
 * - high: ambient occlusion, bloom on lights and sun glint, sea reflections at
 *   half resolution, 2048 shadow maps, up to 1.5x pixel density;
 * - medium: bloom and reflections at a third of the resolution, 1024 shadows, 1.25x;
 * - low: no reflections, bloom or occlusion, 1x (slow devices and battery saver).
 * "auto" starts at high on desktops and laptops (battery or not) and steps
 * down only if the display actually starts dropping frames. The frame
 * governor, not lower quality, is what keeps the GPU cool.
 */
export type Quality = "high" | "medium" | "low";
export type QualitySetting = "auto" | Quality;

export const TIERS: Quality[] = ["low", "medium", "high"];

export const TIER: Record<Quality, { dpr: number; shadowMap: number; reflection: number; ao: boolean; bloom: boolean; clouds: boolean; idleFps: number }> = {
  high: { dpr: 1.5, shadowMap: 2048, reflection: 0.5, ao: true, bloom: true, clouds: true, idleFps: 30 },
  medium: { dpr: 1.25, shadowMap: 1024, reflection: 0.34, ao: false, bloom: true, clouds: true, idleFps: 30 },
  low: { dpr: 1, shadowMap: 1024, reflection: 0, ao: false, bloom: false, clouds: false, idleFps: 24 },
};

const KEY = "fw-3d-quality";
const listeners = new Set<() => void>();

function read(): QualitySetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "high" || v === "medium" || v === "low" ? v : "auto";
  } catch {
    return "auto";
  }
}

let current: QualitySetting = read();

export function setQualitySetting(value: QualitySetting) {
  try {
    if (value === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
  current = value;
  listeners.forEach((l) => l());
}

export function useQualitySetting(): QualitySetting {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}

/** Where "auto" starts: high on a desktop or laptop (plugged in or on battery), medium on phones, tablets and low-memory devices. */
export function autoStartTier(): Quality {
  if (typeof window === "undefined") return "medium";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const cores = nav.hardwareConcurrency ?? 8;
  if (coarse || (nav.deviceMemory !== undefined && nav.deviceMemory < 4) || cores < 4) return "medium";
  return "high";
}

export function stepTier(q: Quality, by: 1 | -1, ceiling: Quality): Quality {
  const i = Math.min(TIERS.indexOf(ceiling), Math.max(0, TIERS.indexOf(q) + by));
  return TIERS[i];
}

export interface Footprint {
  /** Midship on the sea (x, z), half length and half beam, metres. */
  x: number;
  z: number;
  halfLength: number;
  halfBeam: number;
}

/** State one 3D view shares with everything in it. */
export interface StageState {
  quality: Quality;
  /** 0 in daylight, 1 at dusk: navigation and deck lights come on as it falls. */
  night: number;
  setNight: (n: number) => void;
  /** Ships on the sea, for the foam where the hull meets the water. */
  footprints: Map<number, Footprint>;
  /** Something is moving (camera ease, drag, draft change): draw at full frame rate for a moment. */
  kick: (ms?: number) => void;
  /** Tone-mapping exposure for this view (views share one renderer). */
  setExposure: (value: number) => void;
  /** Work to do just before this view renders (the sea's mirror pass); `busy` is true while it moves. */
  onPreRender: (fn: (busy: boolean) => void) => () => void;
  /** The view's DOM box: controls listen to pointer and wheel events on it. */
  el: HTMLElement | null;
}

export const StageContext = createContext<StageState>({
  quality: "medium",
  night: 0,
  setNight: () => undefined,
  footprints: new Map(),
  kick: () => undefined,
  setExposure: () => undefined,
  onPreRender: () => () => undefined,
  el: null,
});

export const useStage = () => useContext(StageContext);
