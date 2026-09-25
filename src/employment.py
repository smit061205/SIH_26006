"""Keeping an idle ship earning: what a time-chartered ship can do with a spell
it isn't needed (the plant has stock, the port is closed, the next cargo
isn't due), instead of waiting on hire.

The window starts when the ship finishes discharging on India's east coast
and ends when it must be back at the load port for the next cargo: the direct
ballast passage plus the idle days. Three ways to use it, each costed over
that window (hire keeps running in all of them):

- **Wait:** hire for the whole window, fuel at sea for the ballast passage and
  in port while idle.
- **Sublet:** relet the ship for the idle days at the market time-charter rate
  (less address and brokerage commission); the sub-charterer pays its fuel.
- **Backhaul voyage:** load a cargo on the east coast (iron ore or pellets to
  China, the main backhaul there), deliver it, and ballast from China to the
  load port. Freight earned, less fuel and port costs. If it takes longer than
  the window, the extra days are hire too and the ship is late for the next
  cargo - flagged.

All money is USD; lower net cost is better (negative means it earns more than
it costs).
"""
from dataclasses import dataclass

import pandas as pd

from src.row_utils import opt_float


@dataclass
class Window:
    idle_days: float
    ballast_days: float  # discharge port straight back to the load port


def _fuel(vessel_row: pd.Series) -> tuple[float, float]:
    return (opt_float(vessel_row, "fuel_sea_t_per_day") or 0.0, opt_float(vessel_row, "fuel_port_t_per_day") or 0.0)


def employment_options(
    vessel_row: pd.Series,
    payload_tonnes: float,
    window: Window,
    hire_rate: float,
    market_rate: float,
    bunker_price: float,
    commission_pct: float,
    backhaul: pd.Series | None,
    backhaul_laden_nm: float | None,
    backhaul_ballast_nm: float | None,
    speed_knots: float,
) -> dict:
    fuel_sea, fuel_port = _fuel(vessel_row)
    window_days = window.idle_days + window.ballast_days

    wait_cost = hire_rate * window_days + bunker_price * (fuel_sea * window.ballast_days + fuel_port * window.idle_days)
    options = [
        {
            "option": "wait",
            "days": round(window_days, 1),
            "net_cost_usd": round(wait_cost, 0),
            "revenue_usd": 0.0,
            "late_days": 0.0,
            "detail": {"hire_usd": round(hire_rate * window_days, 0), "bunkers_usd": round(wait_cost - hire_rate * window_days, 0)},
        }
    ]

    relet_income = market_rate * window.idle_days * (1 - commission_pct / 100)
    sublet_cost = hire_rate * window_days + bunker_price * fuel_sea * window.ballast_days - relet_income
    options.append(
        {
            "option": "sublet",
            "days": round(window_days, 1),
            "net_cost_usd": round(sublet_cost, 0),
            "revenue_usd": round(relet_income, 0),
            "late_days": 0.0,
            "detail": {
                "market_rate_usd_per_day": round(market_rate, 0),
                "hire_rate_usd_per_day": round(hire_rate, 0),
                "commission_pct": commission_pct,
            },
        }
    )

    if backhaul is not None and backhaul_laden_nm and backhaul_ballast_nm:
        day_nm = speed_knots * 24
        laden_days = backhaul_laden_nm / day_nm
        ballast_days = backhaul_ballast_nm / day_nm
        load_days = payload_tonnes / float(backhaul["load_rate_tpd"]) + 1  # + a day to shift and clear
        discharge_days = payload_tonnes / float(backhaul["discharge_rate_tpd"]) + 1
        total = load_days + laden_days + discharge_days + ballast_days
        revenue = float(backhaul["freight_usd_per_tonne"]) * payload_tonnes
        bunkers = bunker_price * (fuel_sea * (laden_days + ballast_days) + fuel_port * (load_days + discharge_days))
        port_costs = 2 * float(backhaul["port_costs_usd_per_call"])
        cost = hire_rate * max(total, window_days) + bunkers + port_costs - revenue
        options.append(
            {
                "option": "backhaul",
                "days": round(total, 1),
                "net_cost_usd": round(cost, 0),
                "revenue_usd": round(revenue, 0),
                "late_days": round(max(0.0, total - window_days), 1),
                "detail": {
                    "cargo": str(backhaul["cargo"]),
                    "to_port": str(backhaul["to_port"]),
                    "freight_usd_per_tonne": float(backhaul["freight_usd_per_tonne"]),
                    "tonnes": round(payload_tonnes, 0),
                    "laden_days": round(laden_days, 1),
                    "ballast_days": round(ballast_days, 1),
                    "port_days": round(load_days + discharge_days, 1),
                    "bunkers_usd": round(bunkers, 0),
                    "port_costs_usd": round(port_costs, 0),
                },
            }
        )

    for o in options:
        o["saving_vs_wait_usd"] = round(wait_cost - o["net_cost_usd"], 0)
    # The best option that doesn't make the ship late for the next cargo.
    on_time = [o for o in options if o["late_days"] <= 0]
    best = min(on_time, key=lambda o: o["net_cost_usd"])["option"]
    return {"window_days": round(window_days, 1), "options": options, "best": best}


def low_demand_periods(
    stock_cover: dict | None,
    port_monsoon_months: list[int],
    port_closed_in_monsoon: bool,
    forecast: list[dict],
    hire_rate: float,
    premium: float,
    start_month: int,
    months_ahead: int = 12,
) -> dict:
    """When a chartered ship is likely to be spare, and when the market pays
    well for it:
    - plant stock above its buffer: the next cargo can wait that many days;
    - monsoon months at the discharge port in the coming year (closed or slowed);
    - weeks when the forecast market rate is at least 5% above the hire paid -
      the best time to sublet."""
    spare_days = None
    if stock_cover and stock_cover.get("days_of_cover") is not None:
        spare_days = round(max(0.0, float(stock_cover["days_of_cover"]) - float(stock_cover["buffer_days_target"])), 1)
    months = [(start_month - 1 + i) % 12 + 1 for i in range(months_ahead)]
    monsoon = [m for m in months if m in set(port_monsoon_months)]
    strong = [
        {"date": f["date"], "rate_usd_per_day": round(f["forecast"] * premium, 0)}
        for f in forecast
        if f["forecast"] * premium >= hire_rate * 1.05
    ]
    return {
        "stock_spare_days": spare_days,
        "monsoon_months": monsoon,
        "port_closed_in_monsoon": port_closed_in_monsoon,
        "strong_market_weeks": strong,
    }
