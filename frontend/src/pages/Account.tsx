import { type FormEvent, useState } from "react";
import { ApiError, auth } from "../api";
import { FormError, FormNotice, SelectInput, TextInput } from "../components/ui/forms";
import { Button } from "../components/ui/inputs";
import { PageHeader, Section } from "../components/ui/layout";
import { ROLES, UNITS } from "../lib/accountOptions";
import { useAuth } from "../lib/auth";
import { longDate } from "../lib/format";
import { useT } from "../lib/i18n";

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
    <Section first title="Profile" description={t("Optional: your name and plant make the plans yours for this session.")}>
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

/** Leave the demo: its session and anything saved in it are deleted now rather than after a day. */
function EndDemo() {
  const t = useT();
  const { logout } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = async () => {
    setError(null);
    setBusy(true);
    try {
      await auth.deleteAccount("");
      // Signs out and reloads to the landing page.
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't end the demo. Try again in a moment."));
      setBusy(false);
    }
  };
  return (
    <Section title="End the demo" description={t("Your demo session and anything saved in it (plant stock, alert settings) are deleted after a day. End it now to delete them straight away.")}>
      <div className="max-w-2xl space-y-3">
        {error && <FormError>{error}</FormError>}
        <Button onClick={end} disabled={busy} className="text-negative">
          {t("End the demo and delete its data")}
        </Button>
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
        title="Demo session"
        description={t("Started {date}. Your name and plant here set the defaults for your plans.", { date: user ? longDate(user.created_at.slice(0, 10)) : "–" })}
      />
      <Profile />
      <EndDemo />
    </>
  );
}
