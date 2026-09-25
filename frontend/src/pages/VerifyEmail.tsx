import { useEffect, useRef, useState } from "react";
import { ApiError, auth } from "../api";
import { AuthLayout } from "../components/shell/PublicShell";
import { DevLink, FormError, FormNotice, PrimaryButton, TextInput } from "../components/ui/forms";
import { useT } from "../lib/i18n";
import { Link, useSearchParam } from "../lib/router";

export default function VerifyEmail() {
  const t = useT();
  const [token] = useSearchParam("token");
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");
  const [error, setError] = useState<string | null>(token ? null : t("This link is missing its code. Open the link from the email again."));
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<{ message: string; link?: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // The token works once, so don't send it twice (React runs effects twice in development).
    if (!token || started.current) return;
    started.current = true;
    auth
      .verifyEmail(token)
      .then(() => setState("done"))
      .catch((e) => {
        setState("failed");
        setError(e instanceof ApiError ? e.message : "Couldn't reach the service. Try again in a moment.");
      });
  }, [token]);

  if (state === "working") return <AuthLayout title="Confirming your email…">{null}</AuthLayout>;
  if (state === "done")
    return (
      <AuthLayout title="Email confirmed">
        <div className="space-y-4">
          <FormNotice>{t("Your account is ready. Sign in to start planning.")}</FormNotice>
          <Link to="/login" className="inline-flex h-[42px] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent text-[15px] font-semibold text-surface">
            {t("Sign in")}
          </Link>
        </div>
      </AuthLayout>
    );
  return (
    <AuthLayout title="This link didn't work">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await auth.resendVerification(email);
            setError(null);
            setNotice({ message: r.message, link: r.dev_link });
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Couldn't reach the service. Try again in a moment.");
          }
        }}
      >
        {error && <FormError>{t(error)}</FormError>}
        {notice && (
          <>
            <FormNotice>{t(notice.message)}</FormNotice>
            <DevLink link={notice.link} />
          </>
        )}
        <TextInput label="Work email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PrimaryButton type="submit" disabled={!email}>
          {t("Send a new link")}
        </PrimaryButton>
      </form>
    </AuthLayout>
  );
}
