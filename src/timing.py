"""Market-entry timing: when to fix a charter, and how much to fix on contract
over a given contract duration.

Everything reads the freight forecast (src/forecast.py) and applies plain,
stated rules - no hidden optimiser:
  - best week to fix = the cheapest expected rate in the fixing window,
    with "now" (today's rate) as a candidate so fixing immediately can win;
  - fix now  if no week is meaningfully cheaper (under 2%);
  - wait     if a later week saves at least 5% and even its upper band is
             no more than 10% above today, so waiting has little downside;
  - stagger  otherwise: fix part now and part later.
"""
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from src.scenario import recommend_contract_split

WEEKS_PER_MONTH = 52 / 12
TRIVIAL_SAVING = 0.02
WAIT_MIN_SAVING = 0.05
MAX_DOWNSIDE = 0.10


@dataclass
class FixWindow:
    week_index: int  # 0 = now
    date: str
    expected_rate: float
    lower: float
    upper: float
    saving_vs_now_pct: float


def best_fix_week(
    current_rate: float,
    as_of: str,
    dates: list[str],
    point: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    window_weeks: int,
) -> FixWindow:
    best = FixWindow(0, as_of, current_rate, current_rate, current_rate, 0.0)
    for i in range(min(window_weeks, len(point))):
        if point[i] < best.expected_rate:
            best = FixWindow(
                week_index=i + 1,
                date=dates[i],
                expected_rate=float(point[i]),
                lower=float(max(0.0, lower[i])),
                upper=float(upper[i]),
                saving_vs_now_pct=round((current_rate - float(point[i])) / current_rate * 100, 2),
            )
    return best


def _day(iso: str) -> str:
    d = pd.Timestamp(iso)
    return f"{d.day} {d.strftime('%b')}"


def fix_signal(current_rate: float, best: FixWindow) -> tuple[str, str]:
    saving = best.saving_vs_now_pct / 100
    if best.week_index == 0 or saving < TRIVIAL_SAVING:
        return "fix_now", "No week in the fixing window is expected to be more than 2% cheaper than today."
    downside = (best.upper - current_rate) / current_rate
    if saving >= WAIT_MIN_SAVING and downside <= MAX_DOWNSIDE:
        return (
            "wait",
            f"The week of {_day(best.date)} is expected to be {saving:.0%} cheaper, and even the top of its range is "
            f"{max(downside, 0):.0%} above today.",
        )
    return (
        "stagger",
        f"The week of {_day(best.date)} is expected to be {saving:.0%} cheaper, but its range reaches {downside:.0%} above "
        "today, so fix part now and part later.",
    )


def duration_weeks(duration_months: int) -> int:
    return max(1, round(duration_months * WEEKS_PER_MONTH))


def forecast_horizon_for(duration_months: int, window_weeks: int) -> int:
    """Long enough to cover the fixing window and the contract that follows."""
    return int(min(64, max(12, window_weeks + (duration_weeks(duration_months) if duration_months else 0))))


def contract_for_duration(
    current_rate: float,
    point: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    duration_months: int,
    n_voyages: int,
    hire_days_per_voyage: float,
    cargo_tonnes_total: float,
    contract_rate: float | None = None,
) -> dict:
    """Contract-vs-spot split using the forecast averaged over the contract's
    weeks (one voyage fixed in the next month when the duration is 0)."""
    weeks = duration_weeks(duration_months) if duration_months else 4
    weeks = min(weeks, len(point))
    split = recommend_contract_split(
        cargo_tonnes=cargo_tonnes_total,
        current_rate=current_rate,
        forecast_point=float(np.mean(point[:weeks])),
        forecast_lower=float(np.mean(np.maximum(lower[:weeks], 0))),
        forecast_upper=float(np.mean(upper[:weeks])),
        transit_plus_wait_days=hire_days_per_voyage,
        n_voyages=max(1, n_voyages),
        contract_rate=contract_rate,
    )
    return {
        "contract_pct": split.contract_pct,
        "spot_pct": split.spot_pct,
        "expected_change_pct": split.expected_change_pct,
        "band_width_pct": split.band_width_pct,
        "n_voyages": max(1, n_voyages),
        "reasoning": split.reasoning,
        "cost_comparison": split.cost_comparison.to_dict(orient="records"),
    }


def fix_window_dict(window: FixWindow) -> dict:
    return asdict(window)
