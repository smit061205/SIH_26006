import { useT, useTx } from "../../lib/i18n";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string;
  description: string;
  meta?: string;
  /** Page-level commands (print, save), shown beside the title. */
  actions?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="mb-9 md:mb-11">
      {meta && <p className="text-[12.5px] font-semibold text-ink-3 mb-2.5">{t(meta)}</p>}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <h1 className="serif text-[27px] md:text-[34px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
          {t(title)}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
      <p className="mt-2.5 text-[15px] md:text-[16px] text-ink-2 max-w-[74ch]">{t(description)}</p>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  first = false,
  id,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** First section on a page sits directly under the header. */
  first?: boolean;
  /** Anchor for links such as /freight-outlook#contract. */
  id?: string;
}) {
  const tx = useTx();
  return (
    <section id={id} className={first ? "" : "mt-12 md:mt-14"}>
      <div className="border-t border-ink pt-3 mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="serif text-[19px] md:text-[20px] leading-[1.3] font-semibold text-ink">{tx(title)}</h2>
          {description && <p className="mt-1 text-[14px] text-ink-3 max-w-[68ch]">{tx(description)}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label/value pairs, set like a specification sheet. */
export function SpecList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  const tx = useTx();
  return (
    <dl className="divide-y divide-rule border-y border-rule">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-[14px] text-ink-3">{tx(r.label)}</dt>
          <dd className="text-[14.5px] text-ink text-right">{tx(r.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
