import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "fw-theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Saves the choice and applies it; "system" follows the OS (index.html applies it before first paint). */
export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage may be blocked; the choice still applies for this visit.
  }
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  current = choice;
  listeners.forEach((l) => l());
}

let current: ThemeChoice = read();

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
