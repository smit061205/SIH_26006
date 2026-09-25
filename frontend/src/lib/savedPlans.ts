import { useSyncExternalStore } from "react";

/** A charter plan kept in this browser: its name and the shipment it was for. */
export interface SavedPlan {
  id: string;
  name: string;
  /** Query string with the shipment inputs (see shipment.shipmentQuery). */
  query: string;
  savedAt: string;
}

const KEY = "fw-saved-plans";
const MAX = 12;
const listeners = new Set<() => void>();

function read(): SavedPlan[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.query === "string" && typeof p.name === "string") : [];
  } catch {
    return [];
  }
}

let current: SavedPlan[] = read();

function write(next: SavedPlan[]) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: plans last for this visit only.
  }
  listeners.forEach((l) => l());
}

export function savePlan(name: string, query: string): SavedPlan {
  const plan: SavedPlan = { id: `${Date.now().toString(36)}`, name: name.trim() || "Saved plan", query, savedAt: new Date().toISOString() };
  // Saving the same inputs again replaces the older copy.
  write([plan, ...current.filter((p) => p.query !== query)].slice(0, MAX));
  return plan;
}

export function deletePlan(id: string) {
  write(current.filter((p) => p.id !== id));
}

export function useSavedPlans(): SavedPlan[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
