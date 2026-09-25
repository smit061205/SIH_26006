"""Stage A of the FREIGHTWISE methodology: 'Check what fits'.

Hard rule-based filter - removes any vessel that cannot physically call at a
port in a given month, or load at the origin terminal. No ML here by design
(see project spec: this must be deterministic and auditable before anything
probabilistic is layered on top).
"""
from dataclasses import dataclass, field

import pandas as pd

from src.row_utils import opt_float, opt_int, opt_str, opt_value

# Fallback when a port has no published monsoon window: June-September,
# the East Coast SW monsoon.
MONSOON_MONTHS = {6, 7, 8, 9}

# A ship may call part-loaded where the water is shallower than its laden
# draft (common at Haldia and in monsoon draft cuts), as long as it still
# lifts at least this share of a full cargo; below that it isn't chartered.
MIN_PART_LOAD_FRACTION = 0.5


def monsoon_months(port_row: pd.Series) -> set[int]:
    """The port's own monsoon window (e.g. Gangavaram 1 May-30 Nov), wrapping
    past December when the window does; the generic window if unpublished."""
    start = opt_int(port_row, "monsoon_start_month")
    end = opt_int(port_row, "monsoon_end_month")
    if start is None or end is None:
        return MONSOON_MONTHS
    if start <= end:
        return set(range(start, end + 1))
    return set(range(start, 13)) | set(range(1, end + 1))


def seasonal_weather_days(port_row: pd.Series, month: int) -> float:
    """Days per call a port typically loses to swell in its monsoon months."""
    if month not in monsoon_months(port_row):
        return 0.0
    return opt_float(port_row, "weather_delay_days_monsoon") or 0.0


def seasonal_draft_limit(port_row: pd.Series, month: int) -> float:
    """Return the usable draft for a port in a given calendar month (1-12)."""
    base = float(port_row["max_draft_m"])
    if month in monsoon_months(port_row):
        base -= float(port_row["monsoon_draft_reduction_m"])
    return base


@dataclass
class FeasibilityResult:
    feasible: bool
    reasons_failed: list[str] = field(default_factory=list)
    usable_draft_m: float = 0.0
    # The deepest draft the ship can sail at on this route (the shallower of
    # the load and discharge ends). Below its laden draft it sails part-loaded.
    draft_limit_m: float | None = None
    part_loaded: bool = False


def part_load_fraction(vessel_row: pd.Series, draft_limit_m: float | None) -> float | None:
    """Share of a full cargo the ship can lift at a draft limit, from its
    tonnes-per-centimetre immersion. 1.0 when the draft isn't limiting;
    None when the ship would need part-loading but its TPC is unknown."""
    laden = float(vessel_row["draft_laden_m"])
    if draft_limit_m is None or draft_limit_m >= laden:
        return 1.0
    tpc = opt_float(vessel_row, "tpc_t_per_cm")
    if tpc is None:
        return None
    full = float(vessel_row["dwt_max"])
    lost = (laden - draft_limit_m) * 100 * tpc
    return max(0.0, (full - lost) / full)


def check_load_port(vessel_row: pd.Series, origin_row: pd.Series | None) -> list[str]:
    """Size limits at the loading terminal (draft is checked with the
    discharge end in check_feasibility, since part-loading ties them). Reasons
    start with 'load port' so the UI can tell them apart."""
    if origin_row is None:
        return []
    name = opt_str(origin_row, "load_port") or str(origin_row["origin"])
    reasons = []
    loa = opt_float(origin_row, "load_max_loa_m")
    if loa is not None and float(vessel_row["loa_m"]) > loa:
        reasons.append(f"load port {name}: LOA {vessel_row['loa_m']}m exceeds load-port limit {loa:.0f}m")
    beam = opt_float(origin_row, "load_max_beam_m")
    if beam is not None and float(vessel_row["beam_m"]) > beam:
        reasons.append(f"load port {name}: beam {vessel_row['beam_m']}m exceeds load-port limit {beam}m")
    dwt = opt_float(origin_row, "load_max_dwt")
    if dwt is not None and float(vessel_row["dwt_max"]) > dwt:
        reasons.append(f"load port {name}: {vessel_row['vessel_class']} is larger than the terminal's {dwt:,.0f} DWT limit")
    return reasons


def check_feasibility(
    vessel_row: pd.Series, port_row: pd.Series, month: int, origin_row: pd.Series | None = None
) -> FeasibilityResult:
    reasons = []
    usable_draft = seasonal_draft_limit(port_row, month)
    laden = float(vessel_row["draft_laden_m"])

    load_draft = opt_float(origin_row, "load_max_draft_m")
    draft_limit = min(usable_draft, load_draft) if load_draft is not None else usable_draft
    fraction = part_load_fraction(vessel_row, draft_limit)
    part_loaded = draft_limit < laden
    if fraction is None or fraction < MIN_PART_LOAD_FRACTION:
        if load_draft is not None and load_draft < usable_draft:
            name = opt_str(origin_row, "load_port") or str(origin_row["origin"])
            reasons.append(
                f"load port {name}: draft {laden}m exceeds load-port limit {load_draft:.1f}m, even part-loaded"
            )
        else:
            reasons.append(f"draft {laden}m exceeds seasonal limit {usable_draft:.1f}m, even part-loaded")

    loa_max = opt_float(port_row, "loa_max_m")
    if loa_max is not None and vessel_row["loa_m"] > loa_max:
        reasons.append(f"LOA {vessel_row['loa_m']}m exceeds port limit {loa_max}m")

    beam_max = opt_float(port_row, "beam_max_m")
    if beam_max is not None and vessel_row["beam_m"] > beam_max:
        reasons.append(f"beam {vessel_row['beam_m']}m exceeds port limit {beam_max}m")

    if vessel_row["vessel_class"] not in port_row["vessel_classes_allowed"]:
        reasons.append(f"{vessel_row['vessel_class']} not an accepted class at this port")

    if month in monsoon_months(port_row) and str(opt_value(port_row, "monsoon_closed")).lower() == "true":
        reasons.append("operations suspended in the monsoon months at this port")

    reasons.extend(check_load_port(vessel_row, origin_row))

    return FeasibilityResult(
        feasible=len(reasons) == 0,
        reasons_failed=reasons,
        usable_draft_m=usable_draft,
        draft_limit_m=draft_limit,
        part_loaded=part_loaded and not reasons,
    )


def feasible_combinations(
    ports_df: pd.DataFrame, vessels_df: pd.DataFrame, month: int, origin_row: pd.Series | None = None
) -> pd.DataFrame:
    """Cross-join ports x vessel classes and return every pair, each annotated
    with whether it fits and, if not, why."""
    rows = []
    for _, port in ports_df.iterrows():
        for _, vessel in vessels_df.iterrows():
            result = check_feasibility(vessel, port, month, origin_row)
            rows.append(
                {
                    "port_id": port["port_id"],
                    "port_name": port["name"],
                    "vessel_class": vessel["vessel_class"],
                    "feasible": result.feasible,
                    "part_loaded": result.part_loaded,
                    "usable_draft_m": result.usable_draft_m,
                    # Deepest draft on this route (shallower of load and discharge end).
                    "draft_limit_m": result.draft_limit_m,
                    "reasons_failed": "; ".join(result.reasons_failed),
                    "avg_wait_days_min": port["avg_wait_days_min"],
                    "avg_wait_days_max": port["avg_wait_days_max"],
                }
            )
    return pd.DataFrame(rows)
