"""Loads FREIGHTWISE reference data (ports, vessel classes, plants, cost assumptions).

All CSVs live in ../data relative to this file and carry a data_confidence
column so downstream code and the UI can flag placeholder/synthetic figures
rather than presenting them as verified.
"""
from functools import lru_cache
from pathlib import Path

import pandas as pd

from src.row_utils import opt_str

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _mtime_cached(fn):
    """Cache a file reader until the file changes on disk. Public loaders
    return copies, so callers can't mutate the cached frame."""
    cache: dict = {}

    def wrapper(path: Path):
        key = (str(path), path.stat().st_mtime_ns)
        if key not in cache:
            if len(cache) > 64:
                cache.clear()
            cache[key] = fn(path)
        return cache[key]

    wrapper.cache = cache
    return wrapper


@_mtime_cached
def _read_file(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    return df.where(pd.notnull(df), None)


def _read(name: str) -> pd.DataFrame:
    return _read_file(DATA_DIR / name).copy()


def load_ports() -> pd.DataFrame:
    df = _read("ports.csv")
    df["vessel_classes_allowed"] = df["vessel_classes_allowed"].apply(
        lambda s: [v.strip() for v in s.split(",")]
    )
    return df


def load_vessel_classes(market_rates: bool = True) -> pd.DataFrame:
    """Vessel classes. With market_rates, adds market_hire_rate_usd_per_day:
    the latest weekly rate of the class's series x series_premium, which the
    cost engine prices hire at (cost_engine.hire_rate_for)."""
    df = _read("vessel_classes.csv")
    if market_rates:
        latest = latest_market_rates()
        df["market_hire_rate_usd_per_day"] = [
            round(latest[s] * float(p if p is not None else 1.0), 0) if s in latest else None
            for s, p in zip(df["freight_index_class"], df.get("series_premium", [1.0] * len(df)))
        ]
    return df


def load_plants() -> pd.DataFrame:
    return _read("plants.csv")


def load_cost_assumptions() -> dict:
    df = _read("cost_assumptions.csv")
    return dict(zip(df["parameter"], df["value"]))


def load_origin_transit_days() -> pd.DataFrame:
    return _read("origin_transit_days.csv")


def load_port_to_plant_rail() -> pd.DataFrame:
    return _read("port_to_plant_rail.csv")


def load_gangavaram_tariff() -> pd.DataFrame:
    """One row per GT-tier per charge type - see cost_engine.gangavaram_real_port_charges."""
    return _read("gangavaram_real_tariff_reference.csv")


FREIGHT_SERIES_CLASSES = ("Handysize", "Supramax", "Panamax", "Capesize")


def freight_series_class(vessel_class: str, vessels_df: pd.DataFrame | None = None) -> str:
    """The market series a vessel class is priced against (Post-Panamax
    trades off the Panamax index)."""
    if vessel_class in FREIGHT_SERIES_CLASSES:
        return vessel_class
    vessels_df = vessels_df if vessels_df is not None else load_vessel_classes(market_rates=False)
    match = vessels_df[vessels_df["vessel_class"] == vessel_class]
    series = opt_str(match.iloc[0], "freight_index_class") if not match.empty else None
    if series is None:
        raise ValueError(f"Unknown vessel class: {vessel_class}")
    return series


def latest_market_rates() -> dict[str, float]:
    """Latest weekly time-charter rate per market series, USD/day."""
    rates = {}
    for series_class in FREIGHT_SERIES_CLASSES:
        path = DATA_DIR / f"freight_rates_{series_class.lower()}.csv"
        if path.exists():
            rates[series_class] = float(_read_series_file(path).iloc[-1])
    return rates


def load_freight_series(vessel_class: str = "Capesize") -> pd.Series:
    """Weekly time-charter rate, USD/day, indexed by week-ending Sunday."""
    series_class = freight_series_class(vessel_class)
    return _read_series_file(DATA_DIR / f"freight_rates_{series_class.lower()}.csv").copy()


@_mtime_cached
def _read_series_file(path: Path) -> pd.Series:
    df = pd.read_csv(path, parse_dates=["date"])
    series = df.set_index("date")["freight_usd_per_day"]
    series.index.freq = "W-SUN"
    return series


PORTWATCH_DAILY_FILES = {
    "Dhamra": "imf_portwatch_dhamra_full_history.csv",
    "Haldia": "imf_portwatch_haldia_full_history.csv",
    "Paradip": "imf_portwatch_paradip_full_history.csv",
    "Visakhapatnam": "imf_portwatch_visakhapatnam_full_history.csv",
    "Gopalpur": "imf_portwatch_gopalpur_full_history.csv",
}


def load_portwatch_daily(port_name: str) -> pd.DataFrame | None:
    """Daily dry-bulk port calls (IMF PortWatch) where a full history exists."""
    name = PORTWATCH_DAILY_FILES.get(port_name)
    if name is None:
        return None
    return _read_dated(DATA_DIR / name).copy()


@_mtime_cached
def _read_dated(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, parse_dates=["date"])


def load_origin_activity(activity_port: str | None) -> pd.DataFrame | None:
    """Daily dry-bulk calls at a loading port (scripts/fetch_portwatch.py)."""
    if not activity_port:
        return None
    path = DATA_DIR / f"imf_portwatch_origin_{activity_port.lower().replace(' ', '_').replace('-', '_')}.csv"
    return _read_dated(path).copy() if path.exists() else None


def port_monthly_calls(port_name: str, months: int = 24, quantile: float = 0.9) -> float | None:
    """A busy month's dry-bulk calls at a port: the 90th percentile of monthly
    call totals over the last two years."""
    daily = load_portwatch_daily(port_name)
    if daily is None or daily.empty:
        return None
    monthly = daily.set_index("date")["portcalls_dry_bulk"].resample("MS").sum()
    monthly = monthly.iloc[:-1].tail(months)  # drop the month still in progress
    return float(monthly.quantile(quantile)) if len(monthly) else None


def load_disruption_notices() -> pd.DataFrame:
    """Hand-kept notices (strikes, closures, dredging) in
    data/disruption_notices.csv: port, start_date, end_date, title,
    severity (high/medium/info), source. Empty when none are recorded."""
    path = DATA_DIR / "disruption_notices.csv"
    if not path.exists():
        return pd.DataFrame(columns=["port", "start_date", "end_date", "title", "severity", "source"])
    df = pd.read_csv(path, parse_dates=["start_date", "end_date"])
    return df


def load_portwatch_summary() -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / "imf_portwatch_summary.csv")
    df["port_name"] = df["port_name"].replace({"Dhamra Port": "Dhamra"})
    return df


MARKET_DRIVERS = {
    "coal_au": "Australian coal",
    "brent": "Brent crude",
    "usd_inr": "Rupee per dollar",
}


def load_market_drivers() -> pd.DataFrame | None:
    """Coal, oil and currency series (data/market_drivers.csv, from
    scripts/fetch_market_drivers.py); None if the file hasn't been fetched."""
    path = DATA_DIR / "market_drivers.csv"
    if not path.exists():
        return None
    return _read_dated(path).copy()


def market_drivers_weekly(index: pd.DatetimeIndex) -> pd.DataFrame | None:
    """Each driver as known at each week in `index`: the latest published
    value, carried forward. A monthly average only exists once its month is
    over, so monthly values count from the following month."""
    df = load_market_drivers()
    if df is None:
        return None
    columns = {}
    for name, g in df.groupby("series"):
        values = g.set_index("date")["value"].sort_index()
        if (g["frequency"] == "monthly").all():
            values.index = values.index + pd.offsets.MonthBegin(1)
        columns[name] = values.reindex(values.index.union(index)).ffill().reindex(index)
    return pd.DataFrame(columns, index=index)


@lru_cache(maxsize=1)
def _sea_route_lengths() -> dict[tuple[str, str], float]:
    """Sea-route length (nm) per (origin, port) from data/sea_routes.json
    (scripts/build_sea_routes.py: shortest path over real shipping lanes)."""
    import json

    path = DATA_DIR / "sea_routes.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {(r["origin"], r["port"]): float(r["nm"]) for r in data.get("routes", [])}


def route_distance_nm(origin: str, port: str) -> float | None:
    return _sea_route_lengths().get((origin, port))


def latest_brent() -> float | None:
    """Latest Brent crude price, USD/bbl (FRED, data/market_drivers.csv)."""
    df = load_market_drivers()
    if df is None:
        return None
    brent = df[df["series"] == "brent"].sort_values("date")
    return float(brent["value"].iloc[-1]) if not brent.empty else None


def bunker_price_usd_per_tonne(cost_assumptions: dict) -> float:
    """VLSFO price, tracking Brent (vlsfo_usd_per_tonne_per_brent_usd x Brent)."""
    brent = latest_brent()
    ratio = float(cost_assumptions.get("vlsfo_usd_per_tonne_per_brent_usd", 7.6))
    if brent:
        return round(brent * ratio, 1)
    return float(cost_assumptions.get("vlsfo_fallback_usd_per_tonne", 600))


def origin_wait_days(origin_row, cost_assumptions: dict) -> float:
    """Expected wait at the loading terminal: a normal month's wait, scaled by
    how much busier the port is than a year ago (IMF PortWatch dry-bulk calls),
    between 1x and 3x."""
    from src.alerts import port_activity
    from src.row_utils import opt_str

    base = float(cost_assumptions.get("origin_base_wait_days", 1.5))
    activity = port_activity(load_origin_activity(opt_str(origin_row, "activity_port")))
    if not activity or activity.get("pct_vs_normal") is None:
        return base
    factor = min(3.0, max(1.0, 1 + float(activity["pct_vs_normal"]) / 100))
    return round(base * factor, 1)


@lru_cache(maxsize=1)
def _sea_legs() -> dict[tuple[str, str], float]:
    """Other sea legs (backhaul to China, ballast back to each load port) from data/sea_routes.json."""
    import json

    path = DATA_DIR / "sea_routes.json"
    if not path.exists():
        return {}
    return {(l["from"], l["to"]): float(l["nm"]) for l in json.loads(path.read_text()).get("legs", [])}


def sea_leg_nm(start: str, end: str) -> float | None:
    return _sea_legs().get((start, end))


def load_backhaul_lanes() -> pd.DataFrame:
    """Backhaul cargoes from the east-coast ports (data/backhaul_lanes.csv, estimates with sources)."""
    return _read("backhaul_lanes.csv")
