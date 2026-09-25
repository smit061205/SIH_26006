import { useTx } from "../../lib/i18n";
import { Children, type ReactNode, cloneElement, isValidElement } from "react";

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto bg-surface border border-rule rounded-[var(--radius-surface)] ${className}`}>
      <table className="w-full border-collapse text-[14px] leading-[1.4]">{children}</table>
    </div>
  );
}

type Align = "left" | "right" | "center";
const alignClass: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
}) {
  const tx = useTx();
  return (
    <th
      scope="col"
      className={`bg-sunken px-3 py-2.5 text-[12.5px] font-semibold text-ink-3 whitespace-nowrap border-b border-rule-strong ${alignClass[align]} ${className}`}
    >
      {tx(children)}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2.5 border-b border-rule whitespace-nowrap ${alignClass[align]} ${className}`}>
      {children}
    </td>
  );
}

const marker = {
  none: "",
  accent: "[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-accent)]",
  signal: "[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-signal-fill)]",
};

/** A table row. With onSelect, the whole row is clickable and its first cell
 *  holds a real button, so keyboards and screen readers reach it as one. */
export function Tr({
  children,
  onSelect,
  selected = false,
  mark = "none",
  label,
}: {
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  mark?: keyof typeof marker;
  label?: string;
}) {
  const interactive = !!onSelect;
  let cells = children;
  if (interactive) {
    let first = true;
    cells = Children.map(children, (child) => {
      if (!first || !isValidElement<{ children?: ReactNode }>(child)) return child;
      first = false;
      return cloneElement(child, {
        children: (
          <button
            type="button"
            aria-label={label}
            aria-pressed={selected}
            className="text-left font-[inherit] text-[inherit] outline-offset-2"
          >
            {child.props.children}
          </button>
        ),
      });
    });
  }
  // A selected row keeps the recommendation's mark; the tint shows the selection.
  const edge = mark !== "none" ? marker[mark] : selected ? marker.accent : "";
  return (
    <tr
      onClick={onSelect}
      className={`transition-colors duration-150 [&:last-child>td]:border-b-0 ${
        interactive ? "cursor-pointer" : ""
      } ${selected ? "bg-accent-tint" : interactive ? "hover:bg-hover" : ""} ${edge}`}
    >
      {cells}
    </tr>
  );
}

/** Phone-width replacement for a wide table: one row per item. */
export function MobileList({ children }: { children: ReactNode }) {
  return (
    <ul className="bg-surface border border-rule rounded-[var(--radius-surface)] divide-y divide-rule">{children}</ul>
  );
}

export function MobileItem({
  children,
  onSelect,
  selected = false,
  mark = "none",
}: {
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  mark?: "none" | "signal";
}) {
  const edge = selected
    ? "shadow-[inset_3px_0_0_var(--color-accent)] bg-accent-tint"
    : mark === "signal"
      ? "shadow-[inset_3px_0_0_var(--color-signal-fill)]"
      : "";
  if (!onSelect) return <li className={`px-4 py-3.5 ${edge}`}>{children}</li>;
  return (
    <li className={edge}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="w-full text-left px-4 py-3.5">
        {children}
      </button>
    </li>
  );
}
