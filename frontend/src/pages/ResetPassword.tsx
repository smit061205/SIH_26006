import { type FormEvent, useState } from "react";
import { ApiError, auth } from "../api";
import { AuthLayout } from "../components/shell/PublicShell";
import { FormError, FormNotice, PasswordInput, PrimaryButton } from "../components/ui/forms";
import { useT } from "../lib/i18n";
import { meetsRules } from "../lib/passwordStrength";
import { Link, useSearchParam } from "../lib/router";

export default function ResetPassword() {
  const t = useT();
  const [token] = useSearchParam("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return setError(t("This link is missing its code. Open the link from the email again."));
    if (!meetsRules(password)) return setError(t("Your password doesn't meet every rule yet. See the list under it."));
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't reach the service. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <AuthLayout title="Password changed">
        <div className="space-y-4">
          <FormNotice>{t("You've been signed out everywhere. Sign in with your new password.")}</FormNotice>
          <Link to="/login" className="inline-flex h-[42px] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent text-[15px] font-semibold text-surface">
            {t("Sign in")}
          </Link>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout
      title="Choose a new password"
      footer={
        <Link to="/forgot-password" className="text-accent underline-offset-4 hover:underline">
          {t("Need a new link?")}
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <FormError>{error}</FormError>}
        <PasswordInput label="New password" value={password} onChange={setPassword} autoComplete="new-password" showStrength />
        <PrimaryButton type="submit" busy={busy} disabled={!password}>
          {t("Save new password")}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
