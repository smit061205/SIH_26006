import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, auth } from "../api";
import { FormError, FormNotice, PasswordInput, SelectInput, TextInput } from "../components/ui/forms";
import { Button } from "../components/ui/inputs";
import { PageHeader, Section } from "../components/ui/layout";
import { ROLES, UNITS } from "../lib/accountOptions";
import { useAuth } from "../lib/auth";
import { longDate } from "../lib/format";
import { useT } from "../lib/i18n";
import { Link } from "../lib/router";
import { DeveloperBadge } from "../components/ui/badge";
import { meetsRules } from "../lib/passwordStrength";

function describeDevice(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function Profile() {
  const t = useT();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [organisation, setOrganisation] = useState(user?.organisation ?? "");
  const [role, setRole] = useState(user?.role_title ?? "");
  const [plant, setPlant] = useState(user?.plant ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setError(null);
    try {
      setUser(await auth.updateMe({ name, organisation, role_title: role, plant }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't save. Try again in a moment."));
    }
  };
  return (
    <Section first title="Profile" description={t("Signed in as {email}.", { email: user?.email ?? "" })}>
      <form onSubmit={submit} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
        <TextInput label="Organisation" autoComplete="organization" value={organisation} onChange={(e) => setOrganisation(e.target.value)} />
        <SelectInput label="Role" value={role} onChange={setRole} options={ROLES} />
        <SelectInput label="Plant or unit" value={plant} onChange={setPlant} options={UNITS} />
        <div className="sm:col-span-2 space-y-3">
          {error && <FormError>{error}</FormError>}
          {saved && <FormNotice>{t("Saved.")}</FormNotice>}
          <Button type="submit">{t("Save profile")}</Button>
        </div>
      </form>
    </Section>
  );
}

function ChangePassword() {
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (!meetsRules(next)) return setError(t("Your password doesn't meet every rule yet. See the list under it."));
    try {
      const r = await auth.changePassword(current, next);
      setMessage(t(r.message));
      setCurrent("");
      setNext("");
      void qc.invalidateQueries({ queryKey: ["sessions"] });
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't save. Try again in a moment."));
    }
  };
  return (
    <Section title="Password" description={t("Changing it signs you out on your other devices.")}>
      <form onSubmit={submit} className="max-w-md space-y-4">
        {error && <FormError>{error}</FormError>}
        {message && <FormNotice>{message}</FormNotice>}
        <PasswordInput label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordInput
          label="New password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          showStrength
          context={[user?.name ?? "", user?.email ?? ""]}
        />
        <Button type="submit" disabled={!current || !next}>
          {t("Change password")}
        </Button>
      </form>
    </Section>
  );
}

function Sessions() {
  const t = useT();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => auth.sessions() });
  const end = async (id: number) => {
    await auth.endSession(id);
    void sessions.refetch();
  };
  return (
    <Section title="Where you're signed in" description={t("Sign out of any device you don't recognise, then change your password.")}>
      <ul className="max-w-2xl divide-y divide-rule border-y border-rule">
        {(sessions.data?.sessions ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-[15px] font-semibold text-ink">
                {describeDevice(s.user_agent)}
                {s.current && <span className="ml-2 text-[13px] font-normal text-positive">{t("this device")}</span>}
              </p>
              <p className="text-[13px] text-ink-3">
                {t("Last active {date}", { date: longDate(s.last_seen) })} · {s.ip || "–"}
              </p>
            </div>
            {!s.current && (
              <Button variant="text" onClick={() => end(s.id)}>
                {t("Sign out")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Adds developer access (the developer tools) to this account with the developer code. */
function DeveloperAccess() {
  const t = useT();
  const { user, setUser } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setUser(await auth.becomeDeveloper(code));
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't save. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Developer access" description={t("Developer accounts can open the developer tools: the component gallery and the 3D test bench.")}>
      {user.is_developer ? (
        <div className="flex flex-wrap items-center gap-3">
          <DeveloperBadge />
          <Link to="/kit" className="text-[14.5px] text-accent underline-offset-4 hover:underline">
            {t("Open the developer tools")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex max-w-md flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <TextInput label="Developer access code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} error={error} />
          </div>
          <Button type="submit" disabled={!code.trim() || busy}>
            {t("Add developer access")}
          </Button>
        </form>
      )}
    </Section>
  );
}

function YourData() {
  const t = useT();
  const { logout, user } = useAuth();
  const demo = !!user?.is_demo;
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setError(null);
    try {
      const data = await auth.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "freightwise-my-data.json";
      a.click();
      // Some browsers start the download after the click returns; free the file a little later.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't download your data. Try again in a moment."));
    }
  };

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await auth.deleteAccount(password);
      // Signs out and reloads to the landing page.
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't delete. Try again in a moment."));
    }
  };

  return (
    <Section title="Your data" description={t("Download everything we hold about you, or delete your account and withdraw your consent.")}>
      <div className="max-w-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14.5px] text-ink-2">{t("Your profile, consent record, sessions and sign-in history, as a JSON file.")}</p>
          <Button onClick={download}>{t("Download my data")}</Button>
        </div>
        {error && !confirming && <FormError>{error}</FormError>}
        <div className="border-t border-rule pt-5">
          {!confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14.5px] text-ink-2">{t("Deleting your account removes your profile and sessions. It can't be undone.")}</p>
              <Button onClick={() => setConfirming(true)} className="text-negative">
                {t("Delete account")}
              </Button>
            </div>
          ) : (
            <form onSubmit={remove} className="max-w-md space-y-3">
              {error && <FormError>{error}</FormError>}
              {!demo && <PasswordInput label="Enter your password to confirm" value={password} onChange={setPassword} autoComplete="current-password" />}
              <div className="flex gap-3">
                <button type="submit" disabled={!password && !demo} className="h-[34px] rounded-[var(--radius-control)] bg-negative px-3 text-[14px] font-semibold text-surface disabled:opacity-60">
                  {t("Delete my account")}
                </button>
                <Button onClick={() => setConfirming(false)}>{t("Cancel")}</Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Section>
  );
}

export default function Account() {
  const t = useT();
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        title="Account"
        description={t("Member since {date}.", { date: user ? longDate(user.created_at.slice(0, 10)) : "–" })}
      />
      <Profile />
      {/* A demo account has no password of its own, and can't become a developer account. */}
      {!user?.is_demo && <ChangePassword />}
      <Sessions />
      {!user?.is_demo && <DeveloperAccess />}
      <YourData />
    </>
  );
}
