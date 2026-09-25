import { type FormEvent, type ReactNode, useState } from "react";
import { ApiError, auth } from "../api";
import { Checkbox, DevLink, FormError, FormNotice, LinkedSentence, PasswordInput, PrimaryButton, SelectInput, TextInput } from "../components/ui/forms";
import { useT } from "../lib/i18n";
import { meetsRules } from "../lib/passwordStrength";
import { ROLES, UNITS } from "../lib/accountOptions";
import { Link } from "../lib/router";

/** What we collect and why, shown before consent (DPDP Rules 2025: itemised, purpose-specific, easy to withdraw). */
function ConsentNotice() {
  const t = useT();
  return (
    <details className="rounded-[var(--radius-control)] border border-rule bg-sunken px-3 py-2.5 text-[13.5px] text-ink-2">
      <summary className="cursor-pointer font-semibold text-ink">{t("What we collect and why")}</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>{t("Your name, work email, organisation, role and plant: to create your account and show you plans for your plant.")}</li>
        <li>{t("Your password, stored only as a one-way hash we can't read.")}</li>
        <li>{t("Sign-in records (time, IP address, browser): to keep your account secure and show you where you're signed in.")}</li>
      </ul>
      <p className="mt-2">
        {t("We don't sell or share this data. You can download it, correct it or delete your account at any time from your Account page, which also withdraws your consent.")}{" "}
        <Link to="/privacy" className="text-accent underline">
          {t("Read the privacy notice")}
        </Link>
      </p>
    </details>
  );
}

/** What the account step shows after sign-up, in place of the form. */
export type SignupResult = { kind: "email"; email: string; link?: string } | { kind: "developer" };

/**
 * Create-account form. Asks only for what the service needs (name, email,
 * password) plus three optional details that tailor the plans (organisation,
 * role, plant). A developer access code, if given, makes the account ready at
 * once with developer tools.
 */
export function SignUpForm({ onDone }: { onDone: (r: SignupResult) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("SAIL");
  const [role, setRole] = useState("");
  const [plant, setPlant] = useState("");
  const [password, setPassword] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) return setError(t("Enter your name and email."));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t("Enter a valid email address."));
    if (!meetsRules(password)) return setError(t("Your password doesn't meet every rule yet. See the list under it."));
    if (!privacy || !terms) return setError(t("Please agree to the privacy notice and the terms to create an account."));
    setBusy(true);
    try {
      const r = await auth.signup({
        name,
        email,
        organisation,
        role_title: role,
        plant,
        password,
        accept_privacy: privacy,
        accept_terms: terms,
        developer_code: showCode ? code.trim() : "",
      });
      onDone(r.developer ? { kind: "developer" } : { kind: "email", email, link: r.dev_link });
    } catch (err) {
      setError(err instanceof ApiError ? t(err.message) : t("Couldn't reach the service. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <FormError>{error}</FormError>}
      <TextInput label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
      <TextInput
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint={t("Your work email is best. We'll send a link to confirm it.")}
        required
      />
      <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="new-password" showStrength context={[name, email]} />
      <fieldset className="space-y-4 rounded-[var(--radius-control)] border border-rule px-3 pb-3 pt-1">
        <legend className="px-1 text-[13px] font-semibold text-ink-3">{t("About your work (optional)")}</legend>
        <TextInput label="Organisation" autoComplete="organization" value={organisation} onChange={(e) => setOrganisation(e.target.value)} maxLength={120} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectInput label="Role" value={role} onChange={setRole} options={ROLES} />
          <SelectInput label="Plant or unit" value={plant} onChange={setPlant} options={UNITS} />
        </div>
        <p className="text-[12.5px] text-ink-3">{t("Your plant is chosen for you when you plan a shipment.")}</p>
      </fieldset>
      <ConsentNotice />
      <div className="space-y-2.5">
        <Checkbox checked={privacy} onChange={setPrivacy}>
          <LinkedSentence
            text={t("I have read the {link} and agree to my data being used as it describes.")}
            link={
              <Link to="/privacy" className="text-accent underline">
                {t("privacy notice")}
              </Link>
            }
          />
        </Checkbox>
        <Checkbox checked={terms} onChange={setTerms}>
          <LinkedSentence
            text={t("I agree to the {link}.")}
            link={
              <Link to="/terms" className="text-accent underline">
                {t("terms of use")}
              </Link>
            }
          />
        </Checkbox>
      </div>
      {showCode ? (
        <TextInput
          label="Developer access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          hint={t("Gives a ready-to-use developer account, without the email step.")}
          autoFocus
        />
      ) : (
        <button type="button" onClick={() => setShowCode(true)} className="text-[14px] text-accent underline-offset-4 hover:underline">
          {t("Have a developer code?")}
        </button>
      )}
      <PrimaryButton type="submit" busy={busy}>
        {t("Create account")}
      </PrimaryButton>
    </form>
  );
}

/** After sign-up: the account is ready (developer), or the email step. */
export function SignupDone({ result, onSignIn, children }: { result: SignupResult; onSignIn: () => void; children?: ReactNode }) {
  const t = useT();
  if (result.kind === "developer") {
    return (
      <div className="space-y-4">
        <FormNotice>{t("Your developer account is ready. Sign in to start.")}</FormNotice>
        <PrimaryButton type="button" onClick={onSignIn}>
          {t("Sign in")}
        </PrimaryButton>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-2">
        {t("If {email} can be used for a new account, we've sent it a link to confirm. The link works once and expires in 24 hours.", { email: result.email })}
      </p>
      <DevLink link={result.link} />
      <p className="text-[14px] text-ink-2">
        <LinkedSentence
          text={t("No email after a few minutes? Check spam, or {link}.")}
          link={
            <button type="button" onClick={onSignIn} className="text-accent underline">
              {t("sign in to send it again")}
            </button>
          }
        />
      </p>
      {children}
    </div>
  );
}
