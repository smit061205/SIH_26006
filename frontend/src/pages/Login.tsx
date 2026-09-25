import { type FormEvent, useState } from "react";
import { ApiError, auth } from "../api";
import { Checkbox, DevLink, FormError, FormNotice, PasswordInput, PrimaryButton, TextInput } from "../components/ui/forms";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { safeNext } from "../lib/nextPath";
import { Link, redirect, useSearchParam } from "../lib/router";

/** Sign-in form: email, password, keep me signed in, and the unconfirmed-email path. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm() {
  const t = useT();
  const { login } = useAuth();
  const [next] = useSearchParam("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The lockout message carries a number of minutes, so it is matched rather than looked up.
  const lockoutText = (message: string) => {
    const minutes = message.match(/^Too many attempts\. Try again in (\d+) minutes/)?.[1];
    return minutes ? t("Too many attempts. Try again in {minutes} minutes or reset your password.", { minutes }) : t(message);
  };
  const [unverified, setUnverified] = useState(false);
  const [notice, setNotice] = useState<{ message: string; link?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setUnverified(false);
    if (!EMAIL.test(email.trim())) return setError(t("Enter a valid email address."));
    setBusy(true);
    try {
      await login(email, password, remember);
      // Replace, so Back doesn't return to the sign-in form.
      redirect(safeNext(next), false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setUnverified(true);
      setError(err instanceof ApiError ? lockoutText(err.message) : t("Couldn't reach the service. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const r = await auth.resendVerification(email);
      setError(null);
      setNotice({ message: r.message, link: r.dev_link });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Couldn't reach the service. Try again in a moment."));
    }
  };

  return (
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <FormError>
            {t(error)}
            {unverified && (
              <button type="button" onClick={resend} className="mt-1 block text-accent underline">
                {t("Send the confirmation email again")}
              </button>
            )}
          </FormError>
        )}
        {notice && (
          <>
            <FormNotice>{t(notice.message)}</FormNotice>
            <DevLink link={notice.link} />
          </>
        )}
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="flex items-center justify-between gap-3">
          <Checkbox checked={remember} onChange={setRemember}>
            {t("Keep me signed in for 30 days")}
          </Checkbox>
          <Link to="/forgot-password" className="shrink-0 text-[14px] text-accent underline-offset-4 hover:underline">
            {t("Forgot password?")}
          </Link>
        </div>
        <PrimaryButton type="submit" busy={busy} disabled={!email || !password}>
          {t("Sign in")}
        </PrimaryButton>
      </form>
  );
}
