"""Downloads the market drivers behind freight rates into data/market_drivers.csv.

Free, keyless public series from FRED (Federal Reserve Bank of St. Louis):
  coal_au  PCOALAUUSDM   Australian coal, USD per tonne, monthly (IMF Primary
                         Commodity Prices; the Newcastle benchmark - hard
                         coking coal prices are paid data, this is the closest
                         free proxy for the Australian coal market)
  brent    DCOILBRENTEU  Brent crude, USD per barrel, daily (US EIA) - bunker
                         fuel prices move with it
  usd_inr  DEXINUS       Indian rupees per US dollar, daily (Federal Reserve H.10)

Daily series are averaged by week (weeks ending Sunday, like the freight
series); coal stays monthly. Run from anywhere:
    python -m scripts.fetch_market_drivers
"""
import io
from pathlib import Path

import pandas as pd
import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT = DATA_DIR / "market_drivers.csv"
START = "2018-01-01"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}"

SERIES = {
    "coal_au": {"fred_id": "PCOALAUUSDM", "unit": "USD/t", "frequency": "monthly",
                "source": "FRED PCOALAUUSDM (IMF Primary Commodity Prices, Australian coal)"},
    "brent": {"fred_id": "DCOILBRENTEU", "unit": "USD/bbl", "frequency": "weekly",
              "source": "FRED DCOILBRENTEU (US EIA, Europe Brent spot, weekly average of daily)"},
    "usd_inr": {"fred_id": "DEXINUS", "unit": "INR/USD", "frequency": "weekly",
                "source": "FRED DEXINUS (Federal Reserve H.10, weekly average of daily)"},
}


def fetch(fred_id: str) -> pd.Series:
    resp = requests.get(FRED_CSV.format(id=fred_id), timeout=60)
    resp.raise_for_status()
    df = pd.read_csv(io.StringIO(resp.text), na_values=["."])
    df.columns = ["date", "value"]
    df["date"] = pd.to_datetime(df["date"])
    return df.dropna().set_index("date")["value"].astype(float)


def build() -> pd.DataFrame:
    frames = []
    for name, meta in SERIES.items():
        raw = fetch(meta["fred_id"])
        raw = raw[raw.index >= START]
        if meta["frequency"] == "weekly":
            # Week average, dated by its last observation (so a week still in
            # progress isn't dated in the future).
            week = raw.index.to_period("W-SUN")
            grouped = raw.groupby(week)
            raw = pd.Series(grouped.mean().values, index=grouped.apply(lambda s: s.index.max()).values)
        frames.append(
            pd.DataFrame(
                {
                    "date": raw.index.strftime("%Y-%m-%d"),
                    "series": name,
                    "value": raw.round(4).values,
                    "unit": meta["unit"],
                    "frequency": meta["frequency"],
                    "source": meta["source"],
                    "data_confidence": "real_public_data",
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


if __name__ == "__main__":
    df = build()
    df.to_csv(OUT, index=False)
    for name, g in df.groupby("series"):
        print(f"{name}: {len(g)} rows, last {g['date'].iloc[-1]} = {g['value'].iloc[-1]}")
    print(f"-> {OUT}")
