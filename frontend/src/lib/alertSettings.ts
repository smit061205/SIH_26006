import { useSyncExternalStore } from "react";
import type { AlertThresholds } from "../api";

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  wave_m: 2.5,
  wait_days: 5,
  activity_pct: 30,
  band_pct: 40,
  move_pct: 10,
};

const KEY = "freightwise.alertThresholds";
const listeners = new Set<() => void>();

function read(): AlertThresholds {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

let current = read();

export function setThresholds(next: AlertThresholds) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: applies for this visit only */
  }
  listeners.forEach((l) => l());
}

export function resetThresholds() {
  setThresholds(DEFAULT_THRESHOLDS);
}

export function useThresholds(): AlertThresholds {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
