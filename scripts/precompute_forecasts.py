"""Works out every freight-model backtest and forecast the app serves and
stores them, so a server answers its first Charter plan or Freight outlook
request at once instead of spending minutes of CPU on it.

  python -m scripts.precompute_forecasts --bundle   # refresh data/forecast-cache (commit it)
  python -m scripts.precompute_forecasts            # fill in anything missing (the Docker build)

Run --bundle after changing the freight series, market drivers or the model
code; tests/test_main.py fails while the shipped results are out of date.
"""
import sys
import time

from backend import main
from src.data_loader import FREIGHT_SERIES_CLASSES, load_freight_series


def targets():
    """(series_class, as_of, horizons) for everything the app serves."""
    for series_class in FREIGHT_SERIES_CLASSES:
        as_of = load_freight_series(series_class).index[-1].strftime("%Y-%m-%d")
        yield series_class, as_of, sorted({*main.BACKTEST_HORIZONS, main.FIX_WINDOW_WEEKS})


def main_() -> None:
    bundle = "--bundle" in sys.argv[1:]
    if bundle:
        # Start clean so results for old inputs don't linger; write straight into the bundle.
        main.FORECAST_BUNDLE.mkdir(parents=True, exist_ok=True)
        for old in main.FORECAST_BUNDLE.glob("*.json"):
            old.unlink()
        main.FORECAST_CACHE = main.FORECAST_BUNDLE
    started = time.time()
    for series_class, as_of, horizons in targets():
        for horizon in horizons:
            main._backtest(series_class, horizon, as_of)
        model = main._full_forecast(series_class, as_of)["model"]
        saved = [main._savings(series_class, d, as_of)["median_saving_pct"] for d in main.SAVINGS_DURATIONS]
        print(f"{series_class}: data to {as_of}, model {model}, median saving vs spot {saved}% (3/6/12 months)", flush=True)
    print(f"Forecast results ready ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main_()
