from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.backtest import compare_models, directional_accuracy, mase, walk_forward_backtest
from src.forecast import MODELS, naive_forecast

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def test_mase_naive_scored_against_itself_is_finite_and_positive():
    train = np.linspace(100, 200, 50)
    actual = np.array([210, 215, 220])
    predicted = np.array([200, 200, 200])  # naive: repeats last train value
    m = mase(actual, predicted, train, season_length=1)
    assert m > 0
    assert np.isfinite(m)


def test_mase_zero_naive_scale_returns_nan():
    train = np.full(20, 100.0)  # perfectly flat -> zero naive scale
    actual = np.array([100.0, 100.0])
    predicted = np.array([100.0, 100.0])
    assert np.isnan(mase(actual, predicted, train, season_length=1))


def test_directional_accuracy_perfect_predictions_is_one():
    last_train_value = 100.0
    actual = np.array([110.0, 90.0, 105.0])
    predicted = np.array([108.0, 95.0, 102.0])  # same sign of change as actual
    assert directional_accuracy(actual, predicted, last_train_value) == 1.0


def test_directional_accuracy_naive_flat_forecast_scores_zero():
    last_train_value = 100.0
    actual = np.array([110.0, 90.0])
    predicted = np.array([100.0, 100.0])  # naive: no change -> sign always 0
    assert directional_accuracy(actual, predicted, last_train_value) == 0.0


def test_walk_forward_backtest_produces_splits_that_grow_train_window():
    series = pd.Series(np.linspace(1000, 2000, 120), index=pd.date_range("2022-01-02", periods=120, freq="W-SUN"))
    results = walk_forward_backtest(series, naive_forecast, horizon=4, min_train_size=60, step=20)
    assert len(results) > 0
    train_ends = [r.train_end for r in results]
    assert train_ends == sorted(train_ends)


@pytest.mark.skipif(not (DATA_DIR / "freight_rates_capesize.csv").exists(), reason="real freight rate CSV not present")
def test_compare_models_readme_documented_mase_ranking():
    """Loose ranking check against the real (synthetic-but-calibrated)
    freight rate series: ARIMA should beat both naive baselines on this
    data, matching the project's documented backtest result. Not pinned to
    an exact MASE value, since that would be brittle to minor
    library-version drift."""
    freight_df = pd.read_csv(DATA_DIR / "freight_rates_capesize.csv", parse_dates=["date"])
    series = freight_df.set_index("date")["freight_usd_per_day"]
    series.index.freq = "W-SUN"

    comparison = compare_models(series, MODELS, horizon=12, min_train_size=150, step=20, season_length=52)
    ranked = comparison.set_index("model")["mean_mase"]

    assert ranked["arima"] < ranked["naive"]
    assert ranked["arima"] < ranked["seasonal_naive"]
