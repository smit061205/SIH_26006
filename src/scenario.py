"""Stage 5a: scenario simulation.

Two kinds of scenario:
1. Operational what-ifs on a single shipment (wait N days, exclude a port)
   - reuses the Stage 2/3 feasibility+cost engine, just re-runs it under
     a changed assumption.
2. The spot-vs-contract-vs-hybrid split - the one piece that actually
   converts Layer 2's forecast into an action, closing the gap the
   project spec calls "PREDICTION -> DECISION CONVERSION". This is a
   simple, explainable rule (not a black-box optimizer): it reads the
   forecast's expected % change and uncertainty band, and moves the
   recommended contract share up or down from a 50% baseline accordingly,
   clipped to [20%, 80%] because no real procurement desk would go 100%
   either way. Every number in the recommendation is shown, not hidden.
"""
from dataclasses import dataclass

import pandas as pd

from src.cost_engine import compute_landed_cost
from src.feasibility import check_feasibility, seasonal_weather_days
from src.rank import origin_row_for, rail_row_for, rank_options
from src.row_utils import opt_str


def simulate_wait_scenarios(
    cargo_tonnes: float,
    month: int,
    origin: str,
    plant_name: str,
    ports_df: pd.DataFrame,
    vessels_df: pd.DataFrame,
    rail_df: pd.DataFrame,
    origin_transit_df: pd.DataFrame,
    cost_assumptions: dict,
    wait_days_options: tuple = (0, 3, 7, 14),
) -> pd.DataFrame:
    """For the current #1 (vessel, port) recommendation, shows how landed
    cost changes if the vessel waits a different number of days than the
    port's average - i.e. "book now vs wait" made concrete in dollars."""
    baseline = rank_options(
        cargo_tonnes, month, origin, plant_name, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions
    )
    if baseline.empty:
        return baseline

    top = baseline.iloc[0]
    vessel_row = vessels_df[vessels_df["vessel_class"] == top["vessel_class"]].iloc[0]
    port_row = ports_df[ports_df["name"] == top["port"]].iloc[0]
    rail_row = rail_row_for(port_row, plant_name, rail_df)
    origin_row = origin_row_for(origin, origin_transit_df)
    transit_days = float(top["transit_days"])
    draft_limit = check_feasibility(vessel_row, port_row, month, origin_row).draft_limit_m

    rows = []
    for wait_days in wait_days_options:
        cost = compute_landed_cost(
            vessel_row=vessel_row,
            port_row=port_row,
            rail_row=rail_row,
            cost_assumptions=cost_assumptions,
            cargo_tonnes=cargo_tonnes,
            transit_days=transit_days,
            wait_days_override=wait_days,
            origin_row=origin_row,
            draft_limit_m=draft_limit,
            weather_days=seasonal_weather_days(port_row, month),
        )
        rows.append(
            {
                "wait_days": wait_days,
                "usd_per_tonne": cost.usd_per_tonne,
                "total_usd": cost.total_usd,
                "waiting_hire_usd": cost.waiting_hire_usd,
                "n_voyages": cost.n_voyages,
            }
        )
    return pd.DataFrame(rows)


def simulate_port_exclusion(
    cargo_tonnes: float,
    month: int,
    origin: str,
    plant_name: str,
    excluded_port: str,
    ports_df: pd.DataFrame,
    vessels_df: pd.DataFrame,
    rail_df: pd.DataFrame,
    origin_transit_df: pd.DataFrame,
    cost_assumptions: dict,
) -> pd.DataFrame:
    """'What if the top-recommended port is suddenly congested / closed' -
    reruns the ranking with one port removed from consideration. An
    anchorage that transships into the closed port goes with it."""
    via = ports_df.apply(lambda p: opt_str(p, "rail_via_port"), axis=1)
    remaining_ports = ports_df[(ports_df["name"] != excluded_port) & (via != excluded_port)]
    return rank_options(
        cargo_tonnes, month, origin, plant_name, remaining_ports, vessels_df, rail_df, origin_transit_df, cost_assumptions
    )


def _weather_delay_days(weather: dict | None, port: str, wave_threshold_m: float) -> int:
    """Days in the live sea-state forecast when waves reach the threshold,
    counted as days the ship can't work cargo."""
    w = (weather or {}).get(port)
    if not isinstance(w, dict) or w.get("error"):
        return 0
    return sum(1 for h in (w.get("wave_height_max_m") or []) if h is not None and h >= wave_threshold_m)


def idle_time_analysis(
    cargo_tonnes: float,
    month: int,
    origin: str,
    plant_name: str,
    ports_df: pd.DataFrame,
    vessels_df: pd.DataFrame,
    rail_df: pd.DataFrame,
    origin_transit_df: pd.DataFrame,
    cost_assumptions: dict,
    port: str | None = None,
    vessel_class: str | None = None,
    weather: dict | None = None,
    wave_threshold_m: float = 2.5,
) -> dict | None:
    """Expected idle days (berth queue plus rough-sea days) and their cost for
    one option, and the options that cut them: another port, a later month,
    or another vessel class."""
    ranked = rank_options(
        cargo_tonnes, month, origin, plant_name, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions
    )
    if ranked.empty:
        return None
    match = ranked
    if port:
        match = match[match["port"] == port]
    if vessel_class:
        match = match[match["vessel_class"] == vessel_class]
    base = match.iloc[0] if (port or vessel_class) and not match.empty else ranked.iloc[0]
    origin_row = origin_row_for(origin, origin_transit_df)

    def port_row_of(row: pd.Series) -> pd.Series:
        return ports_df[ports_df["name"] == row["port"]].iloc[0]

    def idle_cost(row: pd.Series, idle_days: float) -> float:
        """Hire paid while idle (time charter), plus any berth charges that
        accrue with time, for every voyage of the option."""
        vessel_row = vessels_df[vessels_df["vessel_class"] == row["vessel_class"]].iloc[0]
        port_row = port_row_of(row)
        common = dict(
            vessel_row=vessel_row, port_row=port_row, rail_row=rail_row_for(port_row, plant_name, rail_df),
            cost_assumptions=cost_assumptions, cargo_tonnes=cargo_tonnes, transit_days=float(row["transit_days"]),
            origin_row=origin_row, n_voyages=int(row["n_voyages"]),
        )
        waiting = compute_landed_cost(wait_days_override=idle_days, **common).total_usd
        no_wait = compute_landed_cost(wait_days_override=0, **common).total_usd
        return waiting - no_wait

    def weather_days_for(row: pd.Series, month_used: int) -> tuple[float, str]:
        """Rough-sea days from the live forecast when the ship would arrive
        inside it; otherwise the port's typical monsoon-month loss."""
        forecast_days = len(((weather or {}).get(row["port"]) or {}).get("wave_height_max_m") or [])
        arrival_days = float(row["load_days"]) + float(row["transit_days"])
        if month_used == month and forecast_days and arrival_days <= forecast_days:
            return float(_weather_delay_days(weather, row["port"], wave_threshold_m)), "forecast"
        return seasonal_weather_days(port_row_of(row), month_used), "seasonal"

    def describe(row: pd.Series, option_type: str, description: str, month_used: int) -> dict:
        idle = float(row["expected_wait_days"]) + weather_days_for(row, month_used)[0]
        return {
            "option_type": option_type,
            "description": description,
            "port": row["port"],
            "vessel_class": row["vessel_class"],
            "month": month_used,
            "n_voyages": int(row["n_voyages"]),
            "expected_idle_days": round(idle, 1),
            "idle_cost_usd": round(idle_cost(row, idle), 2),
            "usd_per_tonne": float(row["usd_per_tonne"]),
            "total_usd": float(row["total_usd"]),
        }

    baseline = describe(base, "current", "Current option", month)
    baseline["weather_delay_days"], baseline["weather_basis"] = weather_days_for(base, month)
    baseline["expected_wait_days"] = float(base["expected_wait_days"])
    baseline["idle_cost_usd_per_tonne"] = round(baseline["idle_cost_usd"] / cargo_tonnes, 4)

    alternatives = []
    for _, row in ranked[(ranked["vessel_class"] == base["vessel_class"]) & (ranked["port"] != base["port"])].iterrows():
        alternatives.append(describe(row, "port", f"Discharge at {row['port']} instead", month))
    for _, row in ranked[ranked["vessel_class"] != base["vessel_class"]].drop_duplicates("vessel_class").iterrows():
        alternatives.append(describe(row, "vessel_class", f"Use a {row['vessel_class']} ({row['port']})", month))
    for shift in (1, 2):
        later = (month - 1 + shift) % 12 + 1
        later_ranked = rank_options(
            cargo_tonnes, later, origin, plant_name, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions
        )
        same = later_ranked[(later_ranked["port"] == base["port"]) & (later_ranked["vessel_class"] == base["vessel_class"])]
        if not same.empty:
            alternatives.append(describe(same.iloc[0], "month", f"Arrive {shift} month{'s' if shift > 1 else ''} later", later))

    for alt in alternatives:
        alt["idle_days_saved"] = round(baseline["expected_idle_days"] - alt["expected_idle_days"], 1)
        alt["delta_vs_baseline_usd"] = round(alt["total_usd"] - baseline["total_usd"], 2)
    # Only options that actually cut idle time or cost less are worth showing.
    useful = [a for a in alternatives if a["idle_days_saved"] > 0 or a["delta_vs_baseline_usd"] < 0]
    useful.sort(key=lambda a: (-a["idle_days_saved"], a["delta_vs_baseline_usd"]))
    return {"baseline": baseline, "alternatives": useful}


@dataclass
class ContractSplitRecommendation:
    contract_pct: float
    spot_pct: float
    expected_change_pct: float
    band_width_pct: float
    reasoning: str
    cost_comparison: pd.DataFrame


def recommend_contract_split(
    cargo_tonnes: float,
    current_rate: float,
    forecast_point: float,
    forecast_lower: float,
    forecast_upper: float,
    transit_plus_wait_days: float = 20.0,
    n_voyages: int = 1,
    contract_rate: float | None = None,
) -> ContractSplitRecommendation:
    """The core Layer 2 decision: how much of `cargo_tonnes` to lock on a
    term contract (at today's rate) vs leave on spot (at the forecast
    rate), for the volume covered by this forecast horizon.

    Rule (explainable, not a black box):
      expected_change_pct = (forecast_point - current_rate) / current_rate
      band_width_pct      = (upper - lower) / current_rate   [uncertainty]

      contract_pct starts at 50% (baseline hybrid) and shifts toward
      contract when rates are expected to RISE (lock in today's lower
      rate) and toward spot when rates are expected to FALL, scaled by
      how confident the forecast is (a wide band pulls the recommendation
      back toward the 50% baseline, since a big uncertain bet is riskier
      than a small one). Clipped to [20%, 80%] - no full commitment either
      way, matching how real procurement desks manage freight-rate risk.

    Costs in `cost_comparison` are whole-voyage hire costs (day-rate x
    hire days) - independent of `cargo_tonnes`, since chartering a vessel
    costs the same per day regardless of how full it is. `cargo_tonnes`
    is used only to derive the per-tonne columns, so this figure is
    comparable to the Stage 2 landed-cost-per-tonne numbers elsewhere.
    """
    if cargo_tonnes <= 0:
        raise ValueError("cargo_tonnes must be positive")
    if current_rate <= 0:
        raise ValueError("current_rate must be positive")

    expected_change_pct = (forecast_point - current_rate) / current_rate
    band_width_pct = (forecast_upper - forecast_lower) / current_rate

    # Confidence shrinks the further apart the band is - a maximally wide
    # band (say >=60% of current rate) zeroes out the tilt entirely.
    confidence = max(0.0, 1 - band_width_pct / 0.6)
    tilt = expected_change_pct * confidence  # e.g. +10% forecast, full confidence -> +10 tilt
    contract_pct = min(80.0, max(20.0, 50.0 + tilt * 100))
    spot_pct = 100.0 - contract_pct

    direction = "rising" if expected_change_pct > 0.02 else "falling" if expected_change_pct < -0.02 else "roughly flat"
    reasoning = (
        f"Forecast expects freight rates {direction} "
        f"({expected_change_pct:+.1%} vs current ${current_rate:,.0f}/day, "
        f"to ${forecast_point:,.0f}/day), with a "
        f"{band_width_pct:.0%}-of-current-rate wide confidence band "
        f"(confidence weight {confidence:.0%}). Recommendation: lock "
        f"{contract_pct:.0f}% on contract at today's rate, leave "
        f"{spot_pct:.0f}% on spot."
    )

    if n_voyages < 1:
        raise ValueError("n_voyages must be at least 1")
    hire_days = transit_plus_wait_days * n_voyages
    all_spot_cost = hire_days * forecast_point  # cost if 100% spot, priced at forecast
    all_contract_cost = hire_days * (contract_rate if contract_rate is not None else current_rate)
    recommended_cost = (contract_pct / 100) * all_contract_cost + (spot_pct / 100) * all_spot_cost

    cost_comparison = pd.DataFrame(
        [
            {
                "strategy": "100% spot (at forecast rate)",
                "contract_pct": 0,
                "estimated_hire_cost_usd": round(all_spot_cost, 0),
                "estimated_hire_cost_usd_per_tonne": round(all_spot_cost / cargo_tonnes, 4),
            },
            {
                "strategy": f"Recommended ({contract_pct:.0f}% contract)",
                "contract_pct": contract_pct,
                "estimated_hire_cost_usd": round(recommended_cost, 0),
                "estimated_hire_cost_usd_per_tonne": round(recommended_cost / cargo_tonnes, 4),
            },
            {
                "strategy": "100% contract (at today's rate)",
                "contract_pct": 100,
                "estimated_hire_cost_usd": round(all_contract_cost, 0),
                "estimated_hire_cost_usd_per_tonne": round(all_contract_cost / cargo_tonnes, 4),
            },
        ]
    )

    return ContractSplitRecommendation(
        contract_pct=round(contract_pct, 1),
        spot_pct=round(spot_pct, 1),
        expected_change_pct=round(expected_change_pct, 4),
        band_width_pct=round(band_width_pct, 4),
        reasoning=reasoning,
        cost_comparison=cost_comparison,
    )
