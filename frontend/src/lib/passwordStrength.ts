/**
 * Live guidance while choosing a password. It mirrors the server's rules
 * (src/password_policy.py): at least 8 characters with a capital letter, a
 * number and a special character, and nothing built on the person's name or
 * this service. The server has the final say, including the common-password list.
 */
export const MIN_PASSWORD = 8;

export interface PasswordRule {
  label: string;
  vars?: Record<string, number>;
  met: boolean;
}

/** The four rules, each marked met or not. */
export function passwordRules(password: string): PasswordRule[] {
  return [
    { label: "At least {n} characters", vars: { n: MIN_PASSWORD }, met: password.length >= MIN_PASSWORD },
    { label: "A capital letter", met: /[A-Z]/.test(password) },
    { label: "A number", met: /\d/.test(password) },
    { label: "A special character, like ! @ # -", met: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function meetsRules(password: string) {
  return passwordRules(password).every((r) => r.met);
}

/** A warning beyond the rules, or null: passwords built on the name, email or this service. */
export function passwordWarning(password: string, context: string[] = []): string | null {
  const compact = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!compact) return null;
  const words = [...context.flatMap((c) => c.toLowerCase().split(/[^a-z0-9]+/)), "freightwise", "sail", "password"].filter((w) => w.length >= 4);
  const letters = compact.replace(/\d/g, "");
  if (words.some((w) => compact.includes(w) && letters.length - w.length < 4)) return "Don't build it around your name, email or this service's name.";
  if (new Set(compact).size <= 2) return "Avoid repeated characters.";
  return null;
}
