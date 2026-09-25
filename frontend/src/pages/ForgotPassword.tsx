import { type FormEvent, useState } from "react";
import { auth } from "../api";
import { AuthLayout } from "../components/shell/PublicShell";
import { DevLink, FormError, FormNotice, PrimaryButton, TextInput } from "../components/ui/forms";
import { useT } from "../lib/i18n";
import { Link } from "../lib/router";

export default function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ message: string; link?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await auth.forgotPassword(email);
      setSent({ message: r.message, link: r.dev_link });
    } catch {
      setError(t("Couldn't reach the service. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={t("Enter your work email and we'll send a link to choose a new password.")}
      footer={
        <Link to="/login" className="text-accent underline-offset-4 hover:underline">
          {t("Back to sign in")}
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <FormNotice>{t(sent.message)}</FormNotice>
          <DevLink link={sent.link} />
          <p className="text-[14px] text-ink-2">{t("The link works once and expires in 30 minutes.")}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <FormError>{error}</FormError>}
          <TextInput label="Work email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <PrimaryButton type="submit" busy={busy} disabled={!email}>
            {t("Send reset link")}
          </PrimaryButton>
        </form>
      )}
    </AuthLayout>
  );
}
