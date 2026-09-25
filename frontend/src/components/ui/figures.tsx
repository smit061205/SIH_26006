import { useTx } from "../../lib/i18n";
import type { ReactNode } from "react";

/** The page's answer, set in the serif with a signal rule. */
export function Verdict({
  children,
  support,
  size = "lg",
}: {
  children: ReactNode;
  support?: ReactNode;
  size?: "lg" | "sm";
}) {
  const tx = useTx();
  const text =
    size === "lg"
      ? "text-[21px] md:text-[25px] max-w-[40ch] md:max-w-[52ch] mb-0"
      : "text-[18px] md:text-[19px] max-w-[60ch]";
  return (
    <div className={`border-l-[3px] border-signal-fill pl-4 md:pl-5 ${size === "lg" ? "mb-8" : "mb-5"}`}>
      <p className={`serif leading-[1.3] font-[450] text-ink ${text}`}>{tx(children)}</p>
      {support && <p className="mt-2 text-[15px] text-ink-2 max-w-[68ch]">{tx(support)}</p>}
    </div>
  );
}

export function FigureRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:flex lg:gap-0 lg:divide-x lg:divide-rule">
      {children}
    </div>
  );
}

export function Figure({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  /** Colour the value by what it means (e.g. depth to spare, or over a limit). */
  tone?: "positive" | "negative";
}) {
  const tx = useTx();
  const color = tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="min-w-0 lg:flex-1 lg:px-6 lg:first:pl-0 lg:last:pr-0">
      <div className="text-[13px] font-semibold text-ink-3">{tx(label)}</div>
      <div className={`mt-1.5 text-[24px] md:text-[30px] leading-[1.1] font-semibold ${color} [font-variant-numeric:proportional-nums_lining-nums] break-words sm:whitespace-nowrap`}>
        {value}
        {unit && <span className="text-[14px] md:text-[15px] font-normal text-ink-3">{unit}</span>}
      </div>
      {note && <div className="mt-1.5 text-[13px] text-ink-3 leading-snug">{tx(note)}</div>}
    </div>
  );
}

/** A signed amount coloured by what it means, not by its sign. */
export function Delta({
  value,
  children,
  goodWhen = "negative",
}: {
  value: number;
  children: ReactNode;
  goodWhen?: "negative" | "positive";
}) {
  if (Math.abs(value) < 1e-9) return <span className="text-ink-3">{children}</span>;
  const good = goodWhen === "negative" ? value < 0 : value > 0;
  return <span className={good ? "text-positive" : "text-negative"}>{children}</span>;
}
