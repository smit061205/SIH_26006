import { Menu, SlidersHorizontal, UserRound } from "lucide-react";
import { useState } from "react";
import { useCurrency } from "../../lib/currency";
import { type Currency, shortDate } from "../../lib/format";
import { useThresholds } from "../../lib/alertSettings";
import { useAuth } from "../../lib/auth";
import { actionable } from "../../lib/alerts";
import { useAlerts, useCharterPlan } from "../../lib/queries";
import { Link, navigate, usePathname } from "../../lib/router";
import { useShipment } from "../../lib/shipment";
import { type Lang, setLang, useLang, useT } from "../../lib/i18n";
import { type ThemeChoice, setTheme, useTheme } from "../../lib/theme";
import { type QualitySetting, setQualitySetting, useQualitySetting } from "../ship3d/quality";
import { Button, Field, Segmented } from "../ui/inputs";
import { Popover, Sheet, Tooltip } from "../ui/overlay";
import { NAV } from "./nav";
import { DeveloperBadge } from "../ui/badge";

function useFxNote() {
  const { money, rateDate, rateSource } = useCurrency();
  const t = useT();
  const rate = money.rate.toFixed(2);
  if (rateSource === "live" && rateDate) return t("₹{rate} per $, ECB {date}", { rate, date: shortDate(rateDate) });
  if (rateSource === "fixed") return t("₹{rate} per $, fixed rate", { rate });
  return t("₹{rate} per $", { rate });
}

function CurrencySwitch({ compact = false }: { compact?: boolean }) {
  const { money, setCurrency } = useCurrency();
  const note = useFxNote();
  const control = (
    <Segmented<Currency>
      label="Currency"
      value={money.currency}
      onChange={setCurrency}
      options={[
        { value: "USD", label: compact ? "$" : "USD" },
        { value: "INR", label: compact ? "₹" : "INR" },
      ]}
    />
  );
  return (
    <div className="flex items-center gap-3">
      <span className="hidden xl:inline text-[12.5px] text-ink-3 whitespace-nowrap">{note}</span>
      <span className="xl:hidden">
        <Tooltip content={note} side="bottom">
          <span>{control}</span>
        </Tooltip>
      </span>
      <span className="hidden xl:inline">{control}</span>
    </div>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const QUALITIES: { value: QualitySetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** Settings for how the app looks: theme, language and 3D quality. */
function DisplayControls() {
  const theme = useTheme();
  const quality = useQualitySetting();
  const lang = useLang();
  const t = useT();
  return (
    <div className="space-y-4">
      <Field label="Theme">
        <Segmented<ThemeChoice> label="Theme" value={theme} onChange={setTheme} options={THEMES} />
      </Field>
      <Field label="Language">
        <Segmented<Lang>
          label="Language"
          value={lang}
          onChange={setLang}
          options={[
            { value: "en", label: <span lang="en">English</span> },
            { value: "hi", label: <span lang="hi">हिन्दी</span> },
          ]}
        />
      </Field>
      <Field label="3D quality">
        <Segmented<QualitySetting> label="3D quality" value={quality} onChange={setQualitySetting} options={QUALITIES} />
      </Field>
      <p className="-mt-2 text-[13px] text-ink-3">{t("Auto lowers the detail if the 3D views run slowly.")}</p>
      <p className="text-[13px] text-ink-3">{t("Press ? for keyboard shortcuts.")}</p>
    </div>
  );
}

/** Account links inside the phone menu. */
function MenuAccount({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="mt-6 border-t border-rule pt-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        {user.name}
        {user.is_developer && <DeveloperBadge />}
      </p>
      <p className="mb-3 truncate text-[13px] text-ink-3">{user.email}</p>
      <div className="flex gap-4">
        <Link to="/account" onClick={onDone} className="text-[15px] text-accent">
          {t("Account and privacy")}
        </Link>
        <button
          type="button"
          className="text-[15px] text-accent"
          onClick={async () => {
            onDone();
            await logout();
          }}
        >
          {t("Sign out")}
        </button>
      </div>
    </div>
  );
}

/** Who's signed in, with Account and Sign out. */
function UserMenu() {
  const t = useT();
  const { user, logout } = useAuth();
  if (!user) return null;
  const signOut = () => logout();
  return (
    <Popover
      title={user.name}
      trigger={
        <Button variant="text" className="text-ink-2 hover:text-ink no-underline" aria-label={t("Account menu for {name}", { name: user.name })}>
          <UserRound size={16} strokeWidth={1.75} aria-hidden />
          <span className="hidden max-w-[10rem] truncate xl:inline">{user.name.split(" ")[0]}</span>
        </Button>
      }
    >
      <p className="-mt-2 mb-3 truncate text-[13px] text-ink-3">{user.email}</p>
      {user.is_developer && (
        <div className="mb-3">
          <DeveloperBadge />
        </div>
      )}
      <div className="flex flex-col items-start gap-2 border-t border-rule pt-3">
        <Link to="/account" className="text-[14px] text-accent underline-offset-4 hover:underline">
          {t("Account and privacy")}
        </Link>
        {user.is_developer && (
          <Link to="/kit" className="text-[14px] text-accent underline-offset-4 hover:underline">
            {t("Developer tools")}
          </Link>
        )}
        <Button variant="text" onClick={signOut}>
          {t("Sign out")}
        </Button>
      </div>
    </Popover>
  );
}

function DisplayMenu() {
  const t = useT();
  return (
    <Popover
      title="Display"
      trigger={
        <Button variant="text" className="text-ink-2 hover:text-ink no-underline" aria-label={t("Display settings")}>
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden />
          <span className="hidden xl:inline">{t("Display")}</span>
        </Button>
      }
    >
      <DisplayControls />
    </Popover>
  );
}

/** Alerts for the recommended port and vessel type; links to them on the
 *  Charter plan. Always the charter plan's recommendation (for a contract,
 *  the class held for every month), with the same query as the Watch out
 *  block, so the two counts always match. */
function AlertCount() {
  const { shipment } = useShipment();
  const plan = useCharterPlan(shipment);
  const thresholds = useThresholds();
  const top = plan.data?.recommendation?.top;
  const alerts = useAlerts(
    top && shipment ? { port: top.port, vesselClass: top.vessel_class, origin: shipment.origin } : null,
    thresholds
  );
  const list = actionable(alerts.data?.alerts ?? []);
  const t = useT();
  const count = list.length;
  if (!count) return null;
  const urgent = list.filter((a) => a.severity === "high").length;
  const noun = count === 1 ? t("{n} alert", { n: count }) : t("{n} alerts", { n: count });
  return (
    <button
      type="button"
      onClick={() => navigate("/plan#watch-out")}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[14px] text-ink-2 hover:text-ink"
      aria-label={`${noun} ${t("for the recommended port and vessel")}${urgent ? `, ${t("{n} to act on", { n: urgent })}` : ""}.`}
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: urgent ? "var(--color-negative)" : "var(--color-caution)" }} />
      {noun}
      {urgent > 0 && <span className="hidden xl:inline text-negative">({t("{n} to act on", { n: urgent })})</span>}
    </button>
  );
}

export function TopBar() {
  const t = useT();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const note = useFxNote();

  return (
    <div className="bg-surface border-b border-rule">
      <div className="mx-auto flex h-[60px] max-w-[1264px] items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Link
          to="/plan"
          className="serif text-[21px] font-semibold tracking-[-0.01em] text-ink leading-none shrink-0"
        >
          Freightwise
        </Link>

        <nav aria-label="Primary" className="hidden lg:flex h-full items-stretch gap-6 xl:gap-7">
          {NAV.map((item) => {
            const active = pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center text-[15px] whitespace-nowrap transition-colors duration-150 ${
                  active ? "text-ink font-semibold" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t(item.label)}
                {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-accent" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <AlertCount />
          <div className="hidden md:block">
            <CurrencySwitch />
          </div>
          <div className="md:hidden">
            <CurrencySwitch compact />
          </div>
          <div className="hidden lg:block">
            <DisplayMenu />
          </div>
          <div className="hidden lg:block">
            <UserMenu />
          </div>
          <button
            type="button"
            className="lg:hidden -mr-1.5 p-2 text-ink-2 hover:text-ink"
            aria-label={t("Open menu")}
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Freightwise">
        <nav aria-label="Primary" className="-mx-4 -mt-2">
          {NAV.map((item) => {
            const active = pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`block border-b border-rule px-4 py-3.5 text-[17px] ${
                  active ? "text-ink font-semibold shadow-[inset_3px_0_0_var(--color-accent)]" : "text-ink-2"
                }`}
              >
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
        <p className="mt-5 text-[13px] text-ink-3">
          {t("Exchange rate")}: {note}
        </p>
        <div className="mt-6 border-t border-rule pt-4">
          <DisplayControls />
        </div>
        <MenuAccount onDone={() => setMenuOpen(false)} />
      </Sheet>
    </div>
  );
}
