export type Currency = "USD" | "INR";

export interface Money {
  currency: Currency;
  /** INR per 1 USD */
  rate: number;
}

const MINUS = "−";
const NNBSP = " ";

const en = (digits: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const enIN = (digits: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function signed(value: number, body: (abs: number) => string, withPlus: boolean) {
  if (Math.abs(value) < 1e-9) return body(0);
  const sign = value < 0 ? MINUS : withPlus ? "+" : "";
  return `${sign}${body(Math.abs(value))}`;
}

export function num(value: number, digits = 0) {
  return signed(value, (a) => en(digits).format(a), false);
}

export function pct(value: number, digits = 1, withPlus = false) {
  return signed(value, (a) => `${en(digits).format(a)}%`, withPlus);
}

export function tonnes(value: number) {
  return `${en(0).format(value)}${NNBSP}t`;
}

export function days(value: number) {
  const digits = Number.isInteger(value) ? 0 : 1;
  return `${en(digits).format(value)}${NNBSP}d`;
}

export function metres(value: number) {
  return `${en(1).format(value)}${NNBSP}m`;
}

/** INR amounts above a lakh read in lakh/crore, the way Indian budgets are written. */
function inrCompact(inr: number) {
  if (inr >= 1e7) {
    const cr = inr / 1e7;
    return `₹${en(cr >= 100 ? 1 : 2).format(cr)}${NNBSP}cr`;
  }
  if (inr >= 1e5) return `₹${en(1).format(inr / 1e5)}${NNBSP}lakh`;
  return `₹${enIN(0).format(inr)}`;
}

/** Per-tonne money: $14.21 or ₹1,360 */
export function perTonne(usd: number, m: Money, withPlus = false) {
  if (m.currency === "USD") return signed(usd, (a) => `$${en(2).format(a)}`, withPlus);
  return signed(usd * m.rate, (a) => `₹${enIN(0).format(a)}`, withPlus);
}

/** Voyage and plan totals: $1,065,750 or ₹10.20 cr */
export function total(usd: number, m: Money, withPlus = false) {
  if (m.currency === "USD") return signed(usd, (a) => `$${en(0).format(a)}`, withPlus);
  return signed(usd * m.rate, inrCompact, withPlus);
}

/** Daily freight rate: $32,276 or ₹30.9 lakh */
export function dayRate(usd: number, m: Money) {
  if (m.currency === "USD") return `$${en(0).format(usd)}`;
  return inrCompact(usd * m.rate);
}

/** Compact axis ticks: $30k or ₹29 L */
export function axisMoney(usd: number, m: Money) {
  if (usd === 0) return m.currency === "USD" ? "$0" : "₹0";
  if (m.currency === "USD") {
    if (Math.abs(usd) >= 1e6) return `$${en(1).format(usd / 1e6)}M`;
    return `$${en(0).format(usd / 1e3)}k`;
  }
  const inr = usd * m.rate;
  if (Math.abs(inr) >= 1e7) return `₹${en(1).format(inr / 1e7)} cr`;
  return `₹${en(0).format(inr / 1e5)} L`;
}

export function perTonneUnit() {
  return `${NNBSP}/t`;
}

export function perDayUnit() {
  return `${NNBSP}/day`;
}

import { getLang } from "./i18n";

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून", "जुल", "अग", "सित", "अक्टू", "नव", "दिस"];
const MONTHS_LONG_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function months() {
  return getLang() === "hi" ? MONTHS_HI : MONTHS_EN;
}

function parseDate(iso: string) {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, mo, d };
}

/** 23 Sep 2026 */
export function longDate(iso: string) {
  const { y, mo, d } = parseDate(iso);
  return `${d} ${months()[mo - 1]} ${y}`;
}

/** 23 Sep */
export function shortDate(iso: string) {
  const { mo, d } = parseDate(iso);
  return `${d} ${months()[mo - 1]}`;
}

/** Jan ’25 */
export function axisDate(iso: string) {
  const { y, mo } = parseDate(iso);
  return `${months()[mo - 1]} ’${String(y).slice(2)}`;
}

/** Tue */
export function weekday(iso: string) {
  const { y, mo, d } = parseDate(iso);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString(getLang() === "hi" ? "hi-IN" : "en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function monthShort(month: number) {
  return months()[month - 1];
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLong(month: number) {
  return (getLang() === "hi" ? MONTHS_LONG_HI : MONTHS_LONG)[month - 1];
}

export function durationLabel(n: number) {
  if (getLang() === "hi") return n === 0 ? "स्पॉट, एक यात्रा" : `${n} महीने`;
  return n === 0 ? "Spot, one voyage" : `${n} months`;
}

/** A share and its complement as whole percentages that always total 100. */
export function splitPercents(firstPct: number): [number, number] {
  const first = Math.round(firstPct);
  return [first, 100 - first];
}
