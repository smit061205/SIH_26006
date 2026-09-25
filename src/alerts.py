"""Early warnings: sea state, port congestion and freight-market volatility.

Each alert states what triggered it and the threshold it crossed. Thresholds
are parameters, so a desk can tighten or loosen them. Alongside the English
title/message, every alert carries structured fields (kind, value,
threshold, unit, date, days_over, peak_date, direction) so a client can
group alerts and write its own text, e.g. in another language.
"""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from src.cost_engine import expected_wait_days


@dataclass
class AlertThresholds:
    wave_height_m: float = 2.5
    wait_days: float = 5.0
    activity_surge_pct: float = 30.0
    forecast_band_pct: float = 40.0
    forecast_move_pct: float = 10.0
    activity_recent_days: int = 28


def port_activity(daily_df: pd.DataFrame | None, recent_days: int = 28, baseline_days: int = 365) -> dict | None:
    """Recent dry-bulk calls per day against the year before that window. The
    all-time average would flag steady growth since 2019 as a surge."""
    if daily_df is None or daily_df.empty:
        return None
    df = daily_df.sort_values("date")
    as_of = df["date"].max()
    recent_start = as_of - pd.Timedelta(days=recent_days - 1)
    base_start = recent_start - pd.Timedelta(days=baseline_days)
    recent = df[df["date"] >= recent_start]["portcalls_dry_bulk"]
    base = df[(df["date"] >= base_start) & (df["date"] < recent_start)]["portcalls_dry_bulk"]
    if recent.empty or base.empty or base.mean() == 0:
        return None
    return {
        "as_of": as_of.strftime("%Y-%m-%d"),
        "recent_calls_per_day": round(float(recent.mean()), 2),
        "baseline_calls_per_day": round(float(base.mean()), 2),
        "pct_vs_normal": round((float(recent.mean()) - float(base.mean())) / float(base.mean()) * 100, 1),
    }


def _day(iso: str) -> str:
    d = pd.Timestamp(iso)
    return f"{d.day} {d.strftime('%b')}"


def _alert(**kwargs) -> dict:
    base = {"port": None, "vessel_class": None, "date": None, "unit": None, "kind": None, "days_over": None,
            "days_total": None, "peak_date": None, "direction": None, "scope": "discharge"}
    base.update(kwargs)
    return base


def weather_alerts(weather: dict, t: AlertThresholds, ports: list[str] | None = None) -> list[dict]:
    alerts = []
    for port, w in weather.items():
        if ports and port not in ports:
            continue
        heights = w.get("wave_height_max_m") if isinstance(w, dict) else None
        dates = w.get("dates") if isinstance(w, dict) else None
        if not heights or not dates or w.get("error"):
            continue
        over = [(i, h) for i, h in enumerate(heights) if h is not None and h >= t.wave_height_m]
        if not over:
            continue
        first_i, _ = over[0]
        peak_i, peak = max(over, key=lambda x: x[1])
        severe = peak >= 1.5 * t.wave_height_m or first_i <= 1
        alerts.append(
            _alert(
                id=f"weather-{port}",
                category="weather",
                kind="rough_sea",
                days_over=len(over),
                days_total=len(heights),
                peak_date=dates[peak_i],
                severity="high" if severe else "medium",
                port=port,
                title=f"Rough sea at {port}",
                message=f"Waves up to {peak:.1f} m on {_day(dates[peak_i])}; {len(over)} of the next {len(heights)} days at or above {t.wave_height_m:g} m.",
                value=round(float(peak), 1),
                threshold=t.wave_height_m,
                unit="m",
                date=dates[first_i],
            )
        )
    return alerts


def congestion_alerts(
    ports_df: pd.DataFrame, activity: dict[str, dict | None], t: AlertThresholds, ports: list[str] | None = None
) -> list[dict]:
    alerts = []
    for _, port in ports_df.iterrows():
        name = port["name"]
        if ports and name not in ports:
            continue
        wait = expected_wait_days(port)
        if wait >= t.wait_days:
            alerts.append(
                _alert(
                    id=f"wait-{name}",
                    category="congestion",
                    kind="long_wait",
                    wait_min_days=float(port["avg_wait_days_min"]),
                    wait_max_days=float(port["avg_wait_days_max"]),
                    severity="high" if wait >= 1.5 * t.wait_days else "medium",
                    port=name,
                    title=f"Long waits at {name}",
                    message=f"Vessels typically wait {port['avg_wait_days_min']:g}–{port['avg_wait_days_max']:g} days for a berth.",
                    value=round(wait, 1),
                    threshold=t.wait_days,
                    unit="days",
                )
            )
        act = activity.get(name)
        if act and act["pct_vs_normal"] >= t.activity_surge_pct:
            alerts.append(
                _alert(
                    id=f"activity-{name}",
                    category="congestion",
                    kind="busy",
                    recent_calls_per_day=act["recent_calls_per_day"],
                    baseline_calls_per_day=act["baseline_calls_per_day"],
                    severity="high" if act["pct_vs_normal"] >= 1.5 * t.activity_surge_pct else "medium",
                    port=name,
                    title=f"Busier than usual at {name}",
                    message=(
                        f"{act['recent_calls_per_day']:.2f} dry-bulk calls a day over the last {t.activity_recent_days} days, "
                        f"{act['pct_vs_normal']:.0f}% above the previous year's {act['baseline_calls_per_day']:.2f}."
                    ),
                    value=act["pct_vs_normal"],
                    threshold=t.activity_surge_pct,
                    unit="%",
                    date=act["as_of"],
                )
            )
    return alerts


def origin_congestion_alerts(origin_activity: dict[str, dict | None], t: AlertThresholds) -> list[dict]:
    """Loading ports busier than usual: queues there delay the voyage before it starts."""
    alerts = []
    for name, act in origin_activity.items():
        if act and act["pct_vs_normal"] >= t.activity_surge_pct:
            alerts.append(
                _alert(
                    id=f"activity-load-{name}",
                    category="congestion",
                    kind="busy",
                    scope="load",
                    severity="high" if act["pct_vs_normal"] >= 1.5 * t.activity_surge_pct else "medium",
                    port=name,
                    title=f"Busier than usual at {name} (loading)",
                    message=(
                        f"{act['recent_calls_per_day']:.2f} dry-bulk calls a day over the last {t.activity_recent_days} days, "
                        f"{act['pct_vs_normal']:.0f}% above the previous year's {act['baseline_calls_per_day']:.2f}."
                    ),
                    value=act["pct_vs_normal"],
                    threshold=t.activity_surge_pct,
                    unit="%",
                    date=act["as_of"],
                    recent_calls_per_day=act["recent_calls_per_day"],
                    baseline_calls_per_day=act["baseline_calls_per_day"],
                )
            )
    return alerts


def market_alerts(forecasts: dict[str, dict], t: AlertThresholds) -> list[dict]:
    """forecasts: {vessel_class: {current_rate, point, lower, upper, dates}}"""
    alerts = []
    for cls, f in forecasts.items():
        current = float(f["current_rate"])
        point = np.asarray(f["point"], dtype=float)
        lower = np.maximum(np.asarray(f["lower"], dtype=float), 0)
        upper = np.asarray(f["upper"], dtype=float)
        weeks = len(point)
        band = (upper[-1] - lower[-1]) / current * 100
        if band >= t.forecast_band_pct:
            alerts.append(
                _alert(
                    id=f"band-{cls}",
                    category="market",
                    kind="rate_range",
                    days_total=weeks,
                    severity="high" if band >= 1.5 * t.forecast_band_pct else "medium",
                    vessel_class=cls,
                    title=f"{cls} rates uncertain",
                    message=f"The likely range in {weeks} weeks spans {band:.0f}% of today's rate.",
                    value=round(float(band), 1),
                    threshold=t.forecast_band_pct,
                    unit="%",
                    date=f["dates"][-1],
                )
            )
        moves = (point - current) / current * 100
        i = int(np.argmax(np.abs(moves)))
        if abs(moves[i]) >= t.forecast_move_pct:
            direction = "rise" if moves[i] > 0 else "fall"
            alerts.append(
                _alert(
                    id=f"move-{cls}",
                    category="market",
                    kind="rate_move",
                    direction="up" if moves[i] > 0 else "down",
                    severity="high" if abs(moves[i]) >= 1.5 * t.forecast_move_pct else "medium",
                    vessel_class=cls,
                    title=f"{cls} rates expected to {direction}",
                    message=f"Forecast to {direction} {abs(moves[i]):.0f}% by the week of {_day(f['dates'][i])}.",
                    value=round(float(moves[i]), 1),
                    threshold=t.forecast_move_pct,
                    unit="%",
                    date=f["dates"][i],
                )
            )
    return alerts


def notice_alerts(notices: pd.DataFrame, today: pd.Timestamp, ports: list[str] | None = None, lookahead_days: int = 14) -> list[dict]:
    """Hand-kept disruption notices in force today or starting within two weeks."""
    alerts = []
    horizon = today + pd.Timedelta(days=lookahead_days)
    for i, n in notices.iterrows():
        if ports and n["port"] not in ports:
            continue
        start, end = n["start_date"], n["end_date"] if pd.notna(n["end_date"]) else pd.Timestamp.max
        if start > horizon or end < today:
            continue
        alerts.append(
            _alert(
                id=f"notice-{i}-{n['port']}",
                category="disruption",
                kind="notice",
                severity=n["severity"] if n["severity"] in ("high", "medium", "info") else "medium",
                port=n["port"],
                title=str(n["title"]),
                message=str(n["title"]),
                value=None,
                threshold=None,
                date=start.strftime("%Y-%m-%d"),
                peak_date=None if end == pd.Timestamp.max else end.strftime("%Y-%m-%d"),
            )
        )
    return alerts


SEVERITY_ORDER = {"high": 0, "medium": 1, "info": 2}


def sort_alerts(alerts: list[dict]) -> list[dict]:
    return sorted(alerts, key=lambda a: (SEVERITY_ORDER.get(a["severity"], 3), a["category"], a["id"]))
