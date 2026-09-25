import { useT, useTx } from "../../lib/i18n";
import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSlider from "@radix-ui/react-slider";
import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { Children, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

const control =
  "h-[38px] rounded-[var(--radius-control)] border border-rule-strong bg-surface text-[14.5px] text-ink transition-colors duration-150 hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1";

export interface Option {
  value: string;
  label: string;
  /** Shorter text for the closed control, when the full label is long. */
  short?: string;
}

export function Select({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Accessible name when no visible <label> is attached. */
  label: string;
  /** Width utilities; defaults to filling the container. */
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  const tx = useTx();
  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        aria-label={tx(label)}
        className={`${control} inline-flex items-center justify-between gap-2 pl-3 pr-2.5 text-left data-[state=open]:border-accent ${className || "w-full"}`}
      >
        <span className="truncate">{tx(current?.short ?? current?.label ?? "Select")}</span>
        <RadixSelect.Icon className="shrink-0 text-ink-3">
          <ChevronDown size={16} strokeWidth={1.75} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] max-h-[min(22rem,var(--radix-select-content-available-height))] overflow-hidden rounded-[var(--radius-surface)] border border-overlay-border bg-surface shadow-[var(--shadow-overlay)] animate-menu-in"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer select-none items-center rounded-[2px] py-2 pl-8 pr-3 text-[14.5px] text-ink-2 outline-none data-[highlighted]:bg-hover data-[highlighted]:text-ink data-[state=checked]:font-semibold data-[state=checked]:text-ink"
              >
                <RadixSelect.ItemIndicator className="absolute left-2.5 text-accent">
                  <Check size={15} strokeWidth={2} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{tx(o.label)}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

const groupFmt = new Intl.NumberFormat("en-US");

/** Edits a number as text and commits a clamped value after a pause, on blur,
 *  or on Enter, so each keystroke doesn't trigger a recalculation. */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  unit,
  label,
  className = "",
}: {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  label: string;
  className?: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const commit = (text: string) => {
    window.clearTimeout(timer.current);
    const n = Number(text.replace(/[^\d.]/g, ""));
    if (text.trim() !== "" && Number.isFinite(n) && n > 0) {
      const next = clamp(Math.round(n));
      if (next !== value) onCommit(next);
    }
    setDraft(null);
  };

  const onChange = (text: string) => {
    setDraft(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const n = Number(text.replace(/[^\d.]/g, ""));
      if (text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(Math.round(n));
    }, 700);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
    if (e.key === "Escape") setDraft(null);
  };

  const bump = (dir: 1 | -1) => {
    // A value typed just before must not land after the step and undo it.
    window.clearTimeout(timer.current);
    setDraft(null);
    onCommit(clamp(value + dir * step));
  };

  const stepper =
    "flex w-8 items-center justify-center text-ink-3 hover:text-ink hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent transition-colors";

  return (
    <div className={`${control} inline-flex items-stretch overflow-hidden focus-within:border-accent ${className || "w-full"}`}>
      <button
        type="button"
        className={`${stepper} border-r border-rule`}
        onClick={() => bump(-1)}
        disabled={value <= min}
        aria-label={t("Decrease {label}", { label: t(label) })}
      >
        <Minus size={14} strokeWidth={1.75} />
      </button>
      <input
        inputMode="numeric"
        aria-label={t(label)}
        value={draft ?? groupFmt.format(value)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent px-2 text-right outline-none"
      />
      {unit && <span className="flex items-center pr-2 text-ink-3">{unit}</span>}
      <button
        type="button"
        className={`${stepper} border-l border-rule`}
        onClick={() => bump(1)}
        disabled={value >= max}
        aria-label={t("Increase {label}", { label: t(label) })}
      >
        <Plus size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);
  const tx = useTx();

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={tx(label)}
      onKeyDown={onKeyDown}
      className={`inline-flex rounded-[var(--radius-control)] bg-sunken p-[3px] ${className}`}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-[2px] px-3 py-[5px] text-[13.5px] transition-colors duration-150 ${
              on
                ? "bg-surface text-ink font-semibold shadow-[0_0_0_1px_var(--color-rule-strong)]"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {tx(o.label)}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  onChange,
  step = 1,
  format = String,
  valueText,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  step?: number;
  /** How the value and the ends of the scale are written. */
  format?: (v: number) => string;
  /** Screen-reader text for the current value, when the number alone isn't enough. */
  valueText?: string;
}) {
  const tx = useTx();
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[14px] text-ink-2">{tx(label)}</span>
        <span className="text-[20px] font-semibold text-ink tabular-nums">{format(value)}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-6 w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        aria-label={tx(label)}
      >
        <RadixSlider.Track className="relative h-[2px] grow bg-rule-strong">
          <RadixSlider.Range className="absolute h-full bg-accent" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-label={tx(label)}
          aria-valuetext={valueText ?? format(value)}
          className="block h-4 w-4 rounded-full border-2 border-accent bg-surface transition-transform duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2" />
      </RadixSlider.Root>
      <div className="mt-1 flex justify-between text-[12.5px] text-ink-3">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "secondary" | "text" }) {
  const tx = useTx();
  const styles =
    variant === "secondary"
      ? "inline-flex h-[34px] items-center gap-1.5 rounded-[var(--radius-control)] border border-rule-strong bg-surface px-3 text-[14px] text-ink hover:border-ink-3 hover:bg-hover"
      : "inline-flex items-center gap-1.5 text-[14px] text-accent underline-offset-4 hover:underline";
  return (
    <button type="button" className={`${styles} transition-colors duration-150 ${className}`} {...rest}>
      {Children.map(children, (c) => tx(c))}
    </button>
  );
}

/** A label beside or above its control. */
export function Field({
  label,
  children,
  layout = "stack",
  className = "",
}: {
  label: string;
  children: ReactNode;
  layout?: "stack" | "inline";
  className?: string;
}) {
  const t = useT();
  const id = useId();
  // A group with a visible name, not a <label>: a label wrapping a stepper or
  // a segmented control would pass clicks on its text to the first button inside.
  if (layout === "inline") {
    return (
      <div role="group" aria-labelledby={id} className={`flex items-center gap-2.5 ${className}`}>
        <span id={id} className="text-[13px] font-semibold text-ink-3 whitespace-nowrap">
          {t(label)}
        </span>
        {children}
      </div>
    );
  }
  return (
    <div role="group" aria-labelledby={id} className={`block ${className}`}>
      <span id={id} className="mb-1.5 block text-[13px] font-semibold text-ink-3">
        {t(label)}
      </span>
      {children}
    </div>
  );
}
