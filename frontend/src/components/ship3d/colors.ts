import { useMemo, useSyncExternalStore } from "react";
import { useTheme } from "../../lib/theme";

export interface ShipColors {
  label: string;
  labelBackground: string;
  accent: string;
  signal: string;
  ink3: string;
  dark: boolean;
}

function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
}

function isDark() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** `_key` names the theme state the tokens were read under, so a new key re-reads them. */
function read(_key?: string): ShipColors {
  const dark = isDark();
  return {
    label: token("--color-ink"),
    labelBackground: token("--color-surface"),
    accent: token("--color-accent"),
    signal: token("--color-signal"),
    ink3: token("--color-ink-3"),
    dark,
  };
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeOsScheme(onChange: () => void) {
  const mq = window.matchMedia?.(DARK_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

/** Ship colours from the theme tokens, re-read when the theme or OS setting changes. */
export function useShipColors(): ShipColors {
  const theme = useTheme();
  const osDark = useSyncExternalStore(subscribeOsScheme, () => window.matchMedia?.(DARK_QUERY).matches ?? false);
  const key = `${theme}:${osDark}`;
  return useMemo(() => read(key), [key]);
}

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
