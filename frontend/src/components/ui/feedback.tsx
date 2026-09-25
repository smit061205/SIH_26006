import { useT, useTx } from "../../lib/i18n";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "./inputs";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-[var(--radius-control)] bg-sunken ${className}`} />;
}

/** True once `ms` have passed since mount: for "still working" hints on slow loads. */
function useAfter(ms: number) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return done;
}

/** Placeholder shaped like a page: header, figure row, a table. */
export function PageSkeleton() {
  const t = useT();
  const slow = useAfter(6000);
  return (
    <div aria-busy="true" aria-label={t("Loading")}>
      {slow && (
        <p role="status" className="mb-5 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-accent-tint px-3 py-2 text-[14px] text-ink-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          {t("Still working. If the server has been idle it takes up to a minute to start.")}
        </p>
      )}
      <Skeleton className="h-4 w-40 mb-3" />
      <Skeleton className="h-9 w-72 mb-3" />
      <Skeleton className="h-4 w-full max-w-lg mb-11" />
      <Skeleton className="h-7 w-full max-w-xl mb-8" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton className="h-3.5 w-24 mb-2.5" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="border-l-[3px] border-negative bg-surface px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[14.5px] text-ink">{t(message)}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  const tx = useTx();
  return (
    <div className="border border-rule bg-surface px-5 py-8 text-center text-[15px] text-ink-2 rounded-[var(--radius-surface)]">
      {tx(children)}
    </div>
  );
}

/** Holds the previous render while new data loads, instead of flashing a spinner. */
export function Refreshing({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div aria-busy={active} className={`transition-opacity duration-150 ${active ? "opacity-55" : "opacity-100"}`}>
      {children}
    </div>
  );
}

export function ProgressHairline({ active }: { active: boolean }) {
  return (
    <div aria-hidden className="relative h-[2px] overflow-hidden">
      {active && <div className="absolute inset-y-0 left-0 w-2/5 bg-accent animate-hairline" />}
    </div>
  );
}
