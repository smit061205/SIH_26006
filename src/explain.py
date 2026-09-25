"""What's behind a freight forecast, in terms a chartering desk can check.

For every series: its momentum (4- and 12-week change), its usual seasonal
move over the coming weeks (the same calendar weeks in past years) and how far
today's rate sits from its three-year median, next to where the forecast goes.

For the gradient-boosting model with market drivers, also the model's own
reliance on each input: permutation importance on the last two years of its
training rows, grouped into past freight rates, coal, Brent and the rupee.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance

from src.forecast import drivers_design

GROUPS = {"coal_au": "Coal (Australia)", "brent": "Brent crude", "usd_inr": "US dollar to rupee"}


def series_factors(series: pd.Series, forecast_point: np.ndarray, horizon: int = 12) -> dict:
    now = float(series.iloc[-1])
    h = min(horizon, len(forecast_point))

    def change(weeks: int) -> float:
        return round((now / float(series.iloc[-1 - weeks]) - 1) * 100, 1)

    # The same calendar weeks in each past year: the move from this week to `h` weeks later.
    week = series.index[-1].isocalendar().week
    moves = []
    for year in sorted(set(series.index.year))[:-1]:
        past = series[(series.index.year == year) & (series.index.isocalendar().week == week)]
        if past.empty:
            continue
        i = series.index.get_loc(past.index[0])
        if i + h < len(series) - 1:
            moves.append(float(series.iloc[i + h]) / float(series.iloc[i]) - 1)
    median_3y = float(series.tail(156).median())
    return {
        "horizon_weeks": h,
        "momentum_4w_pct": change(4),
        "momentum_12w_pct": change(12),
        "seasonal_pct": round(float(np.median(moves)) * 100, 1) if moves else None,
        "seasonal_years": len(moves),
        "vs_3y_median_pct": round((now / median_3y - 1) * 100, 1),
        "forecast_change_pct": round((float(forecast_point[h - 1]) / now - 1) * 100, 1),
    }


def driver_importance(series: pd.Series, drivers: pd.DataFrame) -> list[dict]:
    """Share of the drivers model's skill that comes from each input group (sums to 100)."""
    rows, cols, _ = drivers_design(series, drivers)
    model = HistGradientBoostingRegressor(max_depth=4, random_state=42)
    model.fit(rows[cols], rows["y"])
    recent = rows.tail(104)
    result = permutation_importance(model, recent[cols], recent["y"], n_repeats=5, random_state=0, n_jobs=1)
    by_group: dict[str, float] = {}
    for col, value in zip(cols, result.importances_mean):
        prefix = next((g for g in GROUPS if col.startswith(g)), None)
        name = GROUPS[prefix] if prefix else "Past freight rates"
        by_group[name] = by_group.get(name, 0.0) + max(0.0, float(value))
    total = sum(by_group.values()) or 1.0
    return sorted(({"input": k, "share_pct": round(v / total * 100, 1)} for k, v in by_group.items()), key=lambda r: -r["share_pct"])
