import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { passwordRules, passwordWarning } from "../../lib/passwordStrength";
import { Select } from "./inputs";

const input =
  "h-[40px] w-full rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none aria-[invalid=true]:border-negative";

/** A labelled text input with an optional hint and error, wired for screen readers. */
export function TextInput({
  label,
  hint,
  error,
  className = "",
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
} & InputHTMLAttributes<HTMLInputElement>) {
  const t = useT();
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold text-ink">
        {t(label)}
      </label>
      <input id={id} className={input} aria-invalid={!!error} aria-describedby={described} {...rest} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[13px] text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[13px] text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

/** Password field with show/hide (paste is always allowed) and, for new passwords, live guidance. */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  error,
  showStrength = false,
  context = [],
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string | null;
  showStrength?: boolean;
  /** Words the password shouldn't be built on (name, email). */
  context?: string[];
}) {
  const t = useT();
  const id = useId();
  const [visible, setVisible] = useState(false);
  const rules = showStrength ? passwordRules(value) : null;
  const warning = showStrength ? passwordWarning(value, context) : null;
  const described = [showStrength ? `${id}-strength` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold text-ink">
        {t(label)}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          className={`${input} pr-11`}
          aria-invalid={!!error}
          aria-describedby={described}
          maxLength={128}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-3 hover:text-ink"
          aria-label={visible ? t("Hide password") : t("Show password")}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={17} strokeWidth={1.75} /> : <Eye size={17} strokeWidth={1.75} />}
        </button>
      </div>
      {rules && (
        <div id={`${id}-strength`} className="mt-2" aria-live="polite">
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {rules.map((r) => (
              <li key={r.label} className={`flex items-center gap-1.5 text-[13px] ${r.met ? "text-positive" : "text-ink-3"}`}>
                {r.met ? <Check size={14} strokeWidth={2.2} aria-hidden /> : <Circle size={12} strokeWidth={2} aria-hidden className="mx-px" />}
                <span>{t(r.label, r.vars)}</span>
                <span className="sr-only">{r.met ? t("done") : t("not yet")}</span>
              </li>
            ))}
          </ul>
          {warning && <p className="mt-1.5 text-[13px] text-negative">{t(warning)}</p>}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[13px] text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

/** A labelled dropdown styled to match TextInput. */
export function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const t = useT();
  return (
    <div>
      <span aria-hidden className="mb-1.5 block text-[14px] font-semibold text-ink">
        {t(label)}
      </span>
      <Select label={t(label)} value={value} onChange={onChange} options={options.map((o) => ({ value: o, label: t(o) }))} className="w-full h-[40px]! text-[15px]!" />
    </div>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] h-[18px] w-[18px] shrink-0 accent-[var(--color-accent)]"
      />
      <label htmlFor={id} className="text-[14px] leading-snug text-ink-2">
        {children}
      </label>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  // Errors sit at the top of the form, which may be scrolled away when submitting.
  const ref = useRef<HTMLDivElement>(null);
  // Scroll only when the message itself changes, not on every re-render (typing in the form).
  const shown = useRef("");
  useEffect(() => {
    const text = ref.current?.textContent ?? "";
    if (text && text !== shown.current) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    shown.current = text;
  });
  if (!children) return null;
  return (
    <div ref={ref} role="alert" className="scroll-mt-24 rounded-[var(--radius-control)] border-l-[3px] border-negative bg-surface px-3 py-2.5 text-[14px] text-ink">
      {children}
    </div>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-[var(--radius-control)] border-l-[3px] border-positive bg-surface px-3 py-2.5 text-[14px] text-ink">
      {children}
    </div>
  );
}

/** In development without email set up, the server returns the link it would have emailed. */
export function DevLink({ link }: { link?: string }) {
  const t = useT();
  if (!link) return null;
  const path = link.replace(/^https?:\/\/[^/]+/, "");
  return (
    <div className="rounded-[var(--radius-control)] border border-dashed border-rule-strong px-3 py-3 text-[13.5px] text-ink-2">
      <p>{t("Email sending isn't set up on this server yet, so the link is here instead of in your inbox.")}</p>
      <a
        href={path}
        className="mt-2.5 inline-flex h-9 items-center rounded-[var(--radius-control)] border border-accent px-3 text-[14px] font-semibold text-accent hover:bg-accent-tint"
      >
        {t("Open the link")}
      </a>
    </div>
  );
}

export function PrimaryButton({ children, busy, ...rest }: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const t = useT();
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={`inline-flex h-[42px] w-full items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 text-[15px] font-semibold text-surface transition-colors hover:bg-accent-hover disabled:opacity-60 ${rest.className ?? ""}`}
    >
      {busy ? t("Please wait…") : children}
    </button>
  );
}

/** Puts a link where {link} sits in a translated sentence, as word order differs by language. */
export function LinkedSentence({ text, link }: { text: string; link: ReactNode }) {
  const [before, after = ""] = text.split("{link}");
  return (
    <>
      {before}
      {link}
      {after}
    </>
  );
}
