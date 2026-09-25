"""Stage 4: forecasting models for Layer 2 (3-month spot-vs-contract decision).

Every model here implements the same interface: fit on a training series,
produce a point forecast + a naive uncertainty band for `horizon` steps
ahead. The naive baseline is not optional scaffolding - src/backtest.py
scores every other model against it, and a model that can't beat it isn't
worth using (this mirrors the project's own "walk-forward backtest ...
below 1 means we beat naive" methodology).

Note on LightGBM: the project spec calls for LightGBM/XGBoost. LightGBM's
compiled binary needs libomp, which isn't installed on this machine and
would require a system-level `brew install libomp` change outside this
project. HistGradientBoostingRegressor (scikit-learn, already a dependency)
is used here instead - same family of model (gradient-boosted trees), zero
extra system dependencies. Swap in LightGBM later if the target machine has
libomp available; the interface below doesn't change.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from statsmodels.tsa.arima.model import ARIMA


@dataclass
class Forecast:
    point: np.ndarray  # shape (horizon,)
    lower: np.ndarray  # naive uncertainty band, not a calibrated interval
    upper: np.ndarray


def naive_forecast(train: pd.Series, horizon: int) -> Forecast:
    """Repeats the last observed value - the mandatory baseline everything
    else must beat."""
    last = train.iloc[-1]
    point = np.full(horizon, last)
    resid_std = train.diff().dropna().std()
    band = 1.28 * resid_std * np.sqrt(np.arange(1, horizon + 1))  # ~80% band
    return Forecast(point=point, lower=point - band, upper=point + band)


def seasonal_naive_forecast(train: pd.Series, horizon: int, season_length: int = 52) -> Forecast:
    """Repeats the value from one season ago (weekly data, 52-week season)."""
    if len(train) < season_length:
        return naive_forecast(train, horizon)
    tail = train.iloc[-season_length:].values
    point = np.array([tail[i % season_length] for i in range(horizon)])
    resid_std = train.diff(season_length).dropna().std()
    band = 1.28 * resid_std * np.sqrt(np.arange(1, horizon + 1))
    return Forecast(point=point, lower=point - band, upper=point + band)


def arima_forecast(train: pd.Series, horizon: int, order=(2, 1, 2)) -> Forecast:
    model = ARIMA(train.values, order=order)
    fit = model.fit()
    result = fit.get_forecast(steps=horizon)
    point = result.predicted_mean
    ci = result.conf_int(alpha=0.20)  # ~80% band, matches the naive band above
    return Forecast(point=point, lower=ci[:, 0], upper=ci[:, 1])


def _make_lag_features(series: pd.Series, lags=(1, 2, 4, 8, 12, 26, 52)) -> pd.DataFrame:
    df = pd.DataFrame({"y": series.values}, index=series.index)
    for lag in lags:
        df[f"lag_{lag}"] = df["y"].shift(lag)
    df["rolling_mean_4"] = df["y"].shift(1).rolling(4).mean()
    df["weekofyear"] = series.index.isocalendar().week.astype(int).values
    return df.dropna()


def _band(train: pd.Series, horizon: int) -> np.ndarray:
    """~80% band for the tree models, from the week-to-week variability of the
    series. Their in-sample errors are near zero (trees fit their training data
    closely), so a band built from those would claim far too much certainty."""
    step_std = train.diff().dropna().std()
    return 1.28 * step_std * np.sqrt(np.arange(1, horizon + 1))


def gbrt_forecast(train: pd.Series, horizon: int, lags=(1, 2, 4, 8, 12, 26, 52)) -> Forecast:
    """Gradient-boosted trees on lag features, forecasting recursively
    (each step's prediction feeds the next step's lag features)."""
    feat_df = _make_lag_features(train, lags)
    feature_cols = [c for c in feat_df.columns if c != "y"]
    model = HistGradientBoostingRegressor(max_depth=4, random_state=42)
    model.fit(feat_df[feature_cols], feat_df["y"])

    history = list(train.values)
    max_lag = max(lags)
    preds = []
    for step in range(horizon):
        recent = np.array(history[-max_lag:])
        row = {f"lag_{lag}": recent[-lag] for lag in lags}
        row["rolling_mean_4"] = np.mean(recent[-4:])
        future_week = (train.index[-1] + pd.Timedelta(weeks=step + 1)).isocalendar().week
        row["weekofyear"] = int(future_week)
        x = pd.DataFrame([row])[feature_cols]
        pred = model.predict(x)[0]
        preds.append(pred)
        history.append(pred)

    point = np.array(preds)
    return Forecast(point=point, lower=point - _band(train, horizon), upper=point + _band(train, horizon))


def drivers_design(train: pd.Series, drivers: pd.DataFrame, lags=(1, 2, 4, 8, 12, 26, 52)):
    """Training rows for the drivers model: lag features plus each driver's
    level and 4-week change as known the week before. Returns (rows, feature
    columns, drivers aligned to the training weeks)."""
    feat_df = _make_lag_features(train, lags)
    d = drivers.reindex(train.index).ffill()
    for col in d.columns:
        feat_df[f"{col}_level"] = d[col].shift(1).reindex(feat_df.index)
        feat_df[f"{col}_chg4"] = (d[col] / d[col].shift(4) - 1).shift(1).reindex(feat_df.index)
    feat_df = feat_df.dropna()
    return feat_df, [c for c in feat_df.columns if c != "y"], d


def gbrt_drivers_forecast(train: pd.Series, horizon: int, drivers: pd.DataFrame | None = None,
                          lags=(1, 2, 4, 8, 12, 26, 52)) -> Forecast:
    """Gradient-boosted trees on lag features plus the market drivers (coal,
    Brent, rupee) as known at each week: their level and 4-week change. The
    drivers are held at their last known value over the horizon - the model
    never sees future coal or oil prices."""
    if drivers is None:
        return gbrt_forecast(train, horizon, lags)
    feat_df, feature_cols, d = drivers_design(train, drivers, lags)
    model = HistGradientBoostingRegressor(max_depth=4, random_state=42)
    model.fit(feat_df[feature_cols], feat_df["y"])

    last_drivers = {}
    for col in d.columns:
        series = d[col].dropna()
        last_drivers[f"{col}_level"] = series.iloc[-1]
        last_drivers[f"{col}_chg4"] = series.iloc[-1] / series.iloc[-5] - 1 if len(series) > 4 else 0.0

    history = list(train.values)
    max_lag = max(lags)
    preds = []
    for step in range(horizon):
        recent = np.array(history[-max_lag:])
        row = {f"lag_{lag}": recent[-lag] for lag in lags}
        row["rolling_mean_4"] = np.mean(recent[-4:])
        row["weekofyear"] = int((train.index[-1] + pd.Timedelta(weeks=step + 1)).isocalendar().week)
        row.update(last_drivers)
        pred = model.predict(pd.DataFrame([row])[feature_cols])[0]
        preds.append(pred)
        history.append(pred)

    point = np.array(preds)
    return Forecast(point=point, lower=point - _band(train, horizon), upper=point + _band(train, horizon))


MODELS = {
    "naive": naive_forecast,
    "seasonal_naive": seasonal_naive_forecast,
    "arima": arima_forecast,
    "gbrt": gbrt_forecast,
}
