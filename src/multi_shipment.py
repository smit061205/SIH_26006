"""Stage 5b: multi-shipment planning with OR-Tools CP-SAT.

Single-shipment ranking (src/rank.py) picks the cheapest feasible option
independently for one cargo requirement. That's fine for one shipment, but
SAIL books many shipments across a quarter, and if every shipment
independently picks the same "cheapest" port, real port berth capacity
gets blown past - which the independent-argmin approach has no way to see
or prevent. This module makes that trade-off explicit: it jointly assigns
all shipments in a planning window to (vessel_class, port) options,
minimizing total cost subject to a per-port-per-month capacity cap.

The capacity cap value itself is illustrative (this project has no
verified real berth-slot-per-month figure for these ports), so the point
being demonstrated is the OPTIMIZATION APPROACH - constrained joint
assignment beats naive per-shipment argmin - not the specific cap number.
"""
from dataclasses import dataclass, field

import pandas as pd
from ortools.sat.python import cp_model

from src.rank import rank_options


@dataclass
class Shipment:
    shipment_id: str
    cargo_tonnes: float
    month: int
    origin: str
    plant_name: str


@dataclass
class PlanResult:
    assignments: pd.DataFrame
    total_cost_usd: float
    naive_total_cost_usd: float
    naive_capacity_violations: pd.DataFrame
    solver_status: str
    unplanned: list[str] = field(default_factory=list)


def _feasible_options_per_shipment(
    shipments: list[Shipment], ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions
) -> dict[str, pd.DataFrame]:
    options = {}
    seen: dict[tuple, pd.DataFrame] = {}
    for s in shipments:
        key = (s.cargo_tonnes, s.month, s.origin, s.plant_name)
        if key not in seen:
            seen[key] = rank_options(
                s.cargo_tonnes, s.month, s.origin, s.plant_name, ports_df, vessels_df, rail_df, origin_transit_df,
                cost_assumptions,
            )
        options[s.shipment_id] = seen[key]
    return options


def plan_shipments(
    shipments: list[Shipment],
    ports_df: pd.DataFrame,
    vessels_df: pd.DataFrame,
    rail_df: pd.DataFrame,
    origin_transit_df: pd.DataFrame,
    cost_assumptions: dict,
    max_calls_per_port_month: int | dict[str, int] = 2,
) -> PlanResult:
    """max_calls_per_port_month: one cap for every port, or a cap per port
    (ports missing from the dict get the smallest cap given)."""
    if isinstance(max_calls_per_port_month, dict):
        caps = max_calls_per_port_month
        default_cap = min(caps.values()) if caps else 2
    else:
        caps, default_cap = {}, max_calls_per_port_month

    def cap_for(port: str) -> int:
        return caps.get(port, default_cap)

    options = _feasible_options_per_shipment(shipments, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)

    # --- naive baseline: each shipment independently picks its own cheapest option ---
    naive_rows = []
    port_month_counts: dict[tuple, int] = {}
    for s in shipments:
        opts = options[s.shipment_id]
        if opts.empty:
            continue
        cheapest = opts.iloc[0]
        naive_rows.append(
            {
                "shipment_id": s.shipment_id,
                "port": cheapest["port"],
                "vessel_class": cheapest["vessel_class"],
                "month": s.month,
                "total_usd": cheapest["total_usd"],
            }
        )
        key = (cheapest["port"], s.month)
        # A shipment split into several voyages makes several port calls.
        port_month_counts[key] = port_month_counts.get(key, 0) + int(cheapest["n_voyages"])

    naive_total_cost = sum(r["total_usd"] for r in naive_rows)
    violations = [
        {"port": p, "month": m, "calls_assigned": c, "cap": cap_for(p)}
        for (p, m), c in port_month_counts.items()
        if c > cap_for(p)
    ]

    # --- CP-SAT joint optimization, respecting the capacity cap ---
    model = cp_model.CpModel()
    x = {}  # (shipment_id, option_index) -> BoolVar
    for s in shipments:
        opts = options[s.shipment_id]
        if opts.empty:
            continue
        for j in range(len(opts)):
            x[(s.shipment_id, j)] = model.NewBoolVar(f"x_{s.shipment_id}_{j}")
        model.Add(sum(x[(s.shipment_id, j)] for j in range(len(opts))) == 1)

    # capacity constraint per (port, month)
    port_months = {(p, s.month) for s in shipments for p in options[s.shipment_id]["port"].unique()}
    for port, month in port_months:
        terms = []
        for s in shipments:
            if s.month != month:
                continue
            opts = options[s.shipment_id]
            for j, row in opts.iterrows():
                if row["port"] == port and (s.shipment_id, j) in x:
                    terms.append(int(row["n_voyages"]) * x[(s.shipment_id, j)])
        if terms:
            model.Add(sum(terms) <= cap_for(port))

    objective_terms = []
    for s in shipments:
        opts = options[s.shipment_id]
        for j, row in opts.iterrows():
            if (s.shipment_id, j) in x:
                objective_terms.append(int(round(row["total_usd"])) * x[(s.shipment_id, j)])
    model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    assignment_rows = []
    total_cost = 0.0
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for s in shipments:
            opts = options[s.shipment_id]
            for j, row in opts.iterrows():
                if (s.shipment_id, j) in x and solver.Value(x[(s.shipment_id, j)]) == 1:
                    assignment_rows.append(
                        {
                            "shipment_id": s.shipment_id,
                            "port": row["port"],
                            "vessel_class": row["vessel_class"],
                            "month": s.month,
                            "n_voyages": int(row["n_voyages"]),
                            "usd_per_tonne": row["usd_per_tonne"],
                            "total_usd": row["total_usd"],
                        }
                    )
                    total_cost += row["total_usd"]

    return PlanResult(
        assignments=pd.DataFrame(assignment_rows),
        total_cost_usd=round(total_cost, 2),
        naive_total_cost_usd=round(naive_total_cost, 2),
        naive_capacity_violations=pd.DataFrame(violations),
        solver_status=status_name,
        unplanned=[s.shipment_id for s in shipments if options[s.shipment_id].empty],
    )
