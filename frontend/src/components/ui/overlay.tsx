import { useT, useTx } from "../../lib/i18n";
import * as Dialog from "@radix-ui/react-dialog";
import * as RadixPopover from "@radix-ui/react-popover";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const tx = useTx();
  return (
    <RadixTooltip.Root delayDuration={150}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-w-[300px] rounded-[var(--radius-surface)] border border-overlay-border bg-surface px-3 py-2 text-[13.5px] leading-[1.45] text-ink-2 shadow-[var(--shadow-overlay)] animate-menu-in"
        >
          {tx(content)}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** Bottom sheet on phones. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim animate-overlay-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-[6px] bg-paper shadow-[var(--shadow-overlay)] animate-sheet-up"
        >
          <div className="sticky top-0 flex items-center justify-between border-b border-rule bg-paper px-4 py-3">
            <Dialog.Title className="serif text-[19px] font-semibold text-ink">{t(title)}</Dialog.Title>
            <Dialog.Close className="-mr-1 p-1.5 text-ink-3 hover:text-ink" aria-label={t("Close")}>
              <X size={18} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          <div className="px-4 py-5">{children}</div>
          {footer && <div className="sticky bottom-0 border-t border-rule bg-paper px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Small panel anchored to a button, for settings that are rarely changed. */
export function Popover({
  trigger,
  title,
  children,
  align = "end",
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const t = useT();
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={t(title)}
          className="z-50 w-[min(340px,calc(100vw-24px))] rounded-[var(--radius-surface)] border border-overlay-border bg-surface p-4 shadow-[var(--shadow-overlay)] animate-menu-in"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[14px] font-semibold text-ink">{t(title)}</span>
            <RadixPopover.Close className="-mr-1 p-1 text-ink-3 hover:text-ink" aria-label={t("Close")}>
              <X size={16} strokeWidth={1.75} />
            </RadixPopover.Close>
          </div>
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
