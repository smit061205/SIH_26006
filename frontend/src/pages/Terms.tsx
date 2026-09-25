import type { ReactNode } from "react";
import { useT } from "../lib/i18n";

function Block({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  return (
    <section className="mt-8">
      <h2 className="serif text-[20px] font-semibold text-ink">{t(title)}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function Terms() {
  const t = useT();
  return (
    <article className="mx-auto w-full max-w-[72ch] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-ink-3">{t("Last updated {date}", { date: "24 September 2026" })}</p>
      <h1 className="serif mt-2 text-[32px] font-semibold text-ink">{t("Terms of use")}</h1>
      <Block title="Using Freightwise">
        <p>{t("Freightwise helps plan coking-coal shipments: which ship and port to use, when to fix a charter, and what could go wrong. Use it for that purpose, and don't try to access other people's accounts, overload the service or get around its security.")}</p>
      </Block>
      <Block title="Your account">
        <p>{t("Keep your password to yourself and tell us if you think someone else has used your account. You're responsible for what's done with it. One account per person.")}</p>
      </Block>
      <Block title="The figures">
        <p>{t("Plans and forecasts are built from public market and port data and from reference figures that change over time. They support commercial decisions; they don't replace them.")}</p>
      </Block>
      <Block title="Data sources">
        <p>{t("Sea-state forecasts: Open-Meteo. Port activity: IMF PortWatch. Coal, oil and currency prices: FRED. Exchange rates: European Central Bank via Frankfurter. Vessel positions: MarineTraffic. Each source's own terms apply to its data.")}</p>
      </Block>
      <Block title="Changes and ending your account">
        <p>{t("We may change these terms; we'll tell you before changes apply. You can delete your account at any time from your Account page.")}</p>
      </Block>
    </article>
  );
}
