"""Generates data/freight_rates_<class>.csv - SYNTHETIC weekly time-charter
rate series for Capesize, Panamax, Supramax and Handysize, NOT real Baltic
Exchange data (a paid subscription).

Each series is a piecewise log-linear trend through publicly reported anchor
levels, plus a seasonal cycle and AR(1) noise, so the forecasting and
walk-forward backtest (src/forecast.py, src/backtest.py) have a realistic
series per vessel type to run against.

Anchor points (approximate public levels, USD/day):
  Capesize  - ~11k (Jan 2019), ~7k (May 2020 trough), ~85k (Oct 2021 boom),
              ~17k (Jan 2023), 21,297 (2025 average actual); 53,441 (BCI 5TC,
              22 Sep 2026).
  Panamax   - ~10.5k, ~5.5k, ~35k, ~11k, ~11.5k (Jan 2025); 20,687 (BPI, 22 Sep 2026)
  Supramax  - ~10k, ~5k, ~37k, ~9k, ~9.5k; 22,443 (BSI, 22 Sep 2026)
  Handysize - ~8k, ~4.5k, ~34k, ~8.5k, ~8.5k; 17,947 (BHSI, 22 Sep 2026)
  2025 market averages used as cross-checks: Supramax 11,610 and Handysize
  10,570 (Pacific Basin FY2025 results); Panamax 13,361 (market reports).
  Latest values: handybulk.com Baltic Dry Index page, 22 Sep 2026.
  The 1 Jan 2026 anchor for each class is solved so the series' 2025
  average matches the published 2025 average (Capesize 21,297, Panamax
  13,361, Supramax 11,610, Handysize 10,570).

Smaller sizes are less volatile than Capesize, and all sizes share part of
the same market shock (correlation RHO) so they move together without
moving identically. Noise is pulled back over the final year so every
series ends on its published level for the last complete week. Fixed seeds
make every file regenerate identically (tests/test_data.py checks this).

Run from anywhere: python -m scripts.generate_synthetic_freight_rates
"""
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
START = "2019-01-06"
END = "2026-09-20"  # last complete week (week ending Sunday) before the 22 Sep 2026 index prints
ANCHOR_DATES = ["2019-01-06", "2020-05-01", "2021-10-15", "2023-01-01", "2025-01-01", "2026-01-01", END]
SEASONAL_PEAK_DAY = 335  # about 1 December: firmer Oct-Jan restocking, softest around June-July
END_PULL_WEEKS = 52
RHO = 0.7

CLASS_PARAMS = {
    "Capesize": {"levels": [11000, 7000, 85000, 17000, 21297, 19200, 53441], "seasonal": 0.08, "sigma": 0.05, "phi": 0.85, "seed": 42},
    "Panamax": {"levels": [10500, 5500, 35000, 11000, 11500, 13900, 20687], "seasonal": 0.06, "sigma": 0.04, "phi": 0.85, "seed": 43},
    "Supramax": {"levels": [10000, 5000, 37000, 9000, 9500, 13600, 22443], "seasonal": 0.05, "sigma": 0.035, "phi": 0.85, "seed": 44},
    "Handysize": {"levels": [8000, 4500, 34000, 8500, 8500, 12200, 17947], "seasonal": 0.05, "sigma": 0.03, "phi": 0.85, "seed": 45},
}


def _dates() -> pd.DatetimeIndex:
    return pd.date_range(START, END, freq="W-SUN")


def _shocks(seed: int, n: int, sigma: float) -> np.ndarray:
    """Normal shocks for the AR(1) noise (index 0 unused)."""
    rng = np.random.default_rng(seed)
    shocks = np.zeros(n)
    for i in range(1, n):
        shocks[i] = rng.normal(0, sigma)
    return shocks


def generate(vessel_class: str = "Capesize") -> pd.DataFrame:
    params = CLASS_PARAMS[vessel_class]
    dates = _dates()
    n = len(dates)

    anchor_x = (pd.to_datetime(ANCHOR_DATES) - dates[0]).days.values.astype(float)
    x = (dates - dates[0]).days.values.astype(float)
    trend = np.interp(x, anchor_x, np.log(params["levels"]))

    # Firmer in Oct-Jan (Q4/Q1 restocking), softer Jun-Aug.
    seasonal = params["seasonal"] * np.cos(2 * np.pi * (dates.dayofyear.values - SEASONAL_PEAK_DAY) / 365.25)

    if vessel_class == "Capesize":
        shocks = _shocks(params["seed"], n, params["sigma"])
    else:
        market = _shocks(CLASS_PARAMS["Capesize"]["seed"], n, 1.0)
        own = _shocks(params["seed"], n, 1.0)
        shocks = params["sigma"] * (RHO * market + np.sqrt(1 - RHO**2) * own)

    noise = np.zeros(n)
    for i in range(1, n):
        noise[i] = params["phi"] * noise[i - 1] + shocks[i]

    log_rate = trend + seasonal + noise
    # Ease the final year onto the published end level, so "today" matches the market.
    gap = np.log(params["levels"][-1]) - log_rate[-1]
    ramp = np.clip((np.arange(n) - (n - 1 - END_PULL_WEEKS)) / END_PULL_WEEKS, 0, 1)
    rate = np.exp(log_rate + gap * ramp)
    return pd.DataFrame(
        {
            "date": dates,
            "freight_usd_per_day": rate.round(0),
            "vessel_class": vessel_class,
            "data_confidence": "synthetic_calibrated_to_public_rate_ranges",
        }
    )


if __name__ == "__main__":
    for vessel_class in CLASS_PARAMS:
        df = generate(vessel_class)
        out_path = DATA_DIR / f"freight_rates_{vessel_class.lower()}.csv"
        df.to_csv(out_path, index=False)
        print(f"{vessel_class}: {len(df)} weekly rows -> {out_path}, last {df['freight_usd_per_day'].iloc[-1]:,.0f}/day")
