"""Month-by-month plan for a multi-voyage contract.

A period contract fixes the vessel class, while the discharge port can change
voyage to voyage (monsoon drafts, for instance). So the plan ranks every
month, keeps one class that works in all of them, and reports what that
commitment costs against picking the cheapest option freely each month.
"""
import pandas as pd

from src.feasibility import monsoon_months
from src.rank import rank_options

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def contract_months(start_month: int, duration_months: int) -> list[int]:
    return [(start_month - 1 + i) % 12 + 1 for i in range(duration_months)]


def build_contract_schedule(
    monthly_cargo_tonnes: float,
    start_month: int,
    duration_months: int,
    origin: str,
    plant_name: str,
    ports_df: pd.DataFrame,
    vessels_df: pd.DataFrame,
    rail_df: pd.DataFrame,
    origin_transit_df: pd.DataFrame,
    cost_assumptions: dict,
    vessel_class: str | None = None,
    tariff_df: pd.DataFrame | None = None,
    spot_rates_by_month: list[dict[str, float]] | None = None,
    tolerance_pct: float = 0.0,
    port: str | None = None,
) -> dict:
    """spot_rates_by_month: the forecast market rate per series class for each
    contract month (month 0 = now). A period time charter fixes today's rate
    for every month; each month also shows what the same voyages would cost
    on the spot market at that month's forecast rate."""
    months = contract_months(start_month, duration_months)
    ranked_by_month = {
        m: rank_options(
            monthly_cargo_tonnes, m, origin, plant_name, ports_df, vessels_df, rail_df, origin_transit_df,
            cost_assumptions, tariff_df=tariff_df, tolerance_pct=tolerance_pct, port=port,
        )
        for m in months
    }
    premium = {
        r["vessel_class"]: (r["freight_index_class"], float(r["series_premium"]) if pd.notna(r.get("series_premium")) else 1.0)
        for _, r in vessels_df.iterrows()
    }

    def spot_total(pick: pd.Series, index: int) -> float | None:
        """The month's voyages at the forecast spot rate instead of today's."""
        if not spot_rates_by_month or index >= len(spot_rates_by_month):
            return None
        series, factor = premium[pick["vessel_class"]]
        forecast = spot_rates_by_month[index].get(series)
        rate = float(pick["hire_rate_usd_per_day"])
        if forecast is None or rate <= 0:
            return None
        hire_days = (float(pick["hire_cost_usd"]) + float(pick["waiting_hire_usd"])) / rate
        return round(float(pick["total_usd"]) + (forecast * factor - rate) * hire_days, 2)

    classes = []
    for cls in vessels_df["vessel_class"]:
        per_month = [ranked_by_month[m][ranked_by_month[m]["vessel_class"] == cls] for m in months]
        feasible = sum(1 for df in per_month if not df.empty)
        total = sum(float(df.iloc[0]["total_usd"]) for df in per_month) if feasible == len(months) else None
        classes.append({"vessel_class": cls, "months_feasible": feasible, "total_usd": total})

    workable = [c for c in classes if c["total_usd"] is not None]
    chosen = None
    note = None
    if vessel_class and any(c["vessel_class"] == vessel_class for c in workable):
        chosen = vessel_class
    elif workable:
        chosen = min(workable, key=lambda c: c["total_usd"])["vessel_class"]
        if vessel_class:
            note = f"A {vessel_class} can't take every month of this contract, so the plan uses a {chosen}."
    else:
        note = "No single vessel class fits every month of this contract."

    port_rows = {p["name"]: p for _, p in ports_df.iterrows()}
    rows = []
    previous_port = None
    for index, m in enumerate(months):
        ranked = ranked_by_month[m]
        free = ranked.iloc[0] if not ranked.empty else None
        pick = ranked[ranked["vessel_class"] == chosen].iloc[0] if chosen and not ranked.empty else free
        if pick is None:
            rows.append({"month": m, "month_label": MONTH_NAMES[m - 1], "port": None, "note": "No option fits this month."})
            continue
        port_name = pick["port"]
        monsoon = m in monsoon_months(port_rows[port_name])
        notes = []
        if previous_port and port_name != previous_port:
            notes.append(f"Port changes from {previous_port}")
        if monsoon:
            notes.append("Monsoon month at this port")
        rows.append(
            {
                "month": m,
                "month_label": MONTH_NAMES[m - 1],
                "port": port_name,
                "vessel_class": pick["vessel_class"],
                "n_voyages": int(pick["n_voyages"]),
                "usd_per_tonne": float(pick["usd_per_tonne"]),
                "total_usd": float(pick["total_usd"]),
                "spot_total_usd": spot_total(pick, index),
                "expected_wait_days": float(pick["expected_wait_days"]),
                "monsoon": monsoon,
                "unconstrained_best": None
                if free is None
                else {
                    "port": free["port"],
                    "vessel_class": free["vessel_class"],
                    "usd_per_tonne": float(free["usd_per_tonne"]),
                    "total_usd": float(free["total_usd"]),
                },
                "note": "; ".join(notes) or None,
            }
        )
        previous_port = port_name

    planned = [r for r in rows if r.get("port")]
    contract_total = sum(r["total_usd"] for r in planned)
    free_total = sum(r["unconstrained_best"]["total_usd"] for r in planned if r["unconstrained_best"])
    spot_values = [r["spot_total_usd"] for r in planned]
    spot_total_all = round(sum(spot_values), 2) if spot_values and all(v is not None for v in spot_values) else None
    return {
        "contract_vessel_class": chosen,
        "months": rows,
        "totals": {
            "contract_total_usd": round(contract_total, 2),
            "unconstrained_total_usd": round(free_total, 2),
            "flexibility_cost_usd": round(contract_total - free_total, 2),
            # The same voyages fixed month by month on the spot market, at the forecast rates.
            "spot_total_usd": spot_total_all,
            "voyages": sum(r["n_voyages"] for r in planned),
            "cargo_tonnes": monthly_cargo_tonnes * len(planned),
        },
        "classes_considered": classes,
        "note": note,
    }
