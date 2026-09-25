"""FastAPI layer over the existing src/ modules - thin wrapper, no new
business logic. Exists so the React frontend has a real API to call instead
of re-implementing feasibility/cost/forecast logic in JavaScript.

Run from the project root: uvicorn backend.main:app --reload --port 8000
"""
import os
import sys
import time
from datetime import date, datetime, timedelta
from functools import lru_cache, partial
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Settings from a local .env file (mail server, developer code, ...). Real
# environment variables win; the file is git-ignored - see .env.example.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from sqlalchemy import select

from backend.auth import current_user
from backend.auth import router as auth_router
from src.users import DisruptionNotice, PlantStock
from src.users import db as users_db
from src.users import now as users_now

from src.alerts import (
    AlertThresholds,
    congestion_alerts,
    market_alerts,
    notice_alerts,
    origin_congestion_alerts,
    port_activity,
    sort_alerts,
    weather_alerts,
)
from src.backtest import compare_models
from src.cost_engine import voyage_payload_tonnes
from src.data_loader import (
    FREIGHT_SERIES_CLASSES,
    MARKET_DRIVERS,
    bunker_price_usd_per_tonne,
    freight_series_class,
    load_backhaul_lanes,
    load_cost_assumptions,
    load_freight_series,
    load_gangavaram_tariff,
    load_disruption_notices,
    load_market_drivers,
    load_origin_activity,
    load_origin_transit_days,
    load_plants,
    load_port_to_plant_rail,
    load_ports,
    load_portwatch_daily,
    load_portwatch_summary,
    load_vessel_classes,
    market_drivers_weekly,
    port_monthly_calls,
    sea_leg_nm,
)
from src.feasibility import feasible_combinations, monsoon_months
from src.forecast import MODELS, arima_forecast, gbrt_drivers_forecast
from src.live_weather import get_all_ports_weather
from src.multi_shipment import Shipment, plan_shipments
from src.employment import Window as EmploymentWindow
from src.employment import employment_options, low_demand_periods
from src.rank import origin_row_for, rank_options
from src.route_freight import route_outlook, route_series, route_terms
from src.row_utils import opt_float, opt_int, opt_str
from src.scenario import idle_time_analysis, recommend_contract_split, simulate_port_exclusion, simulate_wait_scenarios
from src.schedule import MONTH_NAMES, build_contract_schedule
from src.stock import cover_for_plant, cover_vs_lead_time, plant_stock_cover
from src.timing import best_fix_week, contract_for_duration, fix_signal, fix_window_dict, forecast_horizon_for

app = FastAPI(title="FREIGHTWISE API")

# Open to anyone: the landing page's figures, sign-in itself, and the health check.
PUBLIC_PATHS = ("/api/health", "/api/public/", "/api/auth/")
# Signed-in endpoints under /api/auth check the session themselves.
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER = "x-requested-with"


@app.middleware("http")
async def access_control(request: Request, call_next):
    """Every data endpoint needs a signed-in session. Every request that
    changes something must carry X-Requested-With, which a cross-site form or
    image can't set, so the session cookie can't be used by another site."""
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/"):
        return await call_next(request)
    if request.method in UNSAFE_METHODS and request.headers.get(CSRF_HEADER) != "freightwise":
        return JSONResponse({"detail": "Missing request header."}, status_code=403)
    if not path.startswith(PUBLIC_PATHS) and current_user(request) is None:
        return JSONResponse({"detail": "Sign in to continue."}, status_code=401)
    return await call_next(request)


# Added after the access check so CORS headers wrap its responses too.
app.add_middleware(
    CORSMiddleware,
    # Comma-separated; set ALLOWED_ORIGINS to the deployed frontend's URL.
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
    # Optional, e.g. ^https://freightwise-[a-z0-9-]+\.vercel\.app$ for preview deployments.
    allow_origin_regex=os.environ.get("ALLOWED_ORIGIN_REGEX") or None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Requested-With"],
)
app.include_router(auth_router)


def _warm_forecasts() -> None:
    """Fit each class's forecast (and the backtest that picks its model) in the
    background at start-up, so the first page doesn't wait for it."""
    for series_class in FREIGHT_SERIES_CLASSES:
        try:
            _forecast(series_class, 1)
        except Exception:  # noqa: BLE001 - a failed warm-up just means the first request fits it
            pass


if os.environ.get("APP_ENV") != "test":
    import threading

    threading.Thread(target=_warm_forecasts, daemon=True, name="warm-forecasts").start()

DURATIONS = [
    {"value": 0, "label": "Spot, one voyage"},
    {"value": 3, "label": "3 months"},
    {"value": 6, "label": "6 months"},
    {"value": 12, "label": "12 months"},
]
FIX_WINDOW_WEEKS = 12
MAX_FORECAST_WEEKS = 64


def _refs() -> dict:
    return {
        "ports_df": load_ports(),
        "vessels_df": load_vessel_classes(),
        "rail_df": load_port_to_plant_rail(),
        "origin_transit_df": load_origin_transit_days(),
        "cost_assumptions": load_cost_assumptions(),
    }


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame rows as plain JSON-safe dicts."""
    return [
        {k: (None if isinstance(v, float) and pd.isna(v) else v.item() if hasattr(v, "item") else v) for k, v in row.items()}
        for row in df.to_dict(orient="records")
    ]


@app.get("/api/reference")
def get_reference():
    """Populates the frontend's form dropdowns."""
    refs = _refs()
    vessels = refs["vessels_df"]
    return {
        "ports": refs["ports_df"]["name"].tolist(),
        "plants": load_plants()["name"].tolist(),
        "origins": refs["origin_transit_df"]["origin"].tolist(),
        "months": [{"value": i + 1, "label": name} for i, name in enumerate(MONTH_NAMES)],
        "vessel_classes": [
            {
                "name": v["vessel_class"],
                "dwt_min": float(v["dwt_min"]),
                "dwt_max": float(v["dwt_max"]),
                "payload_tonnes": voyage_payload_tonnes(v, refs["cost_assumptions"]),
                "freight_series_class": freight_series_class(v["vessel_class"], vessels),
                # Main particulars, for drawing each ship to scale.
                "loa_m": float(v["loa_m"]),
                "beam_m": float(v["beam_m"]),
                "draft_laden_m": float(v["draft_laden_m"]),
                "depth_m": opt_float(v, "depth_m"),
                "holds": opt_int(v, "holds") or 0,
                "cranes": opt_int(v, "cranes") or 0,
                "tpc_t_per_cm": opt_float(v, "tpc_t_per_cm"),
                # Design details for the 3D model and the cargo-gear check.
                "crane_swl_t": opt_float(v, "crane_swl_t"),
                "hatch_cover_type": opt_str(v, "hatch_cover_type"),
                "block_coefficient": opt_float(v, "block_coefficient"),
            }
            for _, v in vessels.iterrows()
        ],
        "freight_series_classes": list(FREIGHT_SERIES_CLASSES),
        "durations": DURATIONS,
        "coal_grades": [{"value": k, "label": v} for k, v in COAL_GRADES.items()],
        # Which grades each origin ships (origin_transit_days.csv, sourced).
        "origin_grades": {
            o["origin"]: _grades_of(o) for _, o in refs["origin_transit_df"].iterrows()
        },
    }


COAL_GRADES = {"hard_coking": "Hard coking coal", "semi_soft": "Semi-soft coking coal", "pci": "PCI coal"}
CoalGrade = Literal["hard_coking", "semi_soft", "pci"]


def _grades_of(origin_row: pd.Series) -> list[str]:
    raw = opt_str(origin_row, "coal_grades")
    return [g for g in (raw or "").split(";") if g] or list(COAL_GRADES)


class RankRequest(BaseModel):
    cargo_tonnes: float = Field(gt=0, le=5_000_000)
    month: int = Field(ge=1, le=12)
    origin: str
    plant_name: str
    # Charter-party more-or-less quantity: up to this share may be left behind to save a voyage.
    tolerance_pct: float = Field(0.0, ge=0, le=20)
    coal_grade: CoalGrade | None = None


def _validate_shipment(refs: dict, origin: str, plant_name: str) -> None:
    """Unknown origins and plants are the caller's mistake: 400, not an empty answer."""
    if origin not in set(refs["origin_transit_df"]["origin"]):
        raise HTTPException(status_code=400, detail=f"Unknown origin: {origin}")
    if plant_name not in set(load_plants()["name"]):
        raise HTTPException(status_code=400, detail=f"Unknown plant: {plant_name}")


def _validate_class(refs: dict, vessel_class: str | None) -> None:
    if vessel_class is not None and vessel_class not in set(refs["vessels_df"]["vessel_class"]):
        raise HTTPException(status_code=400, detail=f"Unknown vessel class: {vessel_class}")


def _validate_port(refs: dict, port: str | None) -> None:
    if port is not None and port not in set(refs["ports_df"]["name"]):
        raise HTTPException(status_code=400, detail=f"Unknown port: {port}")


def _validate_grade(refs: dict, origin: str, grade: str | None) -> None:
    if grade is None:
        return
    row = origin_row_for(origin, refs["origin_transit_df"])
    if grade not in _grades_of(row):
        raise HTTPException(status_code=400, detail=f"{COAL_GRADES[grade]} isn't shipped from {origin}.")


def _rank(
    req: RankRequest, refs: dict, month: int | None = None, vessel_class: str | None = None, port: str | None = None
) -> pd.DataFrame:
    _validate_shipment(refs, req.origin, req.plant_name)
    _validate_grade(refs, req.origin, req.coal_grade)
    try:
        return rank_options(
            req.cargo_tonnes, month or req.month, req.origin, req.plant_name,
            refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"], refs["cost_assumptions"],
            tariff_df=load_gangavaram_tariff(), tolerance_pct=req.tolerance_pct, vessel_class=vessel_class, port=port,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/rank")
def post_rank(req: RankRequest):
    refs = _refs()
    ranked = _rank(req, refs)
    origin_row = origin_row_for(req.origin, refs["origin_transit_df"])
    feasibility_df = feasible_combinations(refs["ports_df"], refs["vessels_df"], req.month, origin_row)
    return {"ranked": _records(ranked), "feasibility": _records(feasibility_df)}


def _series_class_or_400(vessel_class: str) -> str:
    try:
        return freight_series_class(vessel_class)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Models the forecast can come from: time-series only, or with the economic
# indicators (coal, Brent, rupee). Each class uses whichever scored better in
# its own walk-forward backtest.
MODEL_LABELS = {"arima": "ARIMA (rate history)", "gbrt_drivers": "Gradient boosting with coal, oil and rupee"}


def _chosen_model(series_class: str, as_of: str) -> str:
    rows = [r for r in _backtest(series_class, FIX_WINDOW_WEEKS, as_of) if r["model"] in MODEL_LABELS]
    return min(rows, key=lambda r: r["mean_mase"])["model"] if rows else "arima"


@lru_cache(maxsize=8)
def _full_forecast(series_class: str, as_of: str) -> dict:
    """One fit per series (and per data refresh, keyed by as_of), at the
    longest horizon any caller uses; shorter horizons are slices. The model is
    the one that forecast this series best in the backtest."""
    series = load_freight_series(series_class)
    model = _chosen_model(series_class, as_of)
    drivers = market_drivers_weekly(series.index) if model == "gbrt_drivers" else None
    if model == "gbrt_drivers" and drivers is not None:
        forecast = gbrt_drivers_forecast(series, MAX_FORECAST_WEEKS, drivers=drivers)
    else:
        model = "arima"
        forecast = arima_forecast(series, MAX_FORECAST_WEEKS)
    future_dates = pd.date_range(series.index[-1] + pd.Timedelta(weeks=1), periods=MAX_FORECAST_WEEKS, freq="W-SUN")
    return {
        "series_class": series_class,
        "as_of": as_of,
        "model": model,
        "model_label": MODEL_LABELS[model],
        "history": [{"date": d.strftime("%Y-%m-%d"), "actual": float(v)} for d, v in series.tail(104).items()],
        "forecast": [
            {
                "date": d.strftime("%Y-%m-%d"),
                "forecast": float(forecast.point[i]),
                "lower": float(max(0.0, forecast.lower[i])),
                "upper": float(forecast.upper[i]),
            }
            for i, d in enumerate(future_dates)
        ],
        "current_rate": float(series.iloc[-1]),
    }


def _forecast(series_class: str, horizon: int) -> dict:
    as_of = load_freight_series(series_class).index[-1].strftime("%Y-%m-%d")
    full = _full_forecast(series_class, as_of)
    return {**full, "forecast": full["forecast"][:horizon]}


@app.get("/api/forecast")
def get_forecast(horizon: int = Query(12, ge=1, le=64), vessel_class: str = "Capesize"):
    """The weekly rate forecast for a vessel type. A type without its own index
    (Post-Panamax) is its series' rates times its premium, so the chart, today's
    rate and the timing advice all use the same numbers."""
    series_class = _series_class_or_400(vessel_class)
    fc = _forecast(series_class, horizon)
    factor = _premium(_refs(), vessel_class)
    if factor != 1.0:
        scale = lambda v: round(v * factor, 2) if v is not None else None  # noqa: E731
        fc = {
            **fc,
            "current_rate": scale(fc["current_rate"]),
            "history": [{**h, "actual": scale(h["actual"])} for h in fc["history"]],
            "forecast": [{**f, "forecast": scale(f["forecast"]), "lower": scale(f["lower"]), "upper": scale(f["upper"])} for f in fc["forecast"]],
        }
    return {"vessel_class": vessel_class, "series_class": series_class, "premium": factor, **fc}


@lru_cache(maxsize=32)
def _backtest(series_class: str, horizon: int, as_of: str) -> list[dict]:
    series = load_freight_series(series_class)
    models = dict(MODELS)
    drivers = market_drivers_weekly(series.index)
    if drivers is not None:
        # Tested alongside the rest; the forecast uses whichever of ARIMA and this scores best.
        models["gbrt_drivers"] = partial(gbrt_drivers_forecast, drivers=drivers)
    comparison = compare_models(series, models, horizon=horizon, min_train_size=150, step=20, season_length=52)
    return _records(comparison)


@app.get("/api/backtest")
def get_backtest(horizon: int = Query(12, ge=1, le=26), vessel_class: str = "Capesize"):
    series_class = _series_class_or_400(vessel_class)
    as_of = load_freight_series(series_class).index[-1].strftime("%Y-%m-%d")
    return {"vessel_class": vessel_class, "series_class": series_class, "models": _backtest(series_class, horizon, as_of)}


@app.post("/api/scenario/wait")
def post_wait_scenario(req: RankRequest):
    refs = _refs()
    _validate_shipment(refs, req.origin, req.plant_name)
    wait_df = simulate_wait_scenarios(
        req.cargo_tonnes, req.month, req.origin, req.plant_name,
        refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"], refs["cost_assumptions"],
    )
    return {"wait_scenarios": _records(wait_df)}


@app.post("/api/scenario/exclude-port")
def post_exclude_port(req: RankRequest, excluded_port: str):
    refs = _refs()
    _validate_shipment(refs, req.origin, req.plant_name)
    _validate_port(refs, excluded_port)
    result = simulate_port_exclusion(
        req.cargo_tonnes, req.month, req.origin, req.plant_name, excluded_port,
        refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"], refs["cost_assumptions"],
    )
    return {"ranked": _records(result)}


class ContractSplitRequest(BaseModel):
    cargo_tonnes: float = Field(gt=0, le=5_000_000)
    current_rate: float = Field(gt=0, le=1_000_000)
    forecast_point: float = Field(gt=0, le=1_000_000)
    forecast_lower: float = Field(ge=0, le=1_000_000)
    forecast_upper: float = Field(gt=0, le=1_000_000)
    n_voyages: int = Field(1, ge=1, le=200)
    hire_days_per_voyage: float = Field(20.0, gt=0, le=365)


@app.post("/api/scenario/contract-split")
def post_contract_split(req: ContractSplitRequest):
    split = recommend_contract_split(
        cargo_tonnes=req.cargo_tonnes,
        current_rate=req.current_rate,
        forecast_point=req.forecast_point,
        forecast_lower=req.forecast_lower,
        forecast_upper=req.forecast_upper,
        transit_plus_wait_days=req.hire_days_per_voyage,
        n_voyages=req.n_voyages,
    )
    return {
        "contract_pct": split.contract_pct,
        "spot_pct": split.spot_pct,
        "expected_change_pct": split.expected_change_pct,
        "band_width_pct": split.band_width_pct,
        "reasoning": split.reasoning,
        "cost_comparison": _records(split.cost_comparison),
    }


class PlanRequest(BaseModel):
    cargo_tonnes: float = Field(gt=0, le=5_000_000)
    month: int = Field(ge=1, le=12)
    origin: str
    plant_name: str
    n_shipments: int = Field(5, ge=1, le=20)
    max_calls_per_port_month: int = Field(2, ge=1, le=50)
    # "flat": the same slots at every port; "traffic": that many at a typical
    # port, scaled up or down by each port's real dry-bulk traffic.
    capacity_basis: Literal["flat", "traffic"] = "flat"


def port_capacities(slots: int, ports: list[str]) -> dict[str, int]:
    """Slots per port scaled by traffic: `slots` at a port with median busy-month
    calls, proportionally more at busier ports; ports without traffic data get `slots`."""
    calls = {p: port_monthly_calls(p) for p in ports}
    known = sorted(c for c in calls.values() if c)
    if not known:
        return {p: slots for p in ports}
    median = known[len(known) // 2]
    return {p: max(1, round(slots * c / median)) if c else slots for p, c in calls.items()}


@app.post("/api/plan")
def post_plan(req: PlanRequest):
    refs = _refs()
    _validate_shipment(refs, req.origin, req.plant_name)
    shipments = [
        Shipment(f"S{i}", req.cargo_tonnes, req.month, req.origin, req.plant_name)
        for i in range(1, req.n_shipments + 1)
    ]
    caps = (
        port_capacities(req.max_calls_per_port_month, list(refs["ports_df"]["name"]))
        if req.capacity_basis == "traffic"
        else {p: req.max_calls_per_port_month for p in refs["ports_df"]["name"]}
    )
    result = plan_shipments(
        shipments, refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"], refs["cost_assumptions"],
        max_calls_per_port_month=caps,
    )
    if result.unplanned and len(result.unplanned) == len(shipments):
        status, reason = "no_options", "No port and vessel type can take this cargo in this month."
    elif result.solver_status not in ("OPTIMAL", "FEASIBLE"):
        status = "infeasible"
        reason = "The shipments need more port calls than the ports' slots allow. Allow more slots or plan fewer shipments."
    else:
        status, reason = "planned", None
    return {
        "status": status,
        "reason": reason,
        "assignments": _records(result.assignments),
        "total_cost_usd": result.total_cost_usd if status == "planned" else None,
        "naive_total_cost_usd": result.naive_total_cost_usd,
        "naive_capacity_violations": _records(result.naive_capacity_violations),
        "solver_status": result.solver_status,
        "unplanned": result.unplanned,
        "capacities": caps,
    }


def _port_activity_all(recent_days: int = 28) -> dict[str, dict | None]:
    return {name: port_activity(load_portwatch_daily(name), recent_days) for name in load_ports()["name"]}


@app.get("/api/ports/map")
def get_ports_map():
    """Port specs plus IMF PortWatch dry-bulk activity where it exists."""
    ports_df = load_ports()
    summary = load_portwatch_summary().set_index("port_name")["avg_dry_bulk_calls_per_day"].to_dict()
    activity = _port_activity_all()
    rows = []
    for _, port in ports_df.iterrows():
        calls = summary.get(port["name"])
        act = activity.get(port["name"])
        months = sorted(monsoon_months(port))
        rows.append(
            {
                "name": port["name"],
                "latitude": float(port["latitude"]),
                "longitude": float(port["longitude"]),
                "max_draft_m": float(port["max_draft_m"]),
                "monsoon_draft_reduction_m": float(port["monsoon_draft_reduction_m"]),
                "monsoon_months": months,
                "monsoon_closed": str(port.get("monsoon_closed")).lower() == "true",
                "weather_delay_days_monsoon": opt_float(port, "weather_delay_days_monsoon"),
                "loa_max_m": opt_float(port, "loa_max_m"),
                "beam_max_m": opt_float(port, "beam_max_m"),
                # Unloading equipment (sourced in ports.csv) and what it means for geared ships.
                "handling_type": opt_str(port, "handling_type"),
                "shore_equipment": opt_str(port, "shore_equipment"),
                "avg_wait_days_min": float(port["avg_wait_days_min"]),
                "avg_wait_days_max": float(port["avg_wait_days_max"]),
                "vessel_classes_allowed": port["vessel_classes_allowed"],
                "discharge_rate_tpd": opt_float(port, "discharge_rate_tpd"),
                "port_type": opt_str(port, "port_type") or "berth",
                "rail_via_port": opt_str(port, "rail_via_port"),
                "transshipment_days": opt_float(port, "transshipment_days"),
                "real_avg_dry_bulk_calls_per_day": None if calls is None or pd.isna(calls) else float(calls),
                "recent_calls_per_day": act["recent_calls_per_day"] if act else None,
                "baseline_calls_per_day": act["baseline_calls_per_day"] if act else None,
                "activity_vs_normal_pct": act["pct_vs_normal"] if act else None,
                "activity_as_of": act["as_of"] if act else None,
            }
        )
    return {"ports": rows}


_WEATHER_CACHE: dict[int, tuple[float, dict]] = {}
WEATHER_TTL_S = 30 * 60
WEATHER_RETRY_S = 2 * 60


def _weather(forecast_days: int) -> dict:
    """Live forecasts for every port, cached for 30 minutes. A result where
    some ports failed is kept for only 2 minutes, so they're retried soon."""
    cached = _WEATHER_CACHE.get(forecast_days)
    if cached:
        ttl = WEATHER_TTL_S if not _weather_failures(cached[1]) else WEATHER_RETRY_S
        if time.time() - cached[0] < ttl:
            return cached[1]
    data = get_all_ports_weather(load_ports(), forecast_days=forecast_days)
    _WEATHER_CACHE[forecast_days] = (time.time(), data)
    return data


def _weather_failures(data: dict) -> list[str]:
    return [p for p, w in data.items() if not isinstance(w, dict) or w.get("error")]


def _weather_status(data: dict | None) -> str:
    if not data:
        return "unavailable"
    failed = _weather_failures(data)
    return "live" if not failed else "unavailable" if len(failed) == len(data) else "partial"


@app.get("/api/weather")
def get_weather(forecast_days: int = Query(5, ge=1, le=7)):
    """Live marine weather (Open-Meteo, no API key) for every port."""
    return {"ports": _weather(forecast_days)}


@app.get("/api/timing")
def get_timing(
    vessel_class: str = "Capesize",
    duration_months: int = Query(0, ge=0, le=12),
    window_weeks: int = Query(FIX_WINDOW_WEEKS, ge=1, le=26),
    n_voyages: int = Query(1, ge=1, le=200),
    hire_days_per_voyage: float = Query(20.0, gt=0, le=365),
    cargo_tonnes_total: float = Query(75000, gt=0, le=60_000_000),
):
    """When to fix, and how much to fix on contract, for one vessel type."""
    return _timing(vessel_class, duration_months, window_weeks, n_voyages, hire_days_per_voyage, cargo_tonnes_total)


def _series_premium(vessel_class: str) -> float:
    """A class priced off another class's index (Post-Panamax off Panamax)
    earns that index times its premium; 1.0 for the index classes."""
    match = load_vessel_classes(market_rates=False)
    match = match[match["vessel_class"] == vessel_class]
    return (opt_float(match.iloc[0], "series_premium") or 1.0) if not match.empty else 1.0


def _timing(vessel_class, duration_months, window_weeks, n_voyages, hire_days_per_voyage, cargo_tonnes_total) -> dict:
    series_class = _series_class_or_400(vessel_class)
    horizon = forecast_horizon_for(duration_months, window_weeks)
    f = _forecast(series_class, horizon)
    k = _series_premium(vessel_class)
    current_rate = round(f["current_rate"] * k, 0)
    points = [
        {"date": p["date"], "forecast": p["forecast"] * k, "lower": p["lower"] * k, "upper": p["upper"] * k}
        for p in f["forecast"]
    ]
    point = pd.Series([p["forecast"] for p in points]).to_numpy()
    lower = pd.Series([p["lower"] for p in points]).to_numpy()
    upper = pd.Series([p["upper"] for p in points]).to_numpy()
    dates = [p["date"] for p in points]
    best = best_fix_week(current_rate, f["as_of"], dates, point, lower, upper, window_weeks)
    signal, reason = fix_signal(current_rate, best)
    contract = contract_for_duration(
        current_rate, point, lower, upper, duration_months, n_voyages, hire_days_per_voyage, cargo_tonnes_total
    )
    contract["cost_comparison"] = [
        {k: (v.item() if hasattr(v, "item") else v) for k, v in row.items()} for row in contract["cost_comparison"]
    ]
    return {
        "vessel_class": vessel_class,
        "series_class": series_class,
        "duration_months": duration_months,
        "window_weeks": window_weeks,
        "current_rate": current_rate,
        "as_of": f["as_of"],
        "forecast": points,
        "best_fix": fix_window_dict(best),
        "signal": signal,
        "signal_reason": reason,
        "contract": contract,
    }


class ScheduleRequest(BaseModel):
    monthly_cargo_tonnes: float = Field(gt=0, le=5_000_000)
    start_month: int = Field(ge=1, le=12)
    duration_months: int = Field(ge=1, le=12)
    origin: str
    plant_name: str
    vessel_class: str | None = None
    port: str | None = None
    tolerance_pct: float = Field(0.0, ge=0, le=20)


WEEKS_PER_MONTH = 52 / 12


def _spot_rates_by_month(n_months: int) -> list[dict[str, float]]:
    """Expected market time-charter rate per series for each contract month:
    month 0 is fixed now at today's rate, later months average the forecast
    over that month's weeks."""
    forecasts = {c: _forecast(c, MAX_FORECAST_WEEKS) for c in FREIGHT_SERIES_CLASSES}
    out = []
    for i in range(n_months):
        row = {}
        for c, f in forecasts.items():
            if i == 0:
                row[c] = f["current_rate"]
                continue
            weeks = f["forecast"][int(i * WEEKS_PER_MONTH): int((i + 1) * WEEKS_PER_MONTH)]
            row[c] = sum(w["forecast"] for w in weeks) / len(weeks) if weeks else f["current_rate"]
        out.append(row)
    return out


def _schedule(req: ScheduleRequest, refs: dict) -> dict:
    _validate_shipment(refs, req.origin, req.plant_name)
    _validate_class(refs, req.vessel_class)
    _validate_port(refs, req.port)
    try:
        return build_contract_schedule(
            req.monthly_cargo_tonnes, req.start_month, req.duration_months, req.origin, req.plant_name,
            refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"], refs["cost_assumptions"],
            vessel_class=req.vessel_class, tariff_df=load_gangavaram_tariff(),
            spot_rates_by_month=_spot_rates_by_month(req.duration_months), tolerance_pct=req.tolerance_pct, port=req.port,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/schedule")
def post_schedule(req: ScheduleRequest):
    """Month-by-month voyages for a multi-voyage contract."""
    return _schedule(req, _refs())


def _plants_for(request: Request) -> pd.DataFrame:
    """Plants with the signed-in planner's own stock figures where they gave one."""
    plants = load_plants().copy()
    user = current_user(request)
    if user is None:
        return plants
    with users_db() as s:
        own = {r.plant_name: r for r in s.scalars(select(PlantStock).where(PlantStock.user_id == user.id))}
    plants["stock_source"] = "reference"
    plants["stock_updated_at"] = None
    for i, row in plants.iterrows():
        mine = own.get(row["name"])
        if mine is not None:
            plants.at[i, "current_inventory_tonnes"] = mine.tonnes
            plants.at[i, "stock_source"] = "yours"
            plants.at[i, "stock_updated_at"] = mine.updated_at.strftime("%Y-%m-%d")
    return plants


def _cover_rows(plants: pd.DataFrame) -> list[dict]:
    rows = plant_stock_cover(plants)
    for r, (_, p) in zip(rows, plants.iterrows()):
        r["stock_source"] = p.get("stock_source", "reference")
        r["stock_updated_at"] = p.get("stock_updated_at")
    return rows


@app.get("/api/plants")
def get_plants(request: Request):
    return {"plants": _cover_rows(_plants_for(request))}


class PlantStockRequest(BaseModel):
    plant_name: str
    # None clears the planner's own figure (back to the reference figure).
    tonnes: float | None = Field(None, ge=0, le=10_000_000)


@app.put("/api/plants/stock")
def put_plant_stock(req: PlantStockRequest, request: Request):
    """The planner's own current stock for a plant, used in their plans."""
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    if req.plant_name not in set(load_plants()["name"]):
        raise HTTPException(status_code=400, detail=f"Unknown plant: {req.plant_name}")
    with users_db() as s:
        row = s.get(PlantStock, (user.id, req.plant_name))
        if req.tonnes is None:
            if row is not None:
                s.delete(row)
        elif row is None:
            s.add(PlantStock(user_id=user.id, plant_name=req.plant_name, tonnes=req.tonnes, updated_at=users_now()))
        else:
            row.tonnes = req.tonnes
            row.updated_at = users_now()
        s.commit()
    return {"plants": _cover_rows(_plants_for(request))}


# --- disruption notices (early warnings entered by developers) ----------------

class NoticeRequest(BaseModel):
    port: str
    start_date: date
    end_date: date
    title: str = Field(min_length=3, max_length=160)
    severity: Literal["high", "medium"] = "medium"
    source: str = Field("", max_length=300)


def _notice_public(n: DisruptionNotice) -> dict:
    return {
        "id": n.id, "port": n.port, "start_date": n.start_date.strftime("%Y-%m-%d"), "end_date": n.end_date.strftime("%Y-%m-%d"),
        "title": n.title, "severity": n.severity, "source": n.source,
    }


def _require_developer(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    if not user.is_developer:
        raise HTTPException(status_code=403, detail="Only developer accounts can change disruption notices.")
    return user


@app.get("/api/notices")
def list_notices():
    with users_db() as s:
        rows = s.scalars(select(DisruptionNotice).order_by(DisruptionNotice.start_date.desc())).all()
        return {"notices": [_notice_public(n) for n in rows]}


@app.post("/api/notices")
def add_notice(req: NoticeRequest, request: Request):
    user = _require_developer(request)
    if req.port not in set(load_ports()["name"]):
        raise HTTPException(status_code=400, detail=f"Unknown port: {req.port}")
    if req.end_date < req.start_date:
        raise HTTPException(status_code=400, detail="The end date is before the start date.")
    with users_db() as s:
        n = DisruptionNotice(
            port=req.port, start_date=datetime.combine(req.start_date, datetime.min.time()),
            end_date=datetime.combine(req.end_date, datetime.min.time()), title=req.title.strip(),
            severity=req.severity, source=req.source.strip(), created_by=user.id,
        )
        s.add(n)
        s.commit()
        return _notice_public(n)


@app.delete("/api/notices/{notice_id}")
def delete_notice(notice_id: int, request: Request):
    _require_developer(request)
    with users_db() as s:
        n = s.get(DisruptionNotice, notice_id)
        if n is None:
            raise HTTPException(status_code=404, detail="Notice not found.")
        s.delete(n)
        s.commit()
    return {"message": "Deleted."}


def _all_notices() -> pd.DataFrame:
    """Notices from data/disruption_notices.csv plus those entered in the app."""
    frames = [load_disruption_notices()]
    with users_db() as s:
        rows = [_notice_public(n) for n in s.scalars(select(DisruptionNotice))]
    if rows:
        db_df = pd.DataFrame(rows).drop(columns=["id"])
        db_df["start_date"] = pd.to_datetime(db_df["start_date"])
        db_df["end_date"] = pd.to_datetime(db_df["end_date"])
        frames.append(db_df)
    frames = [f for f in frames if f is not None and not f.empty]
    return pd.concat(frames, ignore_index=True) if frames else load_disruption_notices()


@app.get("/api/alerts")
def get_alerts(
    port: str | None = None,
    vessel_class: str | None = None,
    origin: str | None = None,
    include_market: bool = True,
    wave_m: float = Query(2.5, gt=0, le=20),
    wait_days: float = Query(5.0, gt=0, le=60),
    activity_pct: float = Query(30.0, gt=0, le=1000),
    band_pct: float = Query(40.0, gt=0, le=1000),
    move_pct: float = Query(10.0, gt=0, le=1000),
    horizon: int = Query(12, ge=1, le=26),
    forecast_days: int = Query(5, ge=1, le=7),
):
    """Early warnings for one port and vessel type, or for every port."""
    if port is not None and port not in set(load_ports()["name"]):
        raise HTTPException(status_code=400, detail=f"Unknown port: {port}")
    if vessel_class is not None and vessel_class not in set(load_vessel_classes()["vessel_class"]):
        raise HTTPException(status_code=400, detail=f"Unknown vessel class: {vessel_class}")
    if origin is not None and origin not in set(load_origin_transit_days()["origin"]):
        raise HTTPException(status_code=400, detail=f"Unknown origin: {origin}")
    t = AlertThresholds(wave_m, wait_days, activity_pct, band_pct, move_pct)
    ports = [port] if port else None
    alerts: list[dict] = []
    try:
        weather = _weather(forecast_days)
    except Exception:
        weather = None
    weather_status = _weather_status(weather)
    relevant = {p: w for p, w in (weather or {}).items() if not ports or p in ports}
    if weather is not None:
        alerts += weather_alerts(weather, t, ports)
    if weather is None or (relevant and _weather_status(relevant) == "unavailable"):
        alerts.append(
            {
                "id": "weather-unavailable", "category": "data", "kind": "weather_unavailable", "severity": "info",
                "port": None, "vessel_class": None, "scope": "discharge", "days_over": None, "days_total": None,
                "peak_date": None, "direction": None,
                "title": "Sea-state forecast unavailable", "message": "The marine weather service didn't respond; try again shortly.",
                "value": None, "threshold": None, "unit": None, "date": None,
            }
        )
    alerts += congestion_alerts(load_ports(), _port_activity_all(t.activity_recent_days), t, ports)
    alerts += notice_alerts(_all_notices(), pd.Timestamp.today().normalize(), ports)
    if origin:
        origin_rows = load_origin_transit_days()
        match = origin_rows[origin_rows["origin"] == origin]
        if match.empty:
            raise HTTPException(status_code=400, detail=f"Unknown origin: {origin}")
        activity_port = opt_str(match.iloc[0], "activity_port")
        if activity_port:
            act = port_activity(load_origin_activity(activity_port), t.activity_recent_days)
            alerts += origin_congestion_alerts({activity_port: act}, t)
    if include_market:
        classes = [_series_class_or_400(vessel_class)] if vessel_class else list(FREIGHT_SERIES_CLASSES)
        forecasts = {}
        for cls in dict.fromkeys(classes):
            f = _forecast(cls, horizon)
            forecasts[cls] = {
                "current_rate": f["current_rate"],
                "point": [p["forecast"] for p in f["forecast"]],
                "lower": [p["lower"] for p in f["forecast"]],
                "upper": [p["upper"] for p in f["forecast"]],
                "dates": [p["date"] for p in f["forecast"]],
            }
        alerts += market_alerts(forecasts, t)
    return {
        "thresholds": {
            "wave_m": wave_m, "wait_days": wait_days, "activity_pct": activity_pct, "band_pct": band_pct, "move_pct": move_pct,
        },
        "alerts": sort_alerts(alerts),
        "sources": {"weather": weather_status},
    }


class IdleRequest(RankRequest):
    port: str | None = None
    vessel_class: str | None = None
    wave_threshold_m: float = Field(2.5, gt=0, le=20)
    use_live_weather: bool = True


@app.post("/api/scenario/idle")
def post_idle(req: IdleRequest):
    """Expected idle time and cost for an option, and how to cut it."""
    refs = _refs()
    _validate_shipment(refs, req.origin, req.plant_name)
    _validate_class(refs, req.vessel_class)
    _validate_port(refs, req.port)
    weather = None
    if req.use_live_weather:
        try:
            weather = _weather(5)
        except Exception:
            weather = None
    try:
        result = idle_time_analysis(
            req.cargo_tonnes, req.month, req.origin, req.plant_name,
            refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"], refs["cost_assumptions"],
            port=req.port, vessel_class=req.vessel_class, weather=weather, wave_threshold_m=req.wave_threshold_m,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"result": result, "weather": _weather_status(weather) if req.use_live_weather else "not used"}


class CharterPlanRequest(BaseModel):
    plant_name: str
    origin: str
    start_month: int = Field(ge=1, le=12)
    monthly_cargo_tonnes: float = Field(gt=0, le=5_000_000)
    duration_months: int = Field(0, ge=0, le=12)
    # Planner's fixed choices ("auto" when left out).
    vessel_class: str | None = None
    port: str | None = None
    # Fixture terms: more-or-less quantity, coal grade, laycan days in the start month.
    tolerance_pct: float = Field(0.0, ge=0, le=20)
    coal_grade: CoalGrade | None = None
    laycan_start_day: int | None = Field(None, ge=1, le=31)
    laycan_end_day: int | None = Field(None, ge=1, le=31)


def _laycan_dates(req: "CharterPlanRequest") -> tuple[date, date]:
    """The laycan in its next occurrence: this year's start month if it hasn't
    passed, otherwise next year's. Without days, the whole month."""
    import calendar

    today = date.today()
    year = today.year if req.start_month >= today.month else today.year + 1
    last = calendar.monthrange(year, req.start_month)[1]
    start_day = min(req.laycan_start_day or 1, last)
    end_day = min(req.laycan_end_day or last, last)
    if end_day < start_day:
        end_day = start_day
    start = date(year, req.start_month, start_day)
    if start < today:
        start = today
    return start, max(start, date(year, req.start_month, end_day))


@app.post("/api/charter-plan")
def post_charter_plan(req: CharterPlanRequest, request: Request):
    """Everything the Charter plan page needs, in dependency order: what to
    charter, the contract schedule, when to fix, contract vs spot, and
    whether the plant's stock lasts until the cargo arrives.

    For a contract the recommendation is the vessel class that is cheapest
    across every month (one class is held for the whole contract), so it can
    differ from the cheapest option for the first month alone; that option
    is returned as cheapest_single so the page can say why."""
    refs = _refs()
    _validate_shipment(refs, req.origin, req.plant_name)
    _validate_class(refs, req.vessel_class)
    _validate_port(refs, req.port)
    if req.laycan_start_day and req.laycan_end_day and req.laycan_end_day < req.laycan_start_day:
        raise HTTPException(status_code=400, detail="The laycan ends before it starts.")
    rank_req = RankRequest(
        cargo_tonnes=req.monthly_cargo_tonnes, month=req.start_month, origin=req.origin, plant_name=req.plant_name,
        tolerance_pct=req.tolerance_pct, coal_grade=req.coal_grade,
    )
    # A fixed discharge port narrows every option; a fixed class is applied below (and in the schedule).
    ranked = _rank(rank_req, refs, port=req.port)
    laycan_start, laycan_end = _laycan_dates(req)
    laycan = {"start": laycan_start.isoformat(), "end": laycan_end.isoformat()}
    empty = {"inputs": req.model_dump(), "laycan": laycan, "recommendation": None, "schedule": None, "timing": None, "plant": None}
    if ranked.empty:
        return empty

    months = max(1, req.duration_months)
    cargo_total = req.monthly_cargo_tonnes * months
    schedule = None
    note = None
    top = ranked.iloc[0]
    basis = "single"
    alternatives: list[dict] = []

    if req.duration_months > 0:
        schedule = _schedule(
            ScheduleRequest(
                monthly_cargo_tonnes=req.monthly_cargo_tonnes, start_month=req.start_month,
                duration_months=req.duration_months, origin=req.origin, plant_name=req.plant_name,
                vessel_class=req.vessel_class, port=req.port, tolerance_pct=req.tolerance_pct,
            ),
            refs,
        )
        note = schedule["note"]
        chosen = schedule["contract_vessel_class"]
        first = schedule["months"][0] if schedule["months"] else None
        if chosen and first and first.get("port"):
            match = ranked[(ranked["port"] == first["port"]) & (ranked["vessel_class"] == chosen)]
            if not match.empty:
                top = match.iloc[0]
                basis = "contract"
        if basis == "contract":
            # Other classes that can also be held for the whole contract, by contract total.
            workable = sorted(
                (c for c in schedule["classes_considered"] if c["total_usd"] is not None and c["vessel_class"] != chosen),
                key=lambda c: c["total_usd"],
            )
            for c in workable[:3]:
                row = ranked[ranked["vessel_class"] == c["vessel_class"]].iloc[0]
                alternatives.append(
                    {**_records(row.to_frame().T)[0], "usd_per_tonne_over_contract": round(c["total_usd"] / cargo_total, 4)}
                )
    else:
        if req.vessel_class:
            match = ranked[ranked["vessel_class"] == req.vessel_class]
            if match.empty:
                note = f"A {req.vessel_class} can't take this cargo in {MONTH_NAMES[req.start_month - 1]}, so the plan uses the cheapest option."
            else:
                top = match.iloc[0]

    if basis == "single":
        others = ranked[~((ranked["port"] == top["port"]) & (ranked["vessel_class"] == top["vessel_class"]))]
        others = others[others["usd_per_tonne"] >= top["usd_per_tonne"]].head(3)
        alternatives = [{**r, "usd_per_tonne_over_contract": r["usd_per_tonne"]} for r in _records(others)]

    # A contract with no class that works every month falls back to the best
    # first-month option, repeated for each month of the contract.
    if basis == "contract":
        total_over_contract = schedule["totals"]["contract_total_usd"]
    else:
        total_over_contract = float(top["total_usd"]) * months
    cheapest = ranked.iloc[0]
    cheapest_single = None
    if (cheapest["port"], cheapest["vessel_class"]) != (top["port"], top["vessel_class"]):
        cheapest_single = _records(cheapest.to_frame().T)[0]

    total_voyages = schedule["totals"]["voyages"] if basis == "contract" else int(top["n_voyages"]) * months
    # Hire days per voyage, matching the cost engine: sea, loading-port queue, loading, alongside,
    # berth queue and swell days.
    hire_days = float(
        top["transit_days"] + top["load_wait_days"] + top["expected_wait_days"] + top["weather_days"]
        + top["berth_days"] + top["load_days"]
    )
    timing = _timing(str(top["vessel_class"]), req.duration_months, FIX_WINDOW_WEEKS, total_voyages, hire_days, cargo_total)

    plant = None
    plants = _plants_for(request)
    cover = cover_for_plant(plants, req.plant_name)
    if cover:
        match = plants[plants["name"] == req.plant_name].iloc[0]
        cover["stock_source"] = match.get("stock_source", "reference")
        cover["stock_updated_at"] = match.get("stock_updated_at")
        # The first cargo reaches the plant its lead time after the laycan opens.
        arrival = cover_vs_lead_time(cover, float(top["total_lead_days"]), (laycan_start - date.today()).days)
        fastest = None
        if arrival["stockout_before_arrival"]:
            quickest = ranked.sort_values(["total_lead_days", "usd_per_tonne"]).iloc[0]
            if float(quickest["total_lead_days"]) < float(top["total_lead_days"]):
                fastest = _records(quickest.to_frame().T)[0]
        days_to_fix = arrival["days_to_fix"]
        fix_by = (date.today() + timedelta(days=int(days_to_fix))).isoformat() if days_to_fix is not None and days_to_fix >= 0 else None
        plant = {**cover, **arrival, "fix_by_date": fix_by, "fastest_option": fastest}

    return {
        "inputs": req.model_dump(),
        "laycan": laycan,
        "recommendation": {
            "basis": basis,
            "top": _records(top.to_frame().T)[0],
            "alternatives": alternatives,
            "cheapest_single": cheapest_single,
            "total_usd_over_contract": total_over_contract,
            "usd_per_tonne_over_contract": round(total_over_contract / cargo_total, 4),
            "total_voyages": total_voyages,
            "note": note,
        },
        "schedule": schedule,
        "timing": timing,
        "plant": plant,
    }


# --- freight by trade route ------------------------------------------------------

def _premium(refs: dict, vessel_class: str) -> float:
    row = refs["vessels_df"][refs["vessels_df"]["vessel_class"] == vessel_class].iloc[0]
    return float(row["series_premium"]) if pd.notna(row.get("series_premium")) else 1.0


def _route_rows(refs: dict, vessel_class: str, cargo: float, month: int, plant: str, origin: str | None = None) -> list[dict]:
    """Every route (origin to discharge port) a vessel type can sail, costed today."""
    origins = [origin] if origin else refs["origin_transit_df"]["origin"].tolist()
    rows = []
    for o in origins:
        ranked = rank_options(
            cargo, month, o, plant, refs["ports_df"], refs["vessels_df"], refs["rail_df"], refs["origin_transit_df"],
            refs["cost_assumptions"], tariff_df=load_gangavaram_tariff(), vessel_class=vessel_class,
        )
        for r in _records(ranked):
            rows.append({**r, "origin": o})
    return rows


@app.get("/api/route-freight")
def get_route_freight(
    vessel_class: str = "Panamax",
    cargo: float = Query(75000, gt=0, le=5_000_000),
    month: int = Query(None, ge=1, le=12),
    plant: str | None = None,
):
    """Sea freight in USD per tonne for every route a vessel type can sail, now
    and 4, 12 and 26 weeks ahead from the class's rate forecast."""
    refs = _refs()
    _validate_class(refs, vessel_class)
    plant = plant or load_plants()["name"].iloc[0]
    _validate_shipment(refs, refs["origin_transit_df"]["origin"].iloc[0], plant)
    month = month or date.today().month
    series_class = _series_class_or_400(vessel_class)
    fc = _forecast(series_class, 26)
    premium = _premium(refs, vessel_class)
    out = []
    for r in _route_rows(refs, vessel_class, cargo, month, plant):
        terms = route_terms(r)
        out.append(
            {
                "origin": r["origin"],
                "port": r["port"],
                "route_nm": r["route_nm"],
                "transit_days": r["transit_days"],
                "n_voyages": r["n_voyages"],
                "part_loaded": r["part_loaded"],
                **route_outlook(terms, fc["forecast"], premium, fc["current_rate"]),
            }
        )
    out.sort(key=lambda x: x["now"])
    return {
        "vessel_class": vessel_class, "month": month, "cargo_tonnes": cargo, "model": fc["model"], "model_label": fc["model_label"],
        "as_of": fc["as_of"], "routes": out,
    }


@app.get("/api/route-freight/series")
def get_route_freight_series(
    vessel_class: str,
    origin: str,
    port: str,
    cargo: float = Query(75000, gt=0, le=5_000_000),
    month: int = Query(None, ge=1, le=12),
    plant: str | None = None,
):
    """One route's weekly sea freight in USD per tonne: two years of history at
    the rates then, and the forecast with its 80% range."""
    refs = _refs()
    _validate_class(refs, vessel_class)
    _validate_port(refs, port)
    plant = plant or load_plants()["name"].iloc[0]
    _validate_shipment(refs, origin, plant)
    month = month or date.today().month
    rows = [r for r in _route_rows(refs, vessel_class, cargo, month, plant, origin) if r["port"] == port]
    if not rows:
        raise HTTPException(status_code=404, detail=f"A {vessel_class} can't sail from {origin} to {port} in {MONTH_NAMES[month - 1]}.")
    series_class = _series_class_or_400(vessel_class)
    fc = _forecast(series_class, 26)
    terms = route_terms(rows[0])
    return {
        "vessel_class": vessel_class, "origin": origin, "port": port, "model_label": fc["model_label"],
        **route_series(terms, fc["history"], fc["forecast"], _premium(refs, vessel_class)),
    }


# --- keeping an idle ship earning ------------------------------------------------

class EmploymentRequest(RankRequest):
    vessel_class: str | None = None
    port: str | None = None
    # Days the ship isn't needed; left out, it comes from the plant's stock above its buffer.
    idle_days: float | None = Field(None, ge=1, le=90)


@app.post("/api/scenario/employment")
def post_employment(req: EmploymentRequest, request: Request):
    """Wait, sublet or take a backhaul cargo while a chartered ship isn't
    needed, and when such spells are likely (low-demand periods)."""
    refs = _refs()
    _validate_class(refs, req.vessel_class)
    _validate_port(refs, req.port)
    ranked = _rank(req, refs, vessel_class=req.vessel_class, port=req.port)
    if ranked.empty:
        return {"options": None, "periods": None, "reason": "No option can take this cargo."}
    top = ranked.iloc[0]
    cls, port = str(top["vessel_class"]), str(top["port"])
    vessel = refs["vessels_df"][refs["vessels_df"]["vessel_class"] == cls].iloc[0]
    port_row = refs["ports_df"][refs["ports_df"]["name"] == port].iloc[0]
    ca = refs["cost_assumptions"]
    series_class = _series_class_or_400(cls)
    fc = _forecast(series_class, 26)
    premium = _premium(refs, cls)
    hire_rate = float(top["hire_rate_usd_per_day"])

    plants = _plants_for(request)
    cover = cover_for_plant(plants, req.plant_name)
    periods = low_demand_periods(
        cover, sorted(monsoon_months(port_row)), str(port_row.get("monsoon_closed")).lower() == "true",
        fc["forecast"], hire_rate, premium, req.month,
    )
    idle = req.idle_days or max(5.0, min(30.0, periods["stock_spare_days"] or 10.0))
    # The market rate while the ship is spare: the forecast over the next few weeks.
    weeks = fc["forecast"][: max(1, int(idle // 7) + 1)]
    market_rate = sum(w["forecast"] for w in weeks) / len(weeks) * premium

    speed = float(ca.get("service_speed_knots", 13.5))
    ballast_nm = sea_leg_nm(port, req.origin) or float(top["route_nm"] or 0)
    lanes = load_backhaul_lanes()
    lane = lanes[(lanes["from_port"] == port) & (lanes["vessel_class"] == cls)]
    options = employment_options(
        vessel, float(top["payload_tonnes"]), EmploymentWindow(idle_days=idle, ballast_days=ballast_nm / (speed * 24)),
        hire_rate, market_rate, bunker_price_usd_per_tonne(ca), float(ca.get("sublet_commission_pct", 3.75)),
        lane.iloc[0] if not lane.empty else None, sea_leg_nm(port, "Qingdao"), sea_leg_nm("Qingdao", req.origin), speed,
    )
    return {
        "vessel_class": cls, "port": port, "origin": req.origin, "idle_days": idle,
        "idle_days_source": "input" if req.idle_days else ("stock" if periods["stock_spare_days"] else "default"),
        **options, "periods": periods,
    }


@app.get("/api/load-ports")
def get_load_ports():
    """Each origin's loading terminal: its size limits and loading rate, and
    how busy it has been lately (IMF PortWatch dry-bulk calls)."""
    rows = []
    for _, o in load_origin_transit_days().iterrows():
        activity_port = opt_str(o, "activity_port")
        act = port_activity(load_origin_activity(activity_port)) if activity_port else None
        rows.append(
            {
                "origin": o["origin"],
                "load_port": opt_str(o, "load_port"),
                "activity_port": activity_port,
                "transit_days": float(o["transit_days_est"]),
                "max_draft_m": opt_float(o, "load_max_draft_m"),
                "max_loa_m": opt_float(o, "load_max_loa_m"),
                "max_beam_m": opt_float(o, "load_max_beam_m"),
                "max_dwt": opt_float(o, "load_max_dwt"),
                "load_rate_tpd": opt_float(o, "load_rate_tpd"),
                "recent_calls_per_day": act["recent_calls_per_day"] if act else None,
                "baseline_calls_per_day": act["baseline_calls_per_day"] if act else None,
                "activity_vs_normal_pct": act["pct_vs_normal"] if act else None,
                "activity_as_of": act["as_of"] if act else None,
            }
        )
    return {"load_ports": rows}


@app.get("/api/ports/{name}/history")
def get_port_history(name: str, weeks: int = Query(104, ge=4, le=410)):
    """Weekly dry-bulk calls at a discharge or loading port."""
    daily = load_portwatch_daily(name)
    if daily is None:
        origins = load_origin_transit_days()
        if name in set(origins["activity_port"].dropna()) or name in set(load_ports()["name"]):
            daily = load_origin_activity(name) if name in set(origins["activity_port"].dropna()) else None
        else:
            raise HTTPException(status_code=404, detail=f"Unknown port: {name}")
    if daily is None or daily.empty:
        return {"port": name, "weeks": [], "average_calls_per_week": None}
    weekly = daily.set_index("date")["portcalls_dry_bulk"].resample("W-SUN").sum()
    # The last week is usually part-way through; leave it out rather than show a dip.
    weekly = weekly.iloc[:-1].tail(weeks)
    return {
        "port": name,
        "weeks": [{"date": d.strftime("%Y-%m-%d"), "calls": int(v)} for d, v in weekly.items()],
        "average_calls_per_week": round(float(weekly.mean()), 2) if len(weekly) else None,
    }


def _pct_change(values: pd.Series, months: int) -> float | None:
    """Change from the latest value to the value about `months` earlier."""
    latest_date = values.index[-1]
    earlier = values[values.index <= latest_date - pd.DateOffset(months=months)]
    if earlier.empty or not earlier.iloc[-1]:
        return None
    return round((values.iloc[-1] / earlier.iloc[-1] - 1) * 100, 1)


@app.get("/api/drivers")
def get_drivers():
    """Coal, oil and rupee: latest value, 3- and 12-month change, and two
    years of history (data/market_drivers.csv, real public data)."""
    df = load_market_drivers()
    if df is None:
        return {"drivers": []}
    out = []
    for key, label in MARKET_DRIVERS.items():
        g = df[df["series"] == key].sort_values("date")
        if g.empty:
            continue
        values = g.set_index("date")["value"]
        recent = values[values.index >= values.index[-1] - pd.DateOffset(months=24)]
        out.append(
            {
                "key": key,
                "label": label,
                "unit": str(g["unit"].iloc[0]),
                "frequency": str(g["frequency"].iloc[0]),
                "source": str(g["source"].iloc[0]),
                "latest": {"date": values.index[-1].strftime("%Y-%m-%d"), "value": float(values.iloc[-1])},
                "change_3m_pct": _pct_change(values, 3),
                "change_12m_pct": _pct_change(values, 12),
                "history": [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in recent.items()],
            }
        )
    return {"drivers": out}


@app.get("/api/public/summary")
def public_summary():
    """Market figures for the landing page: public index levels and coverage,
    nothing about any user or shipment."""
    rates = {}
    for cls in FREIGHT_SERIES_CLASSES:
        series = load_freight_series(cls)
        rates[cls] = {"rate": float(series.iloc[-1]), "as_of": series.index[-1].strftime("%Y-%m-%d")}
    return {
        "rates": rates,
        "ports": len(load_ports()),
        "load_ports": len(load_origin_transit_days()),
        "plants": len(load_plants()),
        "vessel_types": len(load_vessel_classes(market_rates=False)),
    }


@app.get("/api/public/ports")
def public_ports():
    """Conditions at each discharge port for the landing page: the live sea
    forecast (Open-Meteo) and dry-bulk activity against normal (IMF PortWatch)."""
    weather = _weather(5)
    activity = _port_activity_all()
    rows = []
    for name in load_ports()["name"]:
        w = weather.get(name)
        act = activity.get(name)
        ok = isinstance(w, dict) and not w.get("error")
        rows.append(
            {
                "name": name,
                "dates": w.get("dates") if ok else None,
                "wave_height_max_m": w.get("wave_height_max_m") if ok else None,
                "activity_vs_normal_pct": act["pct_vs_normal"] if act else None,
            }
        )
    return {"ports": rows, "weather": _weather_status(weather)}


SEA_ROUTES = Path(__file__).resolve().parent.parent / "data" / "sea_routes.json"


@lru_cache(maxsize=1)
def _sea_routes() -> dict:
    """Routes for every load port and discharge port pair (scripts/build_sea_routes.py)."""
    import json

    return json.loads(SEA_ROUTES.read_text())


def _port_points() -> dict:
    return {r["name"]: {"lon": float(r["longitude"]), "lat": float(r["latitude"])} for _, r in load_ports().iterrows()}


@app.get("/api/public/routes")
def public_routes():
    """Every sea route with its end points, for the coverage globe. Public reference geography only."""
    data = _sea_routes()
    return {"load_ports": data["load_ports"], "ports": _port_points(), "routes": data["routes"]}


@app.get("/api/routes")
def get_route(origin: str, port: str):
    """One voyage's route and length, with the planning transit time used elsewhere in the app."""
    data = _sea_routes()
    route = next((r for r in data["routes"] if r["origin"] == origin and r["port"] == port), None)
    if route is None:
        raise HTTPException(status_code=404, detail=f"No route from {origin} to {port}")
    transit = load_origin_transit_days()
    days = transit.loc[transit["origin"] == origin, "transit_days_est"]
    load_port = transit.loc[transit["origin"] == origin, "load_port"]
    return {
        **route,
        "transit_days": float(days.iloc[0]) if len(days) else round(route["nm"] / (13.5 * 24), 1),
        "load_port": {"name": str(load_port.iloc[0]) if len(load_port) else origin, **data["load_ports"][origin]},
        "discharge": {"name": port, **_port_points()[port]},
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}
