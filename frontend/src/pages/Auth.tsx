import { type KeyboardEvent, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { navigate, useSearchParam } from "../lib/router";
import { SignInForm } from "./Login";
import { type SignupResult, SignUpForm, SignupDone } from "./Signup";
import { DemoButton } from "../components/shell/PublicShell";

type Tab = "signin" | "signup";

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: "signin", label: "Sign in", path: "/login" },
  { id: "signup", label: "Create account", path: "/signup" },
];

/**
 * Sign in and create an account on one page, as two tabs. Each tab has its own
 * address (/login, /signup), so links, the Back button and "?next=" all work.
 */
export default function Auth({ tab }: { tab: Tab }) {
  const t = useT();
  const [next] = useSearchParam("next");
  // A sign-up result belongs to the tab it came from (Back or a link to /login clears it).
  const [done, setDone] = useState<{ tab: Tab; result: SignupResult } | null>(null);
  const result = done?.tab === tab ? done.result : null;
  const setResult = (r: SignupResult | null) => setDone(r ? { tab, result: r } : null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (to: Tab) => {
    setResult(null);
    const path = TABS.find((x) => x.id === to)!.path;
    navigate(next ? `${path}?next=${encodeURIComponent(next)}` : path);
  };

  // Arrow keys move between tabs, as for any tab list.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const to = tab === "signin" ? "signup" : "signin";
    go(to);
    refs.current[TABS.findIndex((x) => x.id === to)]?.focus();
  };

  const heading =
    result?.kind === "email"
      ? t("Check your email")
      : result?.kind === "developer"
        ? t("Developer account ready")
        : tab === "signin"
          ? t("Welcome back")
          : t("Create your account");
  const subtitle = result
    ? null
    : tab === "signin"
      ? t("Sign in with your email and password.")
      : t("For people who plan coking-coal shipments for SAIL's plants.");

  return (
    <div className="flex flex-1 items-start justify-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-[480px] overflow-hidden rounded-[var(--radius-surface)] border border-rule bg-surface">
        <div role="tablist" aria-label={t("Account")} className="grid grid-cols-2 border-b border-rule" onKeyDown={onKeyDown}>
          {TABS.map((x, i) => {
            const selected = x.id === tab;
            return (
              <button
                key={x.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`auth-tab-${x.id}`}
                aria-selected={selected}
                aria-controls="auth-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => !selected && go(x.id)}
                className={`relative h-12 text-[15px] font-semibold transition-colors ${
                  selected ? "text-ink" : "bg-sunken text-ink-3 hover:text-ink"
                }`}
              >
                {t(x.label)}
                {selected && <span className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" id="auth-panel" aria-labelledby={`auth-tab-${tab}`} className="p-6 sm:p-8">
          <h1 className="serif text-[26px] font-semibold leading-tight text-ink">{heading}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-ink-2">{subtitle}</p>}
          <div className="mt-6">
            {tab === "signin" ? (
              <SignInForm />
            ) : result ? (
              <SignupDone result={result} onSignIn={() => go("signin")} />
            ) : (
              <SignUpForm onDone={setResult} />
            )}
          </div>
        </div>
        {!result && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-sunken/60 px-6 py-4 sm:px-8">
            <p className="text-[14px] text-ink-2">{t("Just looking? Open the planner without an account.")}</p>
            <DemoButton className="rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3.5 py-2 text-[14px] font-semibold text-ink hover:bg-hover disabled:opacity-70" />
          </div>
        )}
      </div>
    </div>
  );
}
