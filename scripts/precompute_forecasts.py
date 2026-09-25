"""Works out every freight-model backtest and forecast the app serves, and
stores them in the forecast cache (backend/var/forecast-cache), so a new
server answers its first Charter plan or Freight outlook request at once
instead of spending minutes of CPU on it. The Docker build runs this.

Run from the project root: python -m scripts.precompute_forecasts
"""
import time

from backend.main import BACKTEST_HORIZONS, FIX_WINDOW_WEEKS, FORECAST_CACHE, _backtest, _full_forecast
from src.data_loader import FREIGHT_SERIES_CLASSES, load_freight_series


def main() -> None:
    started = time.time()
    for series_class in FREIGHT_SERIES_CLASSES:
        as_of = load_freight_series(series_class).index[-1].strftime("%Y-%m-%d")
        for horizon in sorted({*BACKTEST_HORIZONS, FIX_WINDOW_WEEKS}):
            _backtest(series_class, horizon, as_of)
        model = _full_forecast(series_class, as_of)["model"]
        print(f"{series_class}: data to {as_of}, model {model}", flush=True)
    print(f"Forecast cache ready in {FORECAST_CACHE} ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main()
