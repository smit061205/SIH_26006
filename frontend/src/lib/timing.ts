import type { TimingResponse } from "../types";
import { num, shortDate } from "./format";
import { type T, en } from "./i18n";

/** Why the timing signal says what it does (the backend's rule, in words). */
export function signalReason(t: TimingResponse, tr: T = en): string {
  const saving = num(t.best_fix.saving_vs_now_pct, 0);
  const date = shortDate(t.best_fix.date);
  const downside = num(Math.max(0, ((t.best_fix.upper - t.current_rate) / t.current_rate) * 100), 0);
  if (t.signal === "wait")
    return tr("The week of {date} is expected to be {saving}% cheaper, and even the top of its range is {down}% above today.", {
      date,
      saving,
      down: downside,
    });
  if (t.signal === "stagger")
    return tr("The week of {date} is expected to be {saving}% cheaper, but its range reaches {down}% above today, so fix part now and part later.", {
      date,
      saving,
      down: downside,
    });
  return tr("No week in the fixing window is expected to be more than 2% cheaper than today.");
}
