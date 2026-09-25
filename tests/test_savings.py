"""The savings replay (src/savings.py): no look-ahead, and sensible answers on
series whose right answer is obvious."""
import numpy as np
import pandas as pd

from src.forecast import Forecast
from src.savings import simulate, summarise

WEEKS = pd.date_range("2019-01-06", periods=260, freq="W-SUN")


def _flat_forecast(train: pd.Series, horizon: int) -> Forecast:
    last = float(train.iloc[-1])
    point = np.full(horizon, last)
    return Forecast(point=point, lower=point * 0.95, upper=point * 1.05)


def test_the_forecast_only_ever_sees_the_past():
    series = pd.Series(np.linspace(10_000, 30_000, len(WEEKS)), index=WEEKS)
    seen = []

    def spy(train: pd.Series, horizon: int) -> Forecast:
        seen.append(train.index[-1])
        return _flat_forecast(train, horizon)

    windows = simulate(series, spy, duration_months=6, window_weeks=12, years=None)
    assert windows and len(seen) == len(windows)
    # Each decision's history ends exactly at its start date.
    assert [pd.Timestamp(w.start) for w in windows] == seen


def test_a_flat_market_saves_nothing():
    series = pd.Series(20_000.0, index=WEEKS)
    summary = summarise(simulate(series, _flat_forecast, duration_months=6, window_weeks=12, years=None))
    assert summary["median_saving_pct"] == 0 and summary["worst_saving_pct"] == 0


def test_locking_in_before_a_known_rise_pays():
    # Rates climb steadily; a forecast that sees the trend recommends contract, which then saves.
    series = pd.Series(np.linspace(10_000, 40_000, len(WEEKS)), index=WEEKS)

    def trend(train: pd.Series, horizon: int) -> Forecast:
        slope = float(train.iloc[-1] - train.iloc[-5]) / 4
        point = float(train.iloc[-1]) + slope * np.arange(1, horizon + 1)
        return Forecast(point=point, lower=point * 0.97, upper=point * 1.03)

    windows = simulate(series, trend, duration_months=6, window_weeks=12, years=None)
    assert all(w.contract_pct > 50 for w in windows)
    assert summarise(windows)["cheaper_share_pct"] == 100


def test_the_api_serves_the_nearest_precomputed_length():
    from tests.auth_helpers import signed_in_client

    body = signed_in_client().get("/api/savings", params={"vessel_class": "Post-Panamax", "duration_months": 5}).json()
    assert body["duration_months"] == 6 and body["series_class"] == "Panamax"
    assert body["n_windows"] > 20 and -50 < body["median_saving_pct"] < 50
