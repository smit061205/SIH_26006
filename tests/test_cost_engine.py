import json
import math
from pathlib import Path

import pandas as pd
import pytest

from src.cost_engine import compute_landed_cost, gangavaram_real_port_charges

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def test_gangavaram_tariff_matches_pre_refactor_values(tariff_df):
    """Regression fixture captured from the hardcoded pre-refactor formula
    (see data/gangavaram_real_tariff_reference.csv history) - the CSV-backed
    lookup must reproduce it exactly."""
    expected = json.loads((FIXTURES_DIR / "gangavaram_expected_charges.json").read_text())

    for gt in (28000, 38000, 50000, 92000):
        for wait in (0, 3):
            actual = gangavaram_real_port_charges(gt, free_laytime_days=4, chargeable_wait_days=wait, tariff_df=tariff_df)
            expected_value = expected[f"{gt}_{wait}"]
            assert math.isclose(actual, expected_value, rel_tol=1e-6), f"gt={gt} wait={wait}"


def test_gangavaram_gt_band_boundary_45000(tariff_df):
    at_boundary = gangavaram_real_port_charges(45000, free_laytime_days=4, chargeable_wait_days=0, tariff_df=tariff_df)
    just_above = gangavaram_real_port_charges(45001, free_laytime_days=4, chargeable_wait_days=0, tariff_df=tariff_df)
    assert at_boundary != just_above


def test_gangavaram_tariff_lookup_isolated_from_real_csv():
    """GT-band lookup logic tested against a small inline fixture, independent
    of whatever the real CSV's current values happen to be."""
    small_tariff = pd.DataFrame(
        [
            {"charge_type": "Port Dues", "gt_band_min": None, "gt_band_max": 45000, "rate": 0.1, "unit": "x", "minimum_charge": "100 USD", "notes": ""},
            {"charge_type": "Port Dues", "gt_band_min": 45000, "gt_band_max": None, "rate": 0.2, "unit": "x", "minimum_charge": "100 USD", "notes": ""},
            {"charge_type": "Pilotage", "gt_band_min": None, "gt_band_max": None, "rate": 1.0, "unit": "x", "minimum_charge": "0 USD", "notes": ""},
            {"charge_type": "Mooring", "gt_band_min": None, "gt_band_max": None, "rate": 0.0, "unit": "x", "minimum_charge": "0 USD", "notes": ""},
            {"charge_type": "Port Environment/Dredging", "gt_band_min": None, "gt_band_max": None, "rate": None, "unit": "x", "minimum_charge": "50 USD", "notes": ""},
            {"charge_type": "Sustainability Charge", "gt_band_min": None, "gt_band_max": None, "rate": 0.0, "unit": "x", "minimum_charge": None, "notes": ""},
            {"charge_type": "Berth Hire", "gt_band_min": None, "gt_band_max": None, "rate": 0.0, "unit": "x", "minimum_charge": "0 USD per day", "notes": ""},
        ]
    )
    below = gangavaram_real_port_charges(10000, free_laytime_days=1, chargeable_wait_days=0, tariff_df=small_tariff)
    above = gangavaram_real_port_charges(50000, free_laytime_days=1, chargeable_wait_days=0, tariff_df=small_tariff)
    # Port Dues is the only rate-dependent component that differs across the
    # band here (10000*0.1=1000 vs max(50000*0.2,100)=10000) - rest are fixed.
    assert above > below


def test_compute_landed_cost_sums_components(ports_df, vessels_df, rail_df, cost_assumptions):
    port = ports_df[ports_df["name"] == "Dhamra"].iloc[0]
    vessel = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]
    rail_row = rail_df[(rail_df["port"] == "Dhamra")].iloc[0]

    cost = compute_landed_cost(
        vessel_row=vessel,
        port_row=port,
        rail_row=rail_row,
        cost_assumptions=cost_assumptions,
        cargo_tonnes=75000,
        transit_days=14,
    )

    component_sum = (
        cost.hire_cost_usd + cost.waiting_hire_usd + cost.transfer_cost_usd + cost.port_charges_usd + cost.rail_cost_usd
    )
    assert math.isclose(component_sum, cost.total_usd, rel_tol=1e-6)
    assert math.isclose(cost.total_usd / 75000, cost.usd_per_tonne, rel_tol=1e-3)


def test_compute_landed_cost_uses_gangavaram_real_charges_not_generic_flat_rate(ports_df, vessels_df, rail_df, cost_assumptions):
    vessel = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]

    gangavaram = ports_df[ports_df["name"] == "Gangavaram"].iloc[0]
    gangavaram_rail = rail_df[rail_df["port"] == "Gangavaram"].iloc[0]
    gangavaram_cost = compute_landed_cost(
        vessel_row=vessel, port_row=gangavaram, rail_row=gangavaram_rail,
        cost_assumptions=cost_assumptions, cargo_tonnes=75000, transit_days=14,
    )

    dhamra = ports_df[ports_df["name"] == "Dhamra"].iloc[0]
    dhamra_rail = rail_df[rail_df["port"] == "Dhamra"].iloc[0]
    dhamra_cost = compute_landed_cost(
        vessel_row=vessel, port_row=dhamra, rail_row=dhamra_rail,
        cost_assumptions=cost_assumptions, cargo_tonnes=75000, transit_days=14,
    )

    generic_port_charges = float(gangavaram["port_charges_flat_usd"]) + float(gangavaram["port_charges_per_tonne_usd"]) * 75000
    assert gangavaram_cost.port_charges_usd != generic_port_charges
    assert gangavaram_cost.port_charges_usd != dhamra_cost.port_charges_usd


def test_expected_wait_days_is_midpoint(ports_df, vessels_df, rail_df, cost_assumptions):
    port = ports_df[ports_df["name"] == "Dhamra"].iloc[0]
    vessel = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]
    rail_row = rail_df[rail_df["port"] == "Dhamra"].iloc[0]

    cost = compute_landed_cost(
        vessel_row=vessel, port_row=port, rail_row=rail_row,
        cost_assumptions=cost_assumptions, cargo_tonnes=75000, transit_days=14,
    )
    expected_midpoint = (float(port["avg_wait_days_min"]) + float(port["avg_wait_days_max"])) / 2
    assert cost.expected_wait_days == expected_midpoint


def test_wait_days_override_replaces_port_average(ports_df, vessels_df, rail_df, cost_assumptions):
    port = ports_df[ports_df["name"] == "Dhamra"].iloc[0]
    vessel = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]
    rail_row = rail_df[rail_df["port"] == "Dhamra"].iloc[0]

    cost = compute_landed_cost(
        vessel_row=vessel, port_row=port, rail_row=rail_row,
        cost_assumptions=cost_assumptions, cargo_tonnes=75000, transit_days=14,
        wait_days_override=9,
    )
    assert cost.expected_wait_days == 9


# --- voyages, handling time, transshipment -----------------------------------

from src.cost_engine import n_voyages_for, voyage_payload_tonnes


def _dhamra(ports_df, rail_df):
    return ports_df[ports_df["name"] == "Dhamra"].iloc[0], rail_df[rail_df["port"] == "Dhamra"].iloc[0]


def test_voyage_payload_uses_utilisation_factor(vessels_df, cost_assumptions):
    supramax = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]
    expected = math.floor(float(supramax["dwt_max"]) * float(cost_assumptions["cargo_intake_utilisation"]))
    assert voyage_payload_tonnes(supramax, cost_assumptions) == expected


def test_n_voyages_is_ceiling():
    assert n_voyages_for(57000, 57000) == 1
    assert n_voyages_for(57001, 57000) == 2
    assert n_voyages_for(180000, 57000) == 4


def test_non_positive_cargo_raises(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels_df[vessels_df["vessel_class"] == "Panamax"].iloc[0]
    with pytest.raises(ValueError):
        compute_landed_cost(vessel, port, rail, cost_assumptions, cargo_tonnes=0, transit_days=14)


def test_hire_waiting_and_flat_charges_scale_with_voyages(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]
    one = compute_landed_cost(vessel, port, rail, cost_assumptions, cargo_tonnes=50000, transit_days=14, wait_days_override=8)
    three = compute_landed_cost(vessel, port, rail, cost_assumptions, cargo_tonnes=150000, transit_days=14, wait_days_override=8)
    assert one.n_voyages == 1 and three.n_voyages == 3
    assert math.isclose(three.hire_cost_usd, 3 * one.hire_cost_usd, rel_tol=1e-6)
    assert math.isclose(three.waiting_hire_usd, 3 * one.waiting_hire_usd, rel_tol=1e-6)
    flat = float(port["port_charges_flat_usd"])
    per_tonne = float(port["port_charges_per_tonne_usd"])
    assert math.isclose(three.port_charges_usd, 3 * flat + per_tonne * 150000, rel_tol=1e-6)


def test_per_tonne_costs_do_not_scale_with_voyages(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels_df[vessels_df["vessel_class"] == "Handysize"].iloc[0]
    cost = compute_landed_cost(vessel, port, rail, cost_assumptions, cargo_tonnes=150000, transit_days=14)
    assert cost.n_voyages > 1
    assert math.isclose(cost.rail_cost_usd, float(rail["rail_cost_usd_per_tonne"]) * 150000, rel_tol=1e-6)
    assert math.isclose(cost.transfer_cost_usd, float(cost_assumptions["cargo_transfer_cost_usd_per_tonne"]) * 150000, rel_tol=1e-6)


def test_gangavaram_charges_per_call(ports_df, vessels_df, rail_df, cost_assumptions, tariff_df):
    port = ports_df[ports_df["name"] == "Gangavaram"].iloc[0]
    rail = rail_df[rail_df["port"] == "Gangavaram"].iloc[0]
    vessel = vessels_df[vessels_df["vessel_class"] == "Supramax"].iloc[0]
    one = compute_landed_cost(vessel, port, rail, cost_assumptions, 50000, 14, tariff_df=tariff_df)
    two = compute_landed_cost(vessel, port, rail, cost_assumptions, 100000, 14, tariff_df=tariff_df)
    assert two.n_voyages == 2
    assert math.isclose(two.port_charges_usd, 2 * one.port_charges_usd, rel_tol=1e-6)


def test_berth_days_from_discharge_rate(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    port = port.copy()
    port["discharge_rate_tpd"] = 25000
    vessel = vessels_df[vessels_df["vessel_class"] == "Panamax"].iloc[0]
    cost = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, wait_days_override=0)
    assert cost.berth_days == 3.0
    assert math.isclose(cost.hire_cost_usd, float(vessel["market_hire_rate_usd_per_day"]) * (14 + 3), rel_tol=1e-6)


def test_waiting_is_paid_as_hire_without_demurrage(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels_df[vessels_df["vessel_class"] == "Panamax"].iloc[0]
    none = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, wait_days_override=0)
    long = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, wait_days_override=10)
    rate = float(vessel["market_hire_rate_usd_per_day"])
    assert none.waiting_hire_usd == 0
    assert math.isclose(long.total_usd - none.total_usd, rate * 10, rel_tol=1e-6)


def test_weather_days_add_to_idle_hire(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels_df[vessels_df["vessel_class"] == "Panamax"].iloc[0]
    calm = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, wait_days_override=3)
    swell = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, wait_days_override=3, weather_days=1.5)
    assert swell.expected_wait_days == 4.5
    assert math.isclose(swell.waiting_hire_usd - calm.waiting_hire_usd, float(vessel["market_hire_rate_usd_per_day"]) * 1.5, rel_tol=1e-6)


def test_part_loaded_payload_needs_more_voyages(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels_df[vessels_df["vessel_class"] == "Handysize"].iloc[0]
    full = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14)
    shallow = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, draft_limit_m=8.0)
    assert shallow.part_loaded and not full.part_loaded
    assert shallow.payload_tonnes == full.payload_tonnes - (10.5 - 8.0) * 100 * float(vessel["tpc_t_per_cm"])
    assert shallow.n_voyages > full.n_voyages


def test_hire_falls_back_to_csv_rate_without_market_series(ports_df, rail_df, cost_assumptions):
    from src.data_loader import load_vessel_classes

    vessels = load_vessel_classes(market_rates=False)
    port, rail = _dhamra(ports_df, rail_df)
    vessel = vessels[vessels["vessel_class"] == "Panamax"].iloc[0]
    cost = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14)
    assert cost.hire_rate_usd_per_day == float(vessel["hire_rate_usd_per_day"])


def test_missing_rates_fall_back_to_no_berth_or_load_time(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    port = port.copy()
    port["discharge_rate_tpd"] = float("nan")
    vessel = vessels_df[vessels_df["vessel_class"] == "Panamax"].iloc[0]
    cost = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14, origin_row={"load_rate_tpd": None})
    assert cost.berth_days == 0 and cost.load_days == 0


def test_transshipment_cost_charged_per_tonne(ports_df, vessels_df, rail_df, cost_assumptions):
    port, rail = _dhamra(ports_df, rail_df)
    port = port.copy()
    port["transshipment_cost_usd_per_tonne"] = 6.0
    port["transshipment_days"] = 3
    vessel = vessels_df[vessels_df["vessel_class"] == "Panamax"].iloc[0]
    cost = compute_landed_cost(vessel, port, rail, cost_assumptions, 75000, 14)
    assert cost.transshipment_cost_usd == 450000.0
    assert cost.transshipment_days == 3
    assert cost.transfer_cost_usd == 0  # the transloading rate covers handling
    parts = cost.hire_cost_usd + cost.waiting_hire_usd + cost.transfer_cost_usd + cost.port_charges_usd + cost.rail_cost_usd
    assert math.isclose(parts + cost.transshipment_cost_usd, cost.total_usd, rel_tol=1e-6)


def test_voyage_charter_terms_arithmetic():
    from src.cost_engine import voyage_charter_terms

    row = {
        "n_voyages": 2, "cargo_shipped_tonnes": 150_000, "hire_rate_usd_per_day": 20_000,
        "transit_days": 10.0, "load_days": 2.0, "berth_days": 3.0,
        "load_wait_days": 1.5, "expected_wait_days": 4.0, "weather_days": 1.0,
        "hire_cost_usd": 1_000_000, "waiting_hire_usd": 260_000, "bunker_cost_usd": 400_000,
    }
    vessel = {"fuel_sea_t_per_day": 30.0, "fuel_port_t_per_day": 4.0}
    ca = {"laytime_turn_time_days": 0.5, "voyage_charter_owner_margin_pct": 5, "demurrage_to_hire_ratio": 1.0, "despatch_to_demurrage_ratio": 0.5}
    t = voyage_charter_terms(row, vessel, ca, bunker_price_usd_per_tonne=600)
    # Owner's costs per voyage: 20k x (10 + 5 + 1) days + (30 x 10 + 4 x 5) t x $600, plus 5%, for two voyages.
    freight = (20_000 * 16 + (300 + 20) * 600) * 1.05 * 2
    assert t["voyage_freight_usd_per_tonne"] == round(freight / 150_000, 4)
    # Waiting past the 12-hour turn time: 1.0 day loading, 4.5 days discharging, per voyage.
    assert t["demurrage_days"] == 11.0 and t["demurrage_usd"] == 220_000
    assert t["laytime_days"] == 6.0 and t["despatch_rate_usd_per_day"] == 10_000
    assert t["time_charter_usd"] == 1_660_000
    assert t["cheaper"] == ("voyage" if freight + 220_000 < 1_660_000 else "time")


def test_charter_terms_endpoint_covers_the_best_options():
    from tests.auth_helpers import signed_in_client

    body = {"cargo_tonnes": 75000, "month": 10, "origin": "Australia (Hay Point/Dalrymple Bay)", "plant_name": "Bhilai Steel Plant"}
    options = signed_in_client().post("/api/charter-terms", json=body).json()["options"]
    assert 1 <= len(options) <= 5
    for o in options:
        assert o["voyage_charter_usd"] > 0 and o["time_charter_usd"] > 0 and o["demurrage_days"] >= 0


def test_virtual_arrival_saves_fuel_without_changing_arrival():
    from src.cost_engine import virtual_arrival

    ca = {"service_speed_knots": 13.5, "slow_steaming_min_knots": 10, "co2_per_tonne_fuel": 3.151}
    vessel = {"fuel_sea_t_per_day": 30.0, "fuel_port_t_per_day": 4.0}
    row = {"expected_wait_days": 3.0, "transit_days": 15.0, "n_voyages": 1}
    va = virtual_arrival(row, vessel, ca, bunker_price_usd_per_tonne=600)
    v2 = 13.5 * 15 / 18
    saved = 30 * 15 * (1 - (v2 / 13.5) ** 2) + 4 * 3
    assert va["speed_knots"] == round(v2, 1) and va["anchorage_days_avoided"] == 3.0
    assert va["fuel_saved_t"] == round(saved) and va["co2_saved_t"] == round(saved * 3.151)
    # Never slower than the minimum: a long queue is only partly absorbed.
    long_queue = virtual_arrival({**row, "expected_wait_days": 30.0}, vessel, ca, 600)
    assert long_queue["speed_knots"] == 10.0 and long_queue["anchorage_days_avoided"] < 30
    # A short queue isn't worth it.
    assert virtual_arrival({**row, "expected_wait_days": 0.2}, vessel, ca, 600) is None
