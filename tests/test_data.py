"""Reference data stays consistent after edits."""
from pathlib import Path

import pandas as pd

from src.data_loader import load_freight_series

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def test_problem_statement_vessel_classes_present(vessels_df):
    assert {"Handysize", "Supramax", "Panamax", "Capesize"} <= set(vessels_df["vessel_class"])


def test_every_port_plant_pair_has_rail(ports_df, plants_df, rail_df):
    from src.rank import rail_row_for

    for _, port in ports_df.iterrows():
        for plant in plants_df["name"]:
            assert rail_row_for(port, plant, rail_df) is not None, (port["name"], plant)


def test_seven_discharge_ports_from_problem_statement(ports_df):
    expected = {"Paradip", "Visakhapatnam", "Gangavaram", "Gopalpur", "Dhamra", "Sagar-Sandheads", "Haldia"}
    assert set(ports_df["name"]) == expected


def test_russia_origins_present(origin_transit_df):
    assert sum(o.startswith("Russia") for o in origin_transit_df["origin"]) == 2


def test_new_operational_fields_have_provenance(ports_df, origin_transit_df):
    assert ports_df["ops_data_confidence"].notna().all()
    assert origin_transit_df["load_data_confidence"].notna().all()


def test_freight_series_aligned_weekly_and_positive():
    series = {c: load_freight_series(c) for c in ("Handysize", "Supramax", "Panamax", "Capesize")}
    index = series["Capesize"].index
    for s in series.values():
        assert s.index.equals(index)
        assert (s > 0).all()


def test_every_freight_series_regenerates_identically():
    from scripts.generate_synthetic_freight_rates import CLASS_PARAMS, generate

    for vessel_class in CLASS_PARAMS:
        on_disk = pd.read_csv(DATA_DIR / f"freight_rates_{vessel_class.lower()}.csv")
        regenerated = generate(vessel_class)
        assert on_disk["freight_usd_per_day"].tolist() == regenerated["freight_usd_per_day"].tolist(), vessel_class


def test_freight_series_end_on_published_levels():
    from scripts.generate_synthetic_freight_rates import CLASS_PARAMS

    for vessel_class, params in CLASS_PARAMS.items():
        on_disk = pd.read_csv(DATA_DIR / f"freight_rates_{vessel_class.lower()}.csv")
        assert on_disk["freight_usd_per_day"].iloc[-1] == params["levels"][-1], vessel_class


def test_intake_utilisation_in_range(cost_assumptions):
    assert 0.85 <= float(cost_assumptions["cargo_intake_utilisation"]) <= 1.0


def test_every_reference_row_has_provenance():
    for name, column in [
        ("ports.csv", "data_confidence"),
        ("vessel_classes.csv", "rate_data_confidence"),
        ("origin_transit_days.csv", "data_confidence"),
        ("port_to_plant_rail.csv", "data_confidence"),
    ]:
        df = pd.read_csv(DATA_DIR / name)
        assert df[column].notna().all(), name


def test_market_drivers_known_only_after_publication():
    from src.data_loader import load_market_drivers, market_drivers_weekly

    raw = load_market_drivers()
    coal = raw[raw["series"] == "coal_au"].set_index("date")["value"]
    index = pd.date_range("2024-01-07", "2024-03-31", freq="W-SUN")
    weekly = market_drivers_weekly(index)
    # January's monthly average isn't known during January.
    assert weekly.loc["2024-01-14", "coal_au"] == coal.loc["2023-12-01"]
    assert weekly.loc["2024-02-04", "coal_au"] == coal.loc["2024-01-01"]
