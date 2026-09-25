"""What the planner's advice would have saved against today's practice.

SIH26006's goal is to move from fixing every voyage on the spot market as it
comes up to predictive, multi-voyage contracts. This measures that on the
freight history, walk-forward, with no look-ahead:

At each past start date t0 (every `step_weeks` weeks once the model has
`min_train` weeks to learn from), for a programme of one voyage a month for
`duration_months`:

- Reactive spot (today's practice): each month's voyage is fixed at the spot
  rate of the week it's needed.
- Freightwise: using only the rates up to t0, the forecast gives the fixing
  signal (fix now / wait / stagger, src/timing.py) and the contract share
  (scenario.recommend_contract_split). The contract share of every voyage is
  locked at the rate of the fixing week(s) chosen; the rest goes spot as above.

Both are priced at the rates that actually followed. Hire is the same number
of days in both, so the comparison is of day rates. The result is a spread
over start dates (median, share of months where it was cheaper, worst case),
not one flattering number.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.timing import WEEKS_PER_MONTH, best_fix_week, contract_for_duration, fix_signal

# Enough weeks to fit the models, as in the backtest.
MIN_TRAIN_WEEKS = 150


@dataclass
class Window:
    start: str
    signal: str
    contract_pct: float
    reactive_rate: float  # average day rate paid, reactive spot
    planned_rate: float  # average day rate paid, following the advice

    @property
    def saving_pct(self) -> float:
        return (self.reactive_rate - self.planned_rate) / self.reactive_rate * 100


def month_weeks(duration_months: int) -> list[int]:
    """Week offsets (from the start) at which each month's voyage is needed."""
    return [int(round(k * WEEKS_PER_MONTH)) for k in range(duration_months)]


def simulate(
    series: pd.Series,
    forecast_fn,
    duration_months: int,
    window_weeks: int,
    step_weeks: int = 4,
    min_train: int = MIN_TRAIN_WEEKS,
    years: float | None = 3.0,
) -> list[Window]:
    """Walk forward over `series` (weekly day rates), one programme per start date.
    `forecast_fn(train, horizon)` sees only the weeks up to each start date."""
    if duration_months < 1:
        raise ValueError("duration_months must be at least 1")
    offsets = month_weeks(duration_months)
    horizon = window_weeks + offsets[-1] + 1
    last_start = len(series) - horizon
    first_start = min_train
    if years is not None:
        first_start = max(first_start, last_start - int(years * 52))
    values = series.to_numpy(dtype=float)
    windows = []
    for t0 in range(first_start, last_start + 1, step_weeks):
        train = series.iloc[: t0 + 1]
        now = float(values[t0])
        fc = forecast_fn(train, window_weeks + len(offsets) * 5)
        dates = [d.strftime("%Y-%m-%d") for d in pd.date_range(train.index[-1] + pd.Timedelta(weeks=1), periods=len(fc.point), freq="W-SUN")]
        best = best_fix_week(now, train.index[-1].strftime("%Y-%m-%d"), dates, fc.point, fc.lower, fc.upper, window_weeks)
        signal, _ = fix_signal(now, best)
        split = contract_for_duration(
            now, fc.point, fc.lower, fc.upper, duration_months,
            n_voyages=duration_months, hire_days_per_voyage=40.0, cargo_tonnes_total=75000.0 * duration_months,
        )
        share = split["contract_pct"] / 100
        # The contract is fixed when the signal says: now, at the best week, or half each.
        later = float(values[t0 + best.week_index])
        contract_rate = {"fix_now": now, "wait": later}.get(signal, (now + later) / 2)
        # The programme starts when the contract is fixed; each month's voyage is needed then.
        start = t0 + (best.week_index if signal == "wait" else 0)
        spot = np.array([values[start + o] for o in offsets])
        reactive = float(spot.mean())
        planned = float(share * contract_rate + (1 - share) * spot.mean())
        windows.append(Window(train.index[-1].strftime("%Y-%m-%d"), signal, split["contract_pct"], reactive, planned))
    return windows


def summarise(windows: list[Window]) -> dict:
    if not windows:
        return {"n_windows": 0}
    savings = np.array([w.saving_pct for w in windows])
    return {
        "n_windows": len(windows),
        "first_start": windows[0].start,
        "last_start": windows[-1].start,
        "median_saving_pct": round(float(np.median(savings)), 1),
        "mean_saving_pct": round(float(savings.mean()), 1),
        "cheaper_share_pct": round(float((savings > 0).mean() * 100), 0),
        "best_saving_pct": round(float(savings.max()), 1),
        "worst_saving_pct": round(float(savings.min()), 1),
        "windows": [
            {"start": w.start, "signal": w.signal, "contract_pct": round(w.contract_pct, 0), "saving_pct": round(w.saving_pct, 2)}
            for w in windows
        ],
    }
