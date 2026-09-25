import { useQuery } from "@tanstack/react-query";
import { type ReactNode, createContext, useContext, useMemo, useState } from "react";
import { getUsdInr } from "../api";
import type { Currency, Money } from "./format";

const FALLBACK_RATE = 96;
const STORAGE_KEY = "freightwise.currency";

interface CurrencyState {
  money: Money;
  setCurrency: (c: Currency) => void;
  rateDate: string | null;
  rateSource: "live" | "fixed" | "loading";
}

const CurrencyContext = createContext<CurrencyState | null>(null);

function readStored(): Currency {
  try {
    return localStorage.getItem(STORAGE_KEY) === "INR" ? "INR" : "USD";
  } catch {
    return "USD";
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(readStored);
  const fx = useQuery({
    queryKey: ["fx-usd-inr"],
    queryFn: ({ signal }) => getUsdInr(signal),
    staleTime: Infinity,
    retry: 1,
    meta: { progress: false },
  });

  const value = useMemo<CurrencyState>(() => {
    const setCurrency = (c: Currency) => {
      setCurrencyState(c);
      try {
        localStorage.setItem(STORAGE_KEY, c);
      } catch {
        /* storage blocked: the choice still applies for this visit */
      }
    };
    return {
      money: { currency, rate: fx.data?.rate ?? FALLBACK_RATE },
      setCurrency,
      rateDate: fx.data?.date ?? null,
      rateSource: fx.data ? "live" : fx.isError ? "fixed" : "loading",
    };
  }, [currency, fx.data, fx.isError]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency outside CurrencyProvider");
  return ctx;
}

export function useMoney() {
  return useCurrency().money;
}
