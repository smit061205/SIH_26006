import { type ReactNode, useSyncExternalStore } from "react";

/**
 * The 3D views on the page. Every view is a "slot": a DOM box that the one
 * shared WebGL canvas (SharedCanvas) draws into. This module has no three.js
 * in it, so the app shell can watch for slots without loading the 3D chunk.
 */
export interface SlotOptions {
  /** Waves, clouds and motion: redraw at the idle frame rate; otherwise only on change. */
  animated: boolean;
  /** Post-processing (occlusion, bloom, AgX, SMAA). */
  post: boolean;
  /** Called once the view has drawn its first frames. */
  onReady?: () => void;
}

export interface SlotEntry {
  id: string;
  el: HTMLElement;
  children: ReactNode;
  opts: SlotOptions;
}

const entries = new Map<string, SlotEntry>();
const listeners = new Set<() => void>();
let snapshot: SlotEntry[] = [];
if (import.meta.env.DEV) (window as unknown as { __fwSlots: Map<string, SlotEntry> }).__fwSlots = entries;

function emit() {
  snapshot = [...entries.values()];
  listeners.forEach((l) => l());
}

export function setSlot(entry: SlotEntry) {
  entries.set(entry.id, entry);
  emit();
}

export function removeSlot(id: string) {
  if (entries.delete(id)) emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSlots(): SlotEntry[] {
  return useSyncExternalStore(subscribe, () => snapshot);
}
