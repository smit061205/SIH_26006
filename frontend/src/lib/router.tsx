import { type AnchorHTMLAttributes, type MouseEvent, useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", emit);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

function useSearch() {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

/** Runs `fn` with the element once it exists: pages load lazily and sections
 *  appear when their data arrives, so watch the DOM (for up to 20 s). */
function whenPresent(find: () => HTMLElement | null, fn: (el: HTMLElement) => void) {
  const now = find();
  if (now) {
    requestAnimationFrame(() => fn(now));
    return;
  }
  const observer = new MutationObserver(() => {
    const el = find();
    if (!el) return;
    observer.disconnect();
    window.clearTimeout(timer);
    // Let the section lay out (skeletons swap for content) before scrolling to it.
    requestAnimationFrame(() => fn(el));
  });
  const timer = window.setTimeout(() => observer.disconnect(), 20_000);
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Moves keyboard and screen-reader focus to a heading or section after a page
 *  change: the new page's heading, not the old one that's about to unmount. */
function focusTarget(hash: string, previous: Element | null = null) {
  whenPresent(
    () => {
      const el = hash ? document.getElementById(hash) : document.querySelector<HTMLElement>("main h1");
      return el && el !== previous && el.isConnected ? el : null;
    },
    (el) => {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      if (hash) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  );
}

/** On first load of a URL with "#section", scroll there once the page renders. */
export function focusInitialHash() {
  const hash = window.location.hash.slice(1);
  if (hash) focusTarget(hash);
}

/** Public and account pages: their query strings (sign-in links, one-time
 *  tokens) belong to them alone, and they don't take the app's inputs. */
const OWN_QUERY = new Set(["/", "/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/privacy", "/terms", "/account"]);

/** The query a link to `to` should carry: its own, else the current page's
 *  shared inputs when moving between app pages, else none. */
function targetSearch(path: string, query: string | undefined, current: { pathname: string; search: string }) {
  if (query !== undefined) return `?${query}`; // a saved plan replaces the current inputs
  if (path === current.pathname) return current.search;
  return OWN_QUERY.has(path) || OWN_QUERY.has(current.pathname) ? "" : current.search;
}

/** Navigates to a page (optionally "#section" on it), carrying the current
 *  query string between app pages so shared inputs survive. */
export function navigate(to: string) {
  const [pathAndQuery, hash = ""] = to.split("#");
  const [path, query] = pathAndQuery.split("?");
  const target = path || window.location.pathname;
  const search = targetSearch(target, query, window.location);
  if (target === window.location.pathname && search === window.location.search) {
    if (hash) focusTarget(hash);
    return;
  }
  const previous = hash ? null : document.querySelector("main h1");
  const samePage = target === window.location.pathname;
  window.history.pushState(null, "", target + search + (hash ? `#${hash}` : ""));
  emit();
  if (!hash) window.scrollTo(0, 0);
  if (!samePage) focusTarget(hash, previous);
  else if (hash) focusTarget(hash);
}

/** Replaces the current address. The current query carries over unless the
 *  target has its own "?query" or keepQuery is false. */
export function redirect(to: string, keepQuery = true) {
  const target = to.includes("?") || !keepQuery ? to : to + window.location.search;
  window.history.replaceState(null, "", target);
  emit();
}

/** Reads and writes one query parameter. Writes replace history so typing
 *  into a field doesn't fill the back button with every keystroke. */
export function useSearchParam(key: string): [string | null, (value: string | null) => void] {
  const search = useSearch();
  const value = new URLSearchParams(search).get(key);
  const set = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (next === null || next === "") params.delete(key);
      else params.set(key, next);
      const qs = params.toString();
      // Keep any "#section": changing a setting mustn't lose the place on the page.
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
      emit();
    },
    [key]
  );
  return [value, set];
}

/** A page setting kept in the URL, falling back when missing or out of range. */
export function useNumberParam(
  key: string,
  fallback: number,
  valid: (n: number) => boolean
): [number, (n: number) => void] {
  const [raw, setRaw] = useSearchParam(key);
  const n = Number(raw);
  const value = raw !== null && Number.isFinite(n) && valid(n) ? n : fallback;
  const set = useCallback((next: number) => setRaw(next === fallback ? null : String(next)), [setRaw, fallback]);
  return [value, set];
}

export function useChoiceParam<T extends string>(key: string, fallback: T, choices: readonly T[]): [T, (v: T) => void] {
  const [raw, setRaw] = useSearchParam(key);
  const value = raw !== null && (choices as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback((next: T) => setRaw(next === fallback ? null : next), [setRaw, fallback]);
  return [value, set];
}

export function Link({
  to,
  onClick,
  ...rest
}: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const search = useSearch();
  const pathname = usePathname();
  const [pathAndQuery, hash] = to.split("#");
  const [path, query] = pathAndQuery.split("?");
  const target = path || pathname;
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={target + targetSearch(target, query, { pathname, search }) + (hash ? `#${hash}` : "")} onClick={handle} {...rest} />;
}
