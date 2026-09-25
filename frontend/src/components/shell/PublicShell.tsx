import { Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth";
import { useT } from "../../lib/i18n";
import { Link } from "../../lib/router";

const SECTIONS = [
  ["features", "Features"],
  ["3d", "3D ships"],
  ["traffic", "Live traffic"],
  ["how", "How it works"],
  ["data", "Data"],
  ["faq", "FAQ"],
] as const;

/** The Freightwise mark: a bow wave under a hull line, in the accent colour. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
      <path d="M7 17.5h18l-2.6 5.2a2 2 0 0 1-1.8 1.1H11.4a2 2 0 0 1-1.8-1.1Z" fill="#fff" />
      <path d="M12 17.5v-4.2h4.2v4.2M18 17.5V9.5h3.4v8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5 26.5c2.2 0 2.2-1.2 4.4-1.2s2.2 1.2 4.4 1.2 2.2-1.2 4.4-1.2 2.2 1.2 4.4 1.2 2.2-1.2 4.4-1.2" fill="none" stroke="#e8804a" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5">
      <LogoMark />
      <span className="serif text-[21px] font-semibold leading-none tracking-[-0.01em] text-ink">Freightwise</span>
    </Link>
  );
}

/** Which landing section is in view, for the header's highlight. */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setActive(seen[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [enabled]);
  return active;
}

/** Header for pages anyone can see: the landing page and the account forms. */
export function PublicHeader({ sections = false }: { sections?: boolean }) {
  const t = useT();
  const { status } = useAuth();
  const active = useActiveSection(sections);
  const [open, setOpen] = useState(false);
  const signedIn = status === "signed-in";
  return (
    <header data-sticky-header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur-md backdrop-saturate-150 print:hidden">
      <div className="mx-auto flex h-[64px] max-w-[1264px] items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Brand />
        {sections && (
          <nav aria-label={t("On this page")} className="hidden items-center gap-1 text-[14.5px] lg:flex">
            {SECTIONS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={active === id ? "location" : undefined}
                className={`rounded-md px-3 py-1.5 transition-colors ${active === id ? "bg-accent-tint font-semibold text-accent" : "text-ink-2 hover:bg-hover hover:text-ink"}`}
              >
                {t(label)}
              </a>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <Link to="/plan" className="rounded-lg bg-accent px-4 py-2 text-[14px] font-semibold text-surface shadow-sm hover:bg-accent-hover">
              {t("Open the app")}
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden rounded-lg px-3 py-2 text-[14px] font-semibold text-ink-2 hover:text-ink sm:inline-block">
                {t("Sign in")}
              </Link>
              <Link to="/signup" className="rounded-lg bg-accent px-4 py-2 text-[14px] font-semibold text-surface shadow-sm hover:bg-accent-hover">
                {t("Get started")}
              </Link>
            </>
          )}
          {sections && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls="public-menu"
              aria-label={t("Menu")}
              onClick={() => setOpen((o) => !o)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-rule text-ink-2 hover:bg-hover lg:hidden"
            >
              {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
          )}
        </div>
      </div>
      {sections && open && (
        <nav id="public-menu" aria-label={t("On this page")} className="border-t border-rule bg-paper px-4 py-3 lg:hidden">
          <ul className="grid gap-1 sm:grid-cols-2">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2.5 text-[15px] text-ink-2 hover:bg-hover hover:text-ink">
                  {t(label)}
                </a>
              </li>
            ))}
            {!signedIn && (
              <li className="sm:hidden">
                <Link to="/login" className="block rounded-md px-3 py-2.5 text-[15px] font-semibold text-accent hover:bg-hover">
                  {t("Sign in")}
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  const t = useT();
  const cols: { title: string; links: [string, string, boolean?][] }[] = [
    {
      title: "Product",
      links: [
        ["/#features", "Features", true],
        ["/#3d", "3D ships", true],
        ["/#traffic", "Live traffic", true],
        ["/#how", "How it works", true],
      ],
    },
    {
      title: "Account",
      links: [
        ["/signup", "Create an account"],
        ["/login", "Sign in"],
        ["/forgot-password", "Reset your password"],
      ],
    },
    {
      title: "Legal",
      links: [
        ["/privacy", "Privacy notice"],
        ["/terms", "Terms of use"],
      ],
    },
  ];
  return (
    <footer className="mt-auto border-t border-rule bg-surface print:hidden">
      <div className="mx-auto grid max-w-[1264px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] lg:px-8">
        <div>
          <Brand />
          <p className="mt-4 max-w-[38ch] text-[14px] leading-relaxed text-ink-3">
            {t("Coking-coal chartering and voyage planning for SAIL's integrated steel plants.")}
          </p>
          <p className="mt-4 text-[13px] text-ink-3">Smart India Hackathon 2026 · {t("Problem SIH26006, Ministry of Steel")}</p>
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={t(c.title)}>
            <h2 className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{t(c.title)}</h2>
            <ul className="mt-4 space-y-2.5 text-[14px]">
              {c.links.map(([to, label, anchor]) => (
                <li key={to}>
                  {anchor ? (
                    <a href={to} className="text-ink-2 hover:text-ink">{t(label)}</a>
                  ) : (
                    <Link to={to} className="text-ink-2 hover:text-ink">{t(label)}</Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-rule">
        <p className="mx-auto max-w-[1264px] px-4 py-5 text-[12.5px] text-ink-3 sm:px-6 lg:px-8">© 2026 Freightwise</p>
      </div>
    </footer>
  );
}

/** A centred card for sign-in, sign-up and the other account steps. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[440px]">
        <div className="rounded-[var(--radius-surface)] border border-rule bg-surface p-6 sm:p-8">
          <h1 className="serif text-[26px] font-semibold leading-tight text-ink">{t(title)}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-ink-2">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-[14px] text-ink-2">{footer}</div>}
      </div>
    </div>
  );
}
