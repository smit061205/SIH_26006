import { useT } from "../../lib/i18n";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../../lib/router";
import { NAV } from "./nav";

/** "g" then a letter jumps to a page. */
const GO: Record<string, string> = { c: "/plan", v: "/vessel-port", f: "/freight-outlook", s: "/scenarios", p: "/ports" };

function typing(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.getAttribute("role") === "combobox";
}

/** Keyboard shortcuts for moving between pages; "?" shows them. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "?" || (e.shiftKey && (e.key === "/" || e.code === "Slash"))) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
        pending.current = null;
        const to = GO[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
        return;
      }
      if (e.key === "g") pending.current = window.setTimeout(() => (pending.current = null), 1500);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const t = useT();
  const keyFor = (path: string) => Object.entries(GO).find(([, p]) => p === path)?.[0];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim animate-overlay-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18vh] z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-[var(--radius-surface)] border border-overlay-border bg-surface p-5 shadow-[var(--shadow-overlay)]"
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="serif text-[19px] font-semibold text-ink">{t("Keyboard shortcuts")}</Dialog.Title>
            <Dialog.Close className="-mr-1 p-1.5 text-ink-3 hover:text-ink" aria-label={t("Close")}>
              <X size={18} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          <dl className="divide-y divide-rule border-y border-rule text-[14px]">
            {NAV.map((n) => (
              <div key={n.path} className="flex items-center justify-between py-2">
                <dt className="text-ink-2">{t(n.label)}</dt>
                <dd className="flex gap-1">
                  <Key>g</Key>
                  <Key>{keyFor(n.path)}</Key>
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between py-2">
              <dt className="text-ink-2">{t("Show this list")}</dt>
              <dd>
                <Key>?</Key>
              </dd>
            </div>
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[3px] border border-rule-strong bg-sunken px-1.5 font-sans text-[12.5px] text-ink">
      {children}
    </kbd>
  );
}
