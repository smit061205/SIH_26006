import { type ReactNode, lazy, Suspense, useEffect, useRef } from "react";
import { Footer, GlobalProgress, ServiceStatus } from "./components/shell/Chrome";
import { NAV, REDIRECTS } from "./components/shell/nav";
import { PageBoundary } from "./components/shell/PageBoundary";
import { PublicFooter, PublicHeader } from "./components/shell/PublicShell";
import { ShipmentBar } from "./components/shell/ShipmentBar";
import { Shortcuts } from "./components/shell/Shortcuts";
import { TopBar } from "./components/shell/TopBar";
import { ErrorState, PageSkeleton } from "./components/ui/feedback";
import { useAuth } from "./lib/auth";
import { translate, useLang, useT } from "./lib/i18n";
import { focusInitialHash, redirect, usePathname } from "./lib/router";
import { ShipmentProvider } from "./lib/shipment";
import NotFound from "./pages/NotFound";

const Landing = lazy(() => import("./pages/Landing"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));

const CharterPlan = lazy(() => import("./pages/CharterPlan"));
const VesselPort = lazy(() => import("./pages/VesselPort"));
const FreightOutlook = lazy(() => import("./pages/FreightOutlook"));
const Scenarios = lazy(() => import("./pages/Scenarios"));
const Ports = lazy(() => import("./pages/Ports"));
const Account = lazy(() => import("./pages/Account"));
// Developer tools: in development builds, and for developer accounts anywhere.
const Kit = lazy(() => import("./pages/Kit"));

/** Open to anyone. */
const PUBLIC: Record<string, { title: string; render: () => ReactNode }> = {
  "/": { title: "Charter planning for coking coal", render: () => <Landing /> },
  "/privacy": { title: "Privacy notice", render: () => <Privacy /> },
  "/terms": { title: "Terms of use", render: () => <Terms /> },
};

/** Signed-in only. */
const PAGES: Record<string, () => ReactNode> = {
  "/plan": () => <CharterPlan />,
  "/vessel-port": () => <VesselPort />,
  "/freight-outlook": () => <FreightOutlook />,
  "/scenarios": () => <Scenarios />,
  "/ports": () => <Ports />,
  "/account": () => <Account />,
  "/kit": () => <Kit />,
};

/** The developer tools as a public page, in development builds only. */
const DEV_KIT_PAGE = {
  title: "Developer tools",
  render: () => (
    <ShipmentProvider>
      <div className="mx-auto w-full max-w-[1264px] px-4 py-10 sm:px-6 lg:px-8">
        <Kit />
      </div>
    </ShipmentProvider>
  ),
};

/** The landing page isn't needed once in the demo: it goes straight to the app. */
const SIGNED_IN_SKIPS = new Set(["/"]);

export default function App() {
  const pathname = usePathname();
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const path = REDIRECTS[trimmed] ?? trimmed;
  const { status, user, retry, startDemo } = useAuth();
  const devTools = import.meta.env.DEV || !!user?.is_developer;
  const lang = useLang();
  // In development builds the developer tools open without signing in (sample data; the notices need an account).
  const devKit = import.meta.env.DEV && path === "/kit" && status !== "signed-in" && status !== "loading";
  const publicPage = path in PUBLIC ? PUBLIC[path] : devKit ? DEV_KIT_PAGE : undefined;
  const appPage = path in PAGES && (path !== "/kit" || devTools || status === "loading") ? PAGES[path] : undefined;
  const isAppPage = appPage !== undefined && !devKit;
  const nav = NAV.find((n) => n.path === path);

  useEffect(() => {
    if (REDIRECTS[trimmed]) redirect(REDIRECTS[trimmed]);
    // "/plan/" -> "/plan", keeping the query and "#section".
    else if (pathname !== trimmed) redirect(trimmed + window.location.hash);
  }, [trimmed, pathname]);

  // In the demo: skip the landing page. Not yet: opening an app page (a shared plan link, say)
  // starts a demo there and then, so the link works; if that fails, back to the landing page.
  const demoStarted = useRef(false);
  useEffect(() => {
    if (status === "signed-in" && SIGNED_IN_SKIPS.has(path)) {
      redirect("/plan", path === "/"); // old "/?…" plan links keep their query
    } else if (status === "signed-out" && isAppPage && !demoStarted.current) {
      demoStarted.current = true;
      startDemo().catch(() => redirect("/"));
    }
  }, [status, path, isAppPage, startDemo]);

  useEffect(() => {
    const label = nav?.label ?? publicPage?.title ?? (path === "/account" ? "Account" : path === "/kit" ? "Developer tools" : null);
    document.title = label ? `${translate(lang, label)} · Freightwise` : "Freightwise";
  }, [nav, publicPage, path, lang]);

  useEffect(() => focusInitialHash(), []);

  if (publicPage || (!isAppPage && status !== "signed-in")) {
    return (
      <div className="flex min-h-screen flex-col">
        <SkipLink />
        <PublicHeader sections={path === "/"} />
        <main id="main" className="flex flex-1 flex-col">
          <PageBoundary resetKey={path}>
            <Suspense fallback={<div className="mx-auto w-full max-w-[1264px] px-4 py-10"><PageSkeleton /></div>}>
              {publicPage ? publicPage.render() : status === "loading" ? null : <div className="mx-auto w-full max-w-[1264px] px-4 py-10"><NotFound /></div>}
            </Suspense>
          </PageBoundary>
        </main>
        <PublicFooter />
      </div>
    );
  }

  if (status === "unavailable") {
    // Can't tell whether the person is signed in: never send them to sign in for an outage.
    return (
      <div className="flex min-h-screen flex-col">
        <SkipLink />
        <PublicHeader sections={false} />
        <main id="main" className="mx-auto w-full max-w-[1264px] flex-1 px-4 py-16">
          <ErrorState message="Can't reach the Freightwise service right now. This page will load as soon as it's back." onRetry={retry} />
        </main>
        <PublicFooter />
      </div>
    );
  }

  if (status !== "signed-in") {
    // Checking the session, or on the way to the sign-in page.
    return <div className="mx-auto w-full max-w-[1264px] px-4 py-12"><PageSkeleton /></div>;
  }

  return (
    <ShipmentProvider>
      <AppShell path={path} nav={nav}>
        {appPage ? appPage() : <NotFound />}
      </AppShell>
    </ShipmentProvider>
  );
}

function SkipLink() {
  const lang = useLang();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:text-accent"
    >
      {translate(lang, "Skip to content")}
    </a>
  );
}

/** Tells a demo visitor what the session is, and how to leave it. */
function DemoBanner() {
  const t = useT();
  const { user, logout } = useAuth();
  if (!user?.is_demo) return null;
  return (
    <div className="border-b border-rule bg-accent-tint">
      <div className="mx-auto flex max-w-[1264px] flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-2 sm:px-6 lg:px-8">
        <p className="text-[13.5px] text-ink-2">{t("You're in the live demo. Anything you save is deleted after a day.")}</p>
        <button type="button" onClick={() => void logout()} className="text-[13.5px] font-semibold text-accent underline-offset-4 hover:underline">
          {t("End the demo")}
        </button>
      </div>
    </div>
  );
}

function AppShell({ path, nav, children }: { path: string; nav: (typeof NAV)[number] | undefined; children: ReactNode }) {
  // Anchored sections scroll clear of the sticky header, whose height changes
  // with the shipment bar (see [id] in index.css).
  const stickyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <SkipLink />
      <div ref={stickyRef} data-sticky-header className="sticky top-0 z-30 print:static">
        <div className="print:hidden">
          <TopBar />
          {nav?.shipmentBar && <ShipmentBar showDuration={nav.duration} />}
          <GlobalProgress />
        </div>
      </div>
      <div className="print:hidden">
        <ServiceStatus />
        <DemoBanner />
      </div>
      <main id="main" className="mx-auto w-full max-w-[1264px] px-4 pb-20 pt-8 sm:px-6 md:pt-12 lg:px-8">
        <PageBoundary resetKey={path}>
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </PageBoundary>
      </main>
      <div className="print:hidden">
        <Footer />
      </div>
      <Shortcuts />
    </>
  );
}
