import { useIsFetching } from "@tanstack/react-query";
import { API_BASE } from "../../api";
import { useT } from "../../lib/i18n";
import { useHealth } from "../../lib/queries";
import { ProgressHairline } from "../ui/feedback";
import { Button } from "../ui/inputs";

export function GlobalProgress() {
  const fetching = useIsFetching({ predicate: (q) => q.meta?.progress !== false });
  return <ProgressHairline active={fetching > 0} />;
}

export function ServiceStatus() {
  const health = useHealth();
  const t = useT();
  if (!health.isError) return null;
  return (
    <div role="status" className="bg-surface border-b border-rule">
      <div className="mx-auto flex max-w-[1264px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <p className="text-[14px] text-ink">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-negative align-middle" />
          {t("Can't reach the Freightwise service at {url}. Retrying every minute.", { url: API_BASE || window.location.origin })}
        </p>
        <Button onClick={() => void health.refetch()}>{t("Retry now")}</Button>
      </div>
    </div>
  );
}

export function Footer() {
  const t = useT();
  return (
    <footer className="mt-auto border-t border-rule">
      <div className="mx-auto max-w-[1264px] px-4 py-6 sm:px-6 lg:px-8 text-[13px] text-ink-3 leading-relaxed">
        <p>
          <span className="serif font-semibold text-ink-2">Freightwise</span> · Smart India Hackathon 2026 ·{" "}
          {t("Problem SIH26006, Ministry of Steel")}
        </p>
        <p className="mt-1">
          {t("Sea state")}: Open-Meteo · {t("Port activity")}: IMF PortWatch · {t("Coal, oil and rupee")}: FRED ·{" "}
          {t("Exchange rate")}: European Central Bank via Frankfurter · {t("Vessel positions")}: MarineTraffic
        </p>
        <p className="mt-1">{t("Press ? for keyboard shortcuts.")}</p>
      </div>
    </footer>
  );
}
