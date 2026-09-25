"""Stage 4: walk-forward backtest harness.

Per the project's own testing discipline: the model never sees future data,
scored with MASE against a naive "no change" guess, plus directional
accuracy. This is what makes any forecast-accuracy claim ("85% accuracy"
etc.) credible instead of asserted.

Note on reading MASE here: this implementation uses the standard
Hyndman-Koehler definition, which scales multi-step error against the
TRAINING data's one-step-ahead naive error. At a long horizon (e.g. the
12-week/~3-month horizon Layer 2 needs), it's normal and expected for
MASE to be >1.0 for every model, including naive itself scored against
itself at that horizon - a 12-week-ahead error is naturally larger than a
1-week-ahead error scale. The useful signal is the RELATIVE ranking across
models (which one has the lowest MASE), not whether any individual score
clears the 1.0 line.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.forecast import Forecast


def mase(actual: np.ndarray, predicted: np.ndarray, train: np.ndarray, season_length: int = 1) -> float:
    """Mean Absolute Scaled Error. Scale = mean absolute seasonal difference
    on the TRAINING data only (no leakage). <1.0 beats the naive/seasonal-
    naive baseline of the same season length."""
    naive_scale = np.mean(np.abs(np.diff(train, n=1) if season_length == 1 else train[season_length:] - train[:-season_length]))
    if naive_scale == 0:
        return float("nan")
    return np.mean(np.abs(actual - predicted)) / naive_scale


def directional_accuracy(actual: np.ndarray, predicted: np.ndarray, last_train_value: float) -> float:
    """Fraction of steps where the forecast correctly called up/down vs the
    last known training value.

    Note: a flat ("no change") forecast - the naive model by definition -
    will score exactly 0.0 here, since sign(predicted - last_train) is
    always 0 and real markets essentially never land exactly on that value.
    That's an expected, mechanical property of the metric for a flat
    forecast, not a bug: it correctly reflects that naive never commits to
    a direction, so it can never be credited with calling one right.
    """
    actual_dir = np.sign(actual - last_train_value)
    pred_dir = np.sign(predicted - last_train_value)
    return float(np.mean(actual_dir == pred_dir))


@dataclass
class SplitResult:
    train_end: pd.Timestamp
    actual: np.ndarray
    predicted: np.ndarray
    mase: float
    directional_accuracy: float


def walk_forward_backtest(
    series: pd.Series,
    model_fn,
    horizon: int,
    min_train_size: int,
    step: int,
    model_kwargs: dict | None = None,
) -> list[SplitResult]:
    """Slides a training window forward; at each point, trains only on data
    up to that point and forecasts `horizon` steps ahead, then compares
    against the actual values that follow (which the model never saw)."""
    model_kwargs = model_kwargs or {}
    results = []
    n = len(series)
    start = min_train_size
    while start + horizon <= n:
        train = series.iloc[:start]
        actual = series.iloc[start : start + horizon].values

        forecast: Forecast = model_fn(train, horizon, **model_kwargs)
        predicted = forecast.point

        m = mase(actual, predicted, train.values, season_length=1)
        da = directional_accuracy(actual, predicted, train.iloc[-1])

        results.append(
            SplitResult(
                train_end=train.index[-1],
                actual=actual,
                predicted=predicted,
                mase=m,
                directional_accuracy=da,
            )
        )
        start += step

    return results


def summarize(results: list[SplitResult]) -> dict:
    return {
        "n_splits": len(results),
        "mean_mase": float(np.mean([r.mase for r in results])),
        "mean_directional_accuracy": float(np.mean([r.directional_accuracy for r in results])),
    }


def compare_models(
    series: pd.Series,
    models: dict,
    horizon: int,
    min_train_size: int,
    step: int,
    season_length: int = 52,
) -> pd.DataFrame:
    rows = []
    for name, model_fn in models.items():
        model_kwargs = {"season_length": season_length} if name == "seasonal_naive" else {}
        results = walk_forward_backtest(series, model_fn, horizon, min_train_size, step, model_kwargs=model_kwargs)
        summary = summarize(results)
        rows.append({"model": name, **summary})
    return pd.DataFrame(rows).sort_values("mean_mase").reset_index(drop=True)
