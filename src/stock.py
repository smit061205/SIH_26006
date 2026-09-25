"""Plant coking-coal stock cover: how many days each plant can run on what it
holds, against its buffer target, and whether a cargo arrives in time."""
import pandas as pd

DAYS_PER_MONTH = 30


def _cover_row(plant: pd.Series) -> dict:
    demand = float(plant["monthly_coking_coal_demand_tonnes"])
    inventory = float(plant["current_inventory_tonnes"])
    buffer_days = float(plant["buffer_days_target"])
    daily = demand / DAYS_PER_MONTH if demand > 0 else 0.0
    cover = round(inventory / daily, 1) if daily > 0 else None
    if cover is None:
        status = "ok"
    elif cover < buffer_days / 2:
        status = "critical"
    elif cover < buffer_days:
        status = "below_buffer"
    else:
        status = "ok"
    return {
        "name": plant["name"],
        "monthly_demand_tonnes": demand,
        "current_inventory_tonnes": inventory,
        "daily_consumption_tonnes": round(daily, 1),
        "days_of_cover": cover,
        "buffer_days_target": buffer_days,
        "cover_gap_days": None if cover is None else round(cover - buffer_days, 1),
        "status": status,
        "tonnes_to_buffer": max(0.0, round(buffer_days * daily - inventory, 0)),
    }


def plant_stock_cover(plants_df: pd.DataFrame) -> list[dict]:
    return [_cover_row(p) for _, p in plants_df.iterrows()]


def cover_for_plant(plants_df: pd.DataFrame, plant_name: str) -> dict | None:
    match = plants_df[plants_df["name"] == plant_name]
    return None if match.empty else _cover_row(match.iloc[0])


def cover_vs_lead_time(cover: dict, lead_days: float, days_until_laycan: int = 0) -> dict:
    """When the first cargo reaches the plant (the laycan opens in
    `days_until_laycan` days, then `lead_days` to the plant), whether the plant
    runs out before then, and how many days are left to fix a cargo that would
    arrive in time."""
    days = cover["days_of_cover"]
    arrival = max(0, days_until_laycan) + lead_days
    return {
        "arrival_in_days": round(arrival, 1),
        "lead_days": round(lead_days, 1),
        "days_until_laycan": max(0, days_until_laycan),
        "stockout_before_arrival": days is not None and days < arrival,
        "days_short": None if days is None else round(max(0.0, arrival - days), 1),
        "days_to_fix": None if days is None else round(days - lead_days, 1),
    }
