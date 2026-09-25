"""Freight by trade route: what it costs per tonne to move coking coal from one
load port to one discharge port on a given vessel type, and how that is
expected to move over the coming weeks.

The per-tonne sea freight of a route is its time-charter hire for the days the
voyage takes (sea, loading-port queue, loading, berth queue, discharging),
plus bunkers and port costs, over the tonnes carried:

    freight $/t = (hire rate x hire days + bunkers + port costs) / tonnes

Only the hire rate moves week to week in the forecast; the route's days,
bunkers and port costs are taken from today's costing of that route. Rail and
plant handling are left out: this is the sea freight, route against route.
"""
import pandas as pd


def route_terms(row: pd.Series | dict) -> dict:
    """The parts of a costed route (a rank_options row) that don't move with the hire rate."""
    rate = float(row["hire_rate_usd_per_day"])
    hire_days = (float(row["hire_cost_usd"]) + float(row["waiting_hire_usd"])) / rate if rate > 0 else 0.0
    fixed = float(row["bunker_cost_usd"]) + float(row["port_charges_usd"]) + float(row["transshipment_cost_usd"])
    return {
        "hire_days": hire_days,
        "fixed_usd": fixed,
        "tonnes": float(row.get("cargo_shipped_tonnes") or 0) or float(row["payload_tonnes"]) * int(row["n_voyages"]),
        "rate_today": rate,
    }


def freight_per_tonne(terms: dict, rate_usd_per_day: float) -> float:
    return (rate_usd_per_day * terms["hire_days"] + terms["fixed_usd"]) / terms["tonnes"]


def route_outlook(terms: dict, forecast: list[dict], premium: float, current_rate: float, weeks=(4, 12, 26)) -> dict:
    """Freight $/t now and at future weeks, from the class's forecast rate
    (series rate x premium), with the 80% range at each week."""
    now = freight_per_tonne(terms, current_rate * premium)
    out = {"now": round(now, 2)}
    for w in weeks:
        if w - 1 < len(forecast):
            f = forecast[w - 1]
            out[f"week_{w}"] = {
                "point": round(freight_per_tonne(terms, f["forecast"] * premium), 2),
                "lower": round(freight_per_tonne(terms, f["lower"] * premium), 2),
                "upper": round(freight_per_tonne(terms, f["upper"] * premium), 2),
            }
    return out


def route_series(terms: dict, history: list[dict], forecast: list[dict], premium: float) -> dict:
    """Weekly freight $/t: past weeks at the rates then, future weeks at the forecast."""
    return {
        "history": [{"date": h["date"], "usd_per_tonne": round(freight_per_tonne(terms, h["actual"] * premium), 2)} for h in history],
        "forecast": [
            {
                "date": f["date"],
                "usd_per_tonne": round(freight_per_tonne(terms, f["forecast"] * premium), 2),
                "lower": round(freight_per_tonne(terms, f["lower"] * premium), 2),
                "upper": round(freight_per_tonne(terms, f["upper"] * premium), 2),
            }
            for f in forecast
        ],
    }
