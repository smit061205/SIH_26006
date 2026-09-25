"""Stage 6: real live marine weather data.

Uses Open-Meteo's marine weather API (marine-api.open-meteo.com) - genuinely
free, no API key required, no rate-limit headaches for this scale of use.
This is NOT synthetic or placeholder data: every call here hits a real,
live forecast service and returns whatever it currently reports.

This does NOT cover AIS vessel tracking (individual ship positions) - see
src/live_ais.py for why that one needs a real credentialed provider and
can't be done the same way.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

MARINE_API_URL = "https://marine-api.open-meteo.com/v1/marine"


def get_port_weather_forecast(latitude: float, longitude: float, forecast_days: int = 7) -> dict:
    """Real daily max wave height and wind-wave height forecast for a port's
    coordinates. Returns the raw Open-Meteo response shape (trimmed to the
    fields FREIGHTWISE cares about) - no fabricated fields."""
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": "wave_height_max,wind_wave_height_max",
        "timezone": "auto",
        "forecast_days": forecast_days,
    }
    last_error = None
    for attempt in range(2):
        try:
            resp = requests.get(MARINE_API_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            break
        except requests.RequestException as e:
            last_error = e
    else:
        raise last_error
    return {
        "latitude": data["latitude"],
        "longitude": data["longitude"],
        "timezone": data["timezone"],
        "dates": data["daily"]["time"],
        "wave_height_max_m": data["daily"]["wave_height_max"],
        "wind_wave_height_max_m": data["daily"]["wind_wave_height_max"],
    }


def get_all_ports_weather(ports_df, forecast_days: int = 7) -> dict[str, dict]:
    """Real forecast for every port in ports_df (must have latitude/longitude
    columns - see data/ports.csv). Fetched concurrently (6 independent HTTP
    calls to a free public API) rather than sequentially, since sequential
    fetching was visibly slow (~8-10s) in practice."""
    result = {}
    with ThreadPoolExecutor(max_workers=len(ports_df)) as pool:
        futures = {
            pool.submit(get_port_weather_forecast, port["latitude"], port["longitude"], forecast_days): port["name"]
            for _, port in ports_df.iterrows()
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                result[name] = future.result()
            except requests.RequestException as e:
                result[name] = {"error": str(e)}
    return result
