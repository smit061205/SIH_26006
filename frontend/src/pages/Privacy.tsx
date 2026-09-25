import type { ReactNode } from "react";
import { useT } from "../lib/i18n";
import { Link } from "../lib/router";

export const NOTICE_VERSION = "24 September 2026";

function Block({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  return (
    <section className="mt-8">
      <h2 className="serif text-[20px] font-semibold text-ink">{t(title)}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

/** Privacy notice written to the DPDP Act 2023 and DPDP Rules 2025: itemised data, purposes, rights, and how to withdraw consent. */
export default function Privacy() {
  const t = useT();
  return (
    <article className="mx-auto w-full max-w-[72ch] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-ink-3">{t("Last updated {date}", { date: NOTICE_VERSION })}</p>
      <h1 className="serif mt-2 text-[32px] font-semibold text-ink">{t("Privacy notice")}</h1>
      <p className="mt-3 text-[16px] text-ink-2">
        {t("This notice explains what personal data Freightwise collects when you create and use an account, why, how long we keep it, and how you can see, correct or delete it. It follows India's Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.")}
      </p>

      <Block title="Who is responsible">
        <p>{t("Freightwise is operated by [organisation name and address, to be completed before launch], the data fiduciary for your account data.")}</p>
      </Block>

      <Block title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("Account details you give us: full name, work email, organisation, role and plant or unit.")}</li>
          <li>{t("Your password, stored only as a salted one-way hash (scrypt). We can't read it.")}</li>
          <li>{t("Your consent: which version of this notice you agreed to, and when.")}</li>
          <li>{t("Sign-in records: when you signed in or out, your IP address and browser, and failed attempts.")}</li>
        </ul>
        <p>{t("We don't collect your phone number, government ID or location, and the shipments you plan are not linked to your identity.")}</p>
      </Block>

      <Block title="Why we use it">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("To create your account, sign you in and keep you signed in.")}</li>
          <li>{t("To send the emails you need: confirming your address and resetting your password.")}</li>
          <li>{t("To keep accounts secure: blocking repeated wrong passwords and showing you where you're signed in.")}</li>
        </ul>
        <p>{t("We use it for nothing else. We don't sell it, share it for advertising or use it to profile you.")}</p>
      </Block>

      <Block title="How long we keep it">
        <p>{t("Account details: while your account exists. Sign-in records: 180 days, then deleted. When you delete your account, your details and sessions are erased at once; security records are kept only without anything that identifies you.")}</p>
      </Block>

      <Block title="Who sees it">
        <p>{t("Only the people who run Freightwise, when needed to operate and secure it. If email is sent through a mail provider, it receives your email address and the message.")}</p>
      </Block>

      <Block title="Your rights">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("See your data: download it from your Account page.")}</li>
          <li>{t("Correct it: edit your profile on your Account page.")}</li>
          <li>{t("Erase it and withdraw consent: delete your account on your Account page. It's as easy as signing up.")}</li>
          <li>{t("Nominate someone to exercise these rights for you, and raise a grievance with us.")}</li>
        </ul>
        <p>
          {t("Signed in?")}{" "}
          <Link to="/account" className="text-accent underline">
            {t("Go to your Account page")}
          </Link>
          .
        </p>
      </Block>

      <Block title="Grievances and complaints">
        <p>{t("Contact our grievance officer at [name and email, to be completed before launch]. We reply within 90 days. If you're not satisfied, you can complain to the Data Protection Board of India.")}</p>
      </Block>

      <Block title="Changes to this notice">
        <p>{t("If we change what we collect or why, we'll ask for your consent again before it applies to you.")}</p>
      </Block>
    </article>
  );
}
