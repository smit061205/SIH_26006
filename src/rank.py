"""Stage C of the FREIGHTWISE methodology: 'Advise'.

Combines the feasibility filter and cost engine into one ranked table of
(vessel class, port) options for a given cargo requirement, sorted
cheapest-landed-cost-first, with a plain-language reason per row.
"""
import pandas as pd

from src.cost_engine import compute_landed_cost, n_voyages_for, voyage_payload_tonnes
from src.feasibility import check_feasibility, seasonal_weather_days
from src.row_utils import opt_str

RANKED_COLUMNS = [
    "rank",
    "port",
    "vessel_class",
    "usd_per_tonne",
    "total_usd",
    "expected_wait_days",
    "weather_days",
    "transit_days",
    "rail_transit_days",
    "hire_cost_usd",
    "waiting_hire_usd",
    "transfer_cost_usd",
    "port_charges_usd",
    "rail_cost_usd",
    "transshipment_cost_usd",
    "n_voyages",
    "payload_tonnes",
    "vessel_fill_pct",
    "berth_days",
    "load_days",
    "transshipment_days",
    "total_lead_days",
    "hire_rate_usd_per_day",
    "part_loaded",
    "bunker_cost_usd",
    "bunker_tonnes",
    "load_wait_days",
    "route_nm",
    "discharge_rate_tpd",
    "cargo_shipped_tonnes",
    "reason",
]


def _reason_string(
    port_name: str, vessel_class: str, n_voyages: int, payload: float, wait_days: float, usd_per_tonne: float,
    part_loaded: bool = False,
) -> str:
    voyages = f"{n_voyages} voyages of up to {payload:,.0f} t" if n_voyages > 1 else "1 voyage"
    loaded = ", part-loaded for the draft" if part_loaded else ""
    return (
        f"{port_name} ({vessel_class}): {voyages}{loaded}, expected wait {wait_days:.1f} days per call, "
        f"landed cost ${usd_per_tonne:.2f}/t"
    )


# Reference tables as plain dicts, built once per table. A plan ranks every
# port and vessel for each contract month; reading pandas rows cell by cell
# was most of its cost on a small server. The table is kept alongside so its
# id can't be reused by another.
_ROWS: dict[int, tuple[pd.DataFrame, list[dict]]] = {}
_RAIL: dict[int, tuple[pd.DataFrame, dict[tuple[str, str], dict]]] = {}


def _rows(df: pd.DataFrame) -> list[dict]:
    cached = _ROWS.get(id(df))
    if cached is None or cached[0] is not df:
        cached = (df, df.to_dict(orient="records"))
        _ROWS[id(df)] = cached
    return cached[1]


def _rail_index(rail_df: pd.DataFrame) -> dict[tuple[str, str], dict]:
    cached = _RAIL.get(id(rail_df))
    if cached is None or cached[0] is not rail_df:
        index: dict[tuple[str, str], dict] = {}
        for row in _rows(rail_df):
            index.setdefault((row["port"], row["plant"]), row)
        cached = (rail_df, index)
        _RAIL[id(rail_df)] = cached
    return cached[1]


def origin_row_for(origin: str, origin_transit_df: pd.DataFrame) -> pd.Series:
    match = origin_transit_df[origin_transit_df["origin"] == origin]
    if match.empty:
        raise ValueError(f"Unknown origin: {origin}")
    return match.iloc[0]


def rail_row_for(port_row: pd.Series | dict, plant_name: str, rail_df: pd.DataFrame) -> dict | None:
    """Rail leg to the plant. An anchorage that transships to another port
    (e.g. Sagar-Sandheads to Haldia) uses that port's rail link."""
    rail_port = opt_str(port_row, "rail_via_port") or port_row["name"]
    return _rail_index(rail_df).get((rail_port, plant_name))


def rank_options(
    cargo_tonnes: float,
    month: int,
    origin: str,
    plant_name: str,
    ports_df: pd.DataFrame,
    vessels_df: pd.DataFrame,
    rail_df: pd.DataFrame,
    origin_transit_df: pd.DataFrame,
    cost_assumptions: dict,
    tariff_df: pd.DataFrame | None = None,
    tolerance_pct: float = 0.0,
    vessel_class: str | None = None,
    port: str | None = None,
) -> pd.DataFrame:
    """Every (port, vessel class) that fits, costed and ranked by landed cost.

    - Sea days come from each route's own distance over real shipping lanes
      (data/sea_routes.json) at the service speed; the origin's estimate is the
      fallback when a route is missing.
    - Bunkers are priced from Brent; the loading terminal's queue scales with
      how busy it is (IMF PortWatch).
    - tolerance_pct is the charter party's more-or-less quantity: the cargo may
      be shipped up to that much short if it saves a voyage.
    - vessel_class / port fix the choice when the planner has decided.
    """
    from src.data_loader import bunker_price_usd_per_tonne, origin_wait_days, route_distance_nm

    origin_row = origin_row_for(origin, origin_transit_df)
    fallback_transit = float(origin_row["transit_days_est"])
    speed = float(cost_assumptions.get("service_speed_knots", 13.5))
    bunker_price = bunker_price_usd_per_tonne(cost_assumptions)
    load_wait = origin_wait_days(origin_row, cost_assumptions)
    tolerance = max(0.0, min(0.2, tolerance_pct / 100))

    if tariff_df is None and (ports_df["name"] == "Gangavaram").any():
        from src.data_loader import load_gangavaram_tariff

        tariff_df = load_gangavaram_tariff()

    rows = []
    for port_row in _rows(ports_df):
        if port is not None and port_row["name"] != port:
            continue
        rail_row = rail_row_for(port_row, plant_name, rail_df)
        if rail_row is None:
            continue
        nm = route_distance_nm(origin, port_row["name"])
        transit_days = round(nm / (speed * 24), 1) if nm else fallback_transit

        for vessel in _rows(vessels_df):
            if vessel_class is not None and vessel["vessel_class"] != vessel_class:
                continue
            fit = check_feasibility(vessel, port_row, month, origin_row)
            if not fit.feasible:
                continue
            weather_days = seasonal_weather_days(port_row, month)
            # More-or-less: ship up to `tolerance` short if that saves a voyage.
            payload = voyage_payload_tonnes(vessel, cost_assumptions, fit.draft_limit_m)
            voyages = n_voyages_for(cargo_tonnes * (1 - tolerance), payload) if payload > 0 else None
            shipped = min(cargo_tonnes, voyages * payload) if voyages else cargo_tonnes

            cost = compute_landed_cost(
                vessel_row=vessel,
                port_row=port_row,
                rail_row=rail_row,
                cost_assumptions=cost_assumptions,
                cargo_tonnes=shipped,
                transit_days=transit_days,
                tariff_df=tariff_df,
                origin_row=origin_row,
                n_voyages=voyages,
                draft_limit_m=fit.draft_limit_m,
                weather_days=weather_days,
                bunker_price_usd_per_tonne=bunker_price,
                load_wait_days=load_wait,
            )
            rail_days = float(rail_row["rail_transit_days"])
            rows.append(
                {
                    "port": port_row["name"],
                    "vessel_class": vessel["vessel_class"],
                    "usd_per_tonne": cost.usd_per_tonne,
                    "total_usd": cost.total_usd,
                    # Berth queue alone; weather_days are the typical swell days on top.
                    "expected_wait_days": round(cost.expected_wait_days - weather_days, 1),
                    "weather_days": weather_days,
                    "transit_days": transit_days,
                    "rail_transit_days": rail_row["rail_transit_days"],
                    "hire_cost_usd": cost.hire_cost_usd,
                    "waiting_hire_usd": cost.waiting_hire_usd,
                    "transfer_cost_usd": cost.transfer_cost_usd,
                    "port_charges_usd": cost.port_charges_usd,
                    "rail_cost_usd": cost.rail_cost_usd,
                    "transshipment_cost_usd": cost.transshipment_cost_usd,
                    "n_voyages": cost.n_voyages,
                    "payload_tonnes": cost.payload_tonnes,
                    "vessel_fill_pct": cost.vessel_fill_pct,
                    "berth_days": cost.berth_days,
                    "load_days": cost.load_days,
                    "transshipment_days": cost.transshipment_days,
                    # Time until the first cargo reaches the plant.
                    "total_lead_days": round(
                        load_wait + cost.load_days + transit_days + cost.expected_wait_days + cost.berth_days
                        + cost.transshipment_days + rail_days,
                        1,
                    ),
                    "hire_rate_usd_per_day": cost.hire_rate_usd_per_day,
                    "part_loaded": cost.part_loaded,
                    "bunker_cost_usd": cost.bunker_cost_usd,
                    "bunker_tonnes": cost.bunker_tonnes,
                    "load_wait_days": load_wait,
                    "route_nm": nm,
                    "discharge_rate_tpd": cost.discharge_rate_tpd,
                    "cargo_shipped_tonnes": round(shipped, 0),
                    "reason": _reason_string(
                        port_row["name"], vessel["vessel_class"], cost.n_voyages, cost.payload_tonnes,
                        cost.expected_wait_days, cost.usd_per_tonne, cost.part_loaded,
                    ),
                }
            )

    if not rows:
        return pd.DataFrame(columns=RANKED_COLUMNS)

    ranked = pd.DataFrame(rows).sort_values(["usd_per_tonne", "total_lead_days"]).reset_index(drop=True)
    ranked.insert(0, "rank", ranked.index + 1)
    return ranked[RANKED_COLUMNS]
