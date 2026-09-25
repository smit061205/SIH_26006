import numpy as np
import pandas as pd
import pytest

from src.forecast import MODELS, arima_forecast, gbrt_forecast, naive_forecast, seasonal_naive_forecast


@pytest.fixture(scope="module")
def synthetic_series():
    rng = np.random.default_rng(42)
    dates = pd.date_range("2020-01-05", periods=200, freq="W-SUN")
    trend = np.linspace(10000, 15000, 200)
    noise = rng.normal(0, 300, 200)
    seasonal = 500 * np.sin(np.arange(200) * 2 * np.pi / 52)
    return pd.Series(trend + seasonal + noise, index=dates)


def test_naive_forecast_shape(synthetic_series):
    horizon = 12
    f = naive_forecast(synthetic_series, horizon)
    assert f.point.shape == (horizon,)
    assert f.lower.shape == (horizon,)
    assert f.upper.shape == (horizon,)
    assert (f.lower <= f.point).all()
    assert (f.point <= f.upper).all()


def test_naive_forecast_repeats_last_value(synthetic_series):
    f = naive_forecast(synthetic_series, 5)
    assert (f.point == synthetic_series.iloc[-1]).all()


def test_seasonal_naive_forecast_shape(synthetic_series):
    horizon = 12
    f = seasonal_naive_forecast(synthetic_series, horizon, season_length=52)
    assert f.point.shape == (horizon,)
    assert (f.lower <= f.point).all()
    assert (f.point <= f.upper).all()


def test_seasonal_naive_falls_back_to_naive_when_series_too_short():
    short_series = pd.Series(np.arange(10, dtype=float), index=pd.date_range("2024-01-01", periods=10, freq="W-SUN"))
    f = seasonal_naive_forecast(short_series, 4, season_length=52)
    naive = naive_forecast(short_series, 4)
    assert (f.point == naive.point).all()


def test_arima_forecast_shape_and_band_ordering(synthetic_series):
    horizon = 8
    f = arima_forecast(synthetic_series, horizon)
    assert f.point.shape == (horizon,)
    assert (f.lower <= f.point).all()
    assert (f.point <= f.upper).all()


def test_gbrt_forecast_shape(synthetic_series):
    horizon = 8
    f = gbrt_forecast(synthetic_series, horizon)
    assert f.point.shape == (horizon,)
    assert (f.lower <= f.point).all()
    assert (f.point <= f.upper).all()


def test_all_models_in_registry_conform_to_forecast_interface(synthetic_series):
    horizon = 6
    for name, model_fn in MODELS.items():
        kwargs = {"season_length": 52} if name == "seasonal_naive" else {}
        f = model_fn(synthetic_series, horizon, **kwargs)
        assert f.point.shape == (horizon,), name
        assert f.lower.shape == (horizon,), name
        assert f.upper.shape == (horizon,), name
