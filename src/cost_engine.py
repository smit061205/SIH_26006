"""Stage B of the FREIGHTWISE methodology: 'Add up the true cost'.

landed_cost_per_tonne =
    (hire + waiting hire + handling + port_charges + transshipment + rail) / cargo_tonnes

Ships are on time charter: the charterer pays hire for every day from
loading to the end of discharge, including days spent waiting for a berth,
and no separate demurrage. Hire is at today's market rate for the class
(data_loader adds market_hire_rate_usd_per_day from the weekly series), so
landed cost and the freight outlook price the same ship at the same rate.

A cargo larger than one ship can carry is split into voyages: per-voyage
costs (hire, per-call port charges) are multiplied by the voyage count,
per-tonne costs (handling, rail, transshipment) are not. Where the water is
shallower than the ship's laden draft it sails part-loaded, lifting less
per voyage (feasibility.part_load_fraction).
"""
import math
from dataclasses import dataclass

import pandas as pd

from src.row_utils import opt_float, opt_str

DEFAULT_INTAKE_UTILISATION = 0.95


@dataclass
class CostBreakdown:
    hire_cost_usd: float  # hire at sea, loading and alongside
    waiting_hire_usd: float  # hire while waiting for a berth
    transfer_cost_usd: float
    port_charges_usd: float
    rail_cost_usd: float
    total_usd: float
    usd_per_tonne: float
    expected_wait_days: float
    transit_days: float
    n_voyages: int = 1
    payload_tonnes: float = 0.0
    vessel_fill_pct: float = 0.0
    berth_days: float = 0.0
    load_days: float = 0.0
    transshipment_cost_usd: float = 0.0
    transshipment_days: float = 0.0
    hire_rate_usd_per_day: float = 0.0
    part_loaded: bool = False
    # Fuel (VLSFO) the time-charterer buys: at sea, and while loading, waiting and alongside.
    bunker_cost_usd: float = 0.0
    bunker_tonnes: float = 0.0
    # Days queued at the loading terminal (hire is paid while waiting there too).
    load_wait_days: float = 0.0
    discharge_rate_tpd: float | None = None


def discharge_rate_for(vessel_row: pd.Series, port_row: pd.Series, cost_assumptions: dict) -> float | None:
    """Tonnes a day the ship is discharged at. Grab-unloader berths work at
    their own rate; where the port uses mobile harbour cranes or floating
    cranes, a geared ship also works its own cranes, which adds to the rate."""
    rate = opt_float(port_row, "discharge_rate_tpd")
    if rate is None:
        return None
    cranes = opt_float(vessel_row, "cranes") or 0
    if cranes > 0 and opt_str(port_row, "handling_type") in ("mobile_harbour_cranes", "floating_cranes"):
        rate += float(cost_assumptions.get("geared_extra_discharge_tpd", 0) or 0)
    return rate


def hire_rate_for(vessel_row: pd.Series) -> float:
    """Today's market time-charter rate for the class, falling back to the
    2025 average in vessel_classes.csv when no market series is loaded."""
    return opt_float(vessel_row, "market_hire_rate_usd_per_day") or float(vessel_row["hire_rate_usd_per_day"])


def voyage_payload_tonnes(vessel_row: pd.Series, cost_assumptions: dict, draft_limit_m: float | None = None) -> float:
    """Cargo one voyage can lift: deadweight less bunkers, stores and
    constant, less the tonnes it must leave behind to sail at a shallower
    draft than its laden draft."""
    utilisation = float(cost_assumptions.get("cargo_intake_utilisation", DEFAULT_INTAKE_UTILISATION))
    payload = float(vessel_row["dwt_max"]) * utilisation
    laden = float(vessel_row["draft_laden_m"])
    tpc = opt_float(vessel_row, "tpc_t_per_cm")
    if draft_limit_m is not None and draft_limit_m < laden and tpc:
        payload -= (laden - draft_limit_m) * 100 * tpc
    return float(max(0, math.floor(payload)))


def n_voyages_for(cargo_tonnes: float, payload_tonnes: float) -> int:
    if cargo_tonnes <= 0:
        raise ValueError("cargo_tonnes must be positive")
    if payload_tonnes <= 0:
        raise ValueError("payload_tonnes must be positive")
    return math.ceil(cargo_tonnes / payload_tonnes - 1e-9)


def expected_wait_days(port_row: pd.Series) -> float:
    """Midpoint of the port's observed wait-day range."""
    return (float(port_row["avg_wait_days_min"]) + float(port_row["avg_wait_days_max"])) / 2


def _tariff_row(tariff_df: pd.DataFrame, charge_type: str, gt: float) -> pd.Series:
    """Picks the GT-band row for `charge_type` covering `gt`. Bands are
    (gt_band_min, gt_band_max] - lower bound exclusive, upper inclusive -
    with a missing bound meaning unbounded, matching how the tariff doc's
    own GT breakpoints are phrased (e.g. "GT<=45000" / "GT>45000")."""
    for lo, hi, row in _tariff_bands(tariff_df).get(charge_type, ()):
        if (lo is None or gt > lo) and (hi is None or gt <= hi):
            return row
    raise ValueError(f"No GT-band tariff row for charge_type={charge_type!r} at gt={gt}")


# Bands per charge type, built once per tariff table: a plan prices ~200
# voyages, and scanning the table row by row each time was a third of its cost.
# The table itself is kept alongside, so its id can't be reused by another.
_TARIFF_BANDS: dict[int, tuple[pd.DataFrame, dict[str, list]]] = {}


def _tariff_bands(tariff_df: pd.DataFrame) -> dict[str, list]:
    cached = _TARIFF_BANDS.get(id(tariff_df))
    if cached is not None and cached[0] is tariff_df:
        return cached[1]
    bands: dict[str, list] = {}
    for _, row in tariff_df.iterrows():
        lo, hi = row["gt_band_min"], row["gt_band_max"]
        bands.setdefault(row["charge_type"], []).append((None if pd.isna(lo) else float(lo), None if pd.isna(hi) else float(hi), row))
    _TARIFF_BANDS[id(tariff_df)] = (tariff_df, bands)
    return bands


def _minimum_usd(row: pd.Series) -> float:
    """minimum_charge is stored as e.g. '750 USD per vessel per entry' or
    '960 USD per day' - the leading number is always the USD amount."""
    return float(str(row["minimum_charge"]).split()[0])


def gangavaram_real_port_charges(gt: float, free_laytime_days: float, chargeable_wait_days: float, tariff_df: pd.DataFrame) -> float:
    """Port charges computed from Gangavaram's REAL published tariff (Adani
    Gangavaram Port BPTS/AGPL/05, w.e.f. 1 Apr 2024 - loaded from
    data/gangavaram_real_tariff_reference.csv via
    data_loader.load_gangavaram_tariff()), instead of the generic
    flat+per-tonne placeholder used for the other 5 ports.

    Simplification: berth hire is charged for `free_laytime_days` (assumed
    equal to the cargo-operations time at berth) and lay-up berth hire for
    any `chargeable_wait_days` beyond that. Real operations distinguish
    anchorage waiting (no berth hire) from berth-occupied idling (lay-up
    berth hire) more precisely than this MVP does.
    """
    port_dues_row = _tariff_row(tariff_df, "Port Dues", gt)
    port_dues = max(gt * float(port_dues_row["rate"]), _minimum_usd(port_dues_row))

    pilotage_row = _tariff_row(tariff_df, "Pilotage", gt)
    pilotage = max(gt * float(pilotage_row["rate"]), _minimum_usd(pilotage_row))

    mooring_row = _tariff_row(tariff_df, "Mooring", gt)
    mooring = max(gt * float(mooring_row["rate"]), _minimum_usd(mooring_row))

    dredging_row = _tariff_row(tariff_df, "Port Environment/Dredging", gt)
    dredging = _minimum_usd(dredging_row)

    sustainability_row = _tariff_row(tariff_df, "Sustainability Charge", gt)
    sustainability = gt * float(sustainability_row["rate"])

    berth_hire_row = _tariff_row(tariff_df, "Berth Hire", gt)
    berth_hire_rate = float(berth_hire_row["rate"])
    berth_hire_min_per_day = _minimum_usd(berth_hire_row)
    berth_hire = max(gt * berth_hire_rate * free_laytime_days * 24, berth_hire_min_per_day * free_laytime_days)

    layup_berth_hire = gt * berth_hire_rate * chargeable_wait_days * 24 if chargeable_wait_days > 0 else 0.0

    return port_dues + pilotage + mooring + dredging + sustainability + berth_hire + layup_berth_hire


def compute_landed_cost(
    vessel_row: pd.Series,
    port_row: pd.Series,
    rail_row: pd.Series,
    cost_assumptions: dict,
    cargo_tonnes: float,
    transit_days: float,
    wait_days_override: float | None = None,
    tariff_df: pd.DataFrame | None = None,
    origin_row: pd.Series | None = None,
    n_voyages: int | None = None,
    draft_limit_m: float | None = None,
    weather_days: float = 0.0,
    bunker_price_usd_per_tonne: float | None = None,
    load_wait_days: float = 0.0,
    hire_multiplier: float = 1.0,
    extra_wait_days: float = 0.0,
) -> CostBreakdown:
    """Landed cost of one shipment. hire_multiplier and extra_wait_days are
    stress-test shocks (a freight-market move, a longer berth queue)."""
    if cargo_tonnes <= 0:
        raise ValueError("cargo_tonnes must be positive")

    payload = voyage_payload_tonnes(vessel_row, cost_assumptions, draft_limit_m)
    voyages = n_voyages if n_voyages is not None else n_voyages_for(cargo_tonnes, payload)
    tonnes_per_voyage = cargo_tonnes / voyages

    # Time alongside comes from the published handling rate when known;
    # without one, berth time isn't charged as hire (the earlier behaviour).
    discharge_rate = discharge_rate_for(vessel_row, port_row, cost_assumptions)
    berth_days = tonnes_per_voyage / discharge_rate if discharge_rate else 0.0
    load_rate = opt_float(origin_row, "load_rate_tpd")
    load_days = tonnes_per_voyage / load_rate if load_rate else 0.0

    # Idle days per call: the berth queue plus days lost to swell.
    wait_days = (wait_days_override if wait_days_override is not None else expected_wait_days(port_row)) + weather_days + extra_wait_days
    free_laytime = float(cost_assumptions["free_laytime_days"])
    chargeable_wait_days = max(0.0, wait_days - free_laytime)

    rate = hire_rate_for(vessel_row) * hire_multiplier
    hire_cost = rate * (transit_days + load_days + berth_days) * voyages
    # Waiting for a berth at either end is hire paid for nothing.
    waiting_hire = rate * (wait_days + load_wait_days) * voyages

    # Bunkers: the time-charterer buys the fuel - at sea, and in port while
    # loading, waiting and discharging.
    fuel_sea = opt_float(vessel_row, "fuel_sea_t_per_day") or 0.0
    fuel_port = opt_float(vessel_row, "fuel_port_t_per_day") or 0.0
    bunker_tonnes = (fuel_sea * transit_days + fuel_port * (load_days + berth_days + wait_days + load_wait_days)) * voyages
    bunker_cost = bunker_tonnes * (bunker_price_usd_per_tonne or 0.0)
    # At an anchorage the transloading rate already covers handling.
    transshipment_rate = opt_float(port_row, "transshipment_cost_usd_per_tonne") or 0.0
    transfer_cost = 0.0 if transshipment_rate else float(cost_assumptions["cargo_transfer_cost_usd_per_tonne"]) * cargo_tonnes

    if port_row["name"] == "Gangavaram":
        if tariff_df is None:
            from src.data_loader import load_gangavaram_tariff

            tariff_df = load_gangavaram_tariff()
        per_call = gangavaram_real_port_charges(
            gt=float(vessel_row["gt_estimate"]),
            free_laytime_days=berth_days if berth_days > 0 else free_laytime,
            chargeable_wait_days=chargeable_wait_days,
            tariff_df=tariff_df,
        )
        port_charges = per_call * voyages
    else:
        port_charges = (
            float(port_row["port_charges_flat_usd"]) * voyages
            + float(port_row["port_charges_per_tonne_usd"]) * cargo_tonnes
        )

    transshipment_cost = transshipment_rate * cargo_tonnes
    transshipment_days = opt_float(port_row, "transshipment_days") or 0.0

    rail_cost = float(rail_row["rail_cost_usd_per_tonne"]) * cargo_tonnes

    total = hire_cost + waiting_hire + bunker_cost + transfer_cost + port_charges + transshipment_cost + rail_cost

    return CostBreakdown(
        hire_cost_usd=round(hire_cost, 2),
        waiting_hire_usd=round(waiting_hire, 2),
        transfer_cost_usd=round(transfer_cost, 2),
        port_charges_usd=round(port_charges, 2),
        rail_cost_usd=round(rail_cost, 2),
        total_usd=round(total, 2),
        usd_per_tonne=round(total / cargo_tonnes, 4),
        expected_wait_days=wait_days,
        transit_days=transit_days,
        n_voyages=voyages,
        payload_tonnes=payload,
        vessel_fill_pct=round(cargo_tonnes / (voyages * payload) * 100, 1),
        berth_days=round(berth_days, 2),
        load_days=round(load_days, 2),
        transshipment_cost_usd=round(transshipment_cost, 2),
        transshipment_days=transshipment_days,
        hire_rate_usd_per_day=round(rate, 2),
        part_loaded=draft_limit_m is not None and draft_limit_m < float(vessel_row["draft_laden_m"]),
        bunker_cost_usd=round(bunker_cost, 2),
        bunker_tonnes=round(bunker_tonnes, 1),
        load_wait_days=load_wait_days,
        discharge_rate_tpd=discharge_rate,
    )


def voyage_charter_terms(row: dict, vessel_row, cost_assumptions: dict, bunker_price_usd_per_tonne: float) -> dict:
    """The same shipment on a voyage charter instead of a time charter.

    Only the ocean part differs (port charges, handling and rail are the same
    either way), so both are compared on it:

    - Time charter: hire for every day, waiting included, plus all bunkers
      (the row's hire, waiting hire and bunker cost).
    - Voyage charter: the owner quotes freight per tonne covering their costs
      for the sea passage and the laytime (handling at the standard rates,
      which is what laytime allows), plus a margin; waiting beyond the turn
      time at either end is paid as demurrage. Despatch would be earned only
      by working faster than the standard rates, which the plan doesn't assume.

    `row` is one ranked option (src/rank.py); all amounts are per shipment.
    """
    voyages = int(row["n_voyages"])
    tonnes = float(row["cargo_shipped_tonnes"])
    hire = float(row["hire_rate_usd_per_day"])
    turn = float(cost_assumptions.get("laytime_turn_time_days", 0.5))
    margin = float(cost_assumptions.get("voyage_charter_owner_margin_pct", 5)) / 100
    dem_rate = hire * float(cost_assumptions.get("demurrage_to_hire_ratio", 1.0))
    des_rate = dem_rate * float(cost_assumptions.get("despatch_to_demurrage_ratio", 0.5))

    sea_days = float(row["transit_days"])
    laytime = float(row["load_days"]) + float(row["berth_days"])
    fuel_sea = opt_float(vessel_row, "fuel_sea_t_per_day") or 0.0
    fuel_port = opt_float(vessel_row, "fuel_port_t_per_day") or 0.0
    owner_cost = hire * (sea_days + laytime + 2 * turn) + (fuel_sea * sea_days + fuel_port * laytime) * bunker_price_usd_per_tonne
    freight = owner_cost * (1 + margin) * voyages
    # Waiting at the loading port, and at the discharge port (berth queue and swell), past the turn time.
    discharge_wait = float(row["expected_wait_days"]) + float(row["weather_days"])
    demurrage_days = (max(0.0, float(row["load_wait_days"]) - turn) + max(0.0, discharge_wait - turn)) * voyages
    demurrage = demurrage_days * dem_rate

    time_charter = float(row["hire_cost_usd"]) + float(row["waiting_hire_usd"]) + float(row["bunker_cost_usd"])
    voyage_charter = freight + demurrage
    return {
        "time_charter_usd": round(time_charter, 2),
        "time_charter_usd_per_tonne": round(time_charter / tonnes, 4),
        "voyage_freight_usd_per_tonne": round(freight / tonnes, 4),
        "voyage_charter_usd": round(voyage_charter, 2),
        "voyage_charter_usd_per_tonne": round(voyage_charter / tonnes, 4),
        "laytime_days": round(laytime + 2 * turn, 2),
        "demurrage_days": round(demurrage_days, 2),
        "demurrage_usd": round(demurrage, 2),
        "demurrage_rate_usd_per_day": round(dem_rate, 2),
        "despatch_rate_usd_per_day": round(des_rate, 2),
        "cheaper": "voyage" if voyage_charter < time_charter else "time",
    }
