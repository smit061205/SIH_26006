import { Code2 } from "lucide-react";
import { useT } from "../../lib/i18n";

/** Marks a developer account (signed up or upgraded with the developer access code). */
export function DeveloperBadge() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-tint px-2 py-0.5 text-[12px] font-semibold text-accent">
      <Code2 size={12} strokeWidth={2} aria-hidden />
      {t("Developer")}
    </span>
  );
}
