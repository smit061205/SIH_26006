import { useSyncExternalStore } from "react";
import { HI } from "./i18n-hi";

export type Lang = "en" | "hi";
export type Vars = Record<string, string | number>;
export type T = (text: string, vars?: Vars) => string;

const KEY = "fw-lang";
const listeners = new Set<() => void>();
const FONT_ID = "fw-devanagari-font";

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

let current: Lang = read();

/** Devanagari glyphs come from Noto; loaded only when Hindi is chosen. */
function applyLang(lang: Lang) {
  document.documentElement.lang = lang === "hi" ? "hi" : "en-IN";
  if (lang === "hi" && !document.getElementById(FONT_ID)) {
    const link = document.createElement("link");
    link.id = FONT_ID;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&display=swap";
    document.head.appendChild(link);
  }
}

applyLang(current);

/** The current language, for pure helpers such as date formatting. */
export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
  current = lang;
  applyLang(lang);
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}

function fill(text: string, vars?: Vars) {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Translates an English interface string ({name} placeholders allowed);
 *  anything without a Hindi entry stays in English. */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  return fill(lang === "hi" ? (HI[text] ?? text) : text, vars);
}

export function useT(): T {
  const lang = useLang();
  return (text, vars) => translate(lang, text, vars);
}

/** Like useT, but passes anything that isn't a plain string through
 *  untouched, for shared components whose props may be text or elements. */
export function useTx() {
  const t = useT();
  return <N,>(node: N): N => (typeof node === "string" ? (t(node) as N) : node);
}

/** English, for helpers called outside components. */
export const en: T = (text, vars) => fill(text, vars);
