import pytest

from src.rank import rank_options


def test_rank_options_sorted_by_usd_per_tonne_ascending(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(75000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert list(ranked["usd_per_tonne"]) == sorted(ranked["usd_per_tonne"])


def test_rank_options_excludes_infeasible_pairs(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(75000, 7, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    paradip_capesize = ranked[(ranked["port"] == "Paradip") & (ranked["vessel_class"] == "Capesize")]
    assert paradip_capesize.empty


def test_rank_options_unknown_origin_raises_value_error(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_plant):
    with pytest.raises(ValueError):
        rank_options(75000, 9, "Nonexistent Origin", default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)


def test_rank_options_rank_column_starts_at_one(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(75000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert ranked["rank"].iloc[0] == 1
    assert list(ranked["rank"]) == list(range(1, len(ranked) + 1))


def test_large_cargo_is_split_into_enough_voyages(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(180000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert not ranked.empty
    for _, row in ranked.iterrows():
        n, payload = int(row["n_voyages"]), float(row["payload_tonnes"])
        assert (n - 1) * payload < 180000 <= n * payload
    assert ranked.iloc[0]["vessel_class"] not in ("Handysize", "Supramax")


def test_reason_mentions_voyages(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(180000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert "voyage" in ranked.iloc[0]["reason"]


def test_empty_result_keeps_columns(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    sandheads_only = ports_df[ports_df["name"] == "Sagar-Sandheads"]
    ranked = rank_options(75000, 7, default_origin, default_plant, sandheads_only, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert ranked.empty
    assert {"rank", "port", "vessel_class", "n_voyages", "total_lead_days"} <= set(ranked.columns)


def test_load_port_constraint_excludes_class(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    shallow = origin_transit_df.copy()
    shallow["load_max_draft_m"] = 10.0
    ranked = rank_options(75000, 3, default_origin, default_plant, ports_df, vessels_df, rail_df, shallow, cost_assumptions)
    assert "Capesize" not in set(ranked["vessel_class"])
    assert ranked["part_loaded"].all()


def test_haldia_ranks_part_loaded(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin):
    ranked = rank_options(75000, 7, default_origin, "Durgapur Steel Plant", ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    haldia = ranked[ranked["port"] == "Haldia"]
    assert not haldia.empty and haldia["part_loaded"].all()
    handysize = vessels_df[vessels_df["vessel_class"] == "Handysize"].iloc[0]
    full = float(handysize["dwt_max"]) * float(cost_assumptions["cargo_intake_utilisation"])
    assert (haldia[haldia["vessel_class"] == "Handysize"]["payload_tonnes"] < full).all()


def test_hire_is_priced_at_market_rate(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(75000, 3, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    for _, row in ranked.iterrows():
        vessel = vessels_df[vessels_df["vessel_class"] == row["vessel_class"]].iloc[0]
        assert row["hire_rate_usd_per_day"] == float(vessel["market_hire_rate_usd_per_day"])


def test_sagar_sandheads_ranks_through_haldia_rail(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(75000, 1, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    sandheads = ranked[ranked["port"] == "Sagar-Sandheads"]
    assert not sandheads.empty
    haldia_rail = rail_df[(rail_df["port"] == "Haldia") & (rail_df["plant"] == default_plant)].iloc[0]
    row = sandheads.iloc[0]
    assert row["rail_cost_usd"] == round(float(haldia_rail["rail_cost_usd_per_tonne"]) * 75000, 2)
    assert row["transshipment_cost_usd"] > 0


def test_sagar_sandheads_closed_in_monsoon(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    ranked = rank_options(75000, 7, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert "Sagar-Sandheads" not in set(ranked["port"])


def test_us_load_port_takes_capesize_only_part_loaded(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_plant):
    us = next(o for o in origin_transit_df["origin"] if o.startswith("USA"))
    ranked = rank_options(150000, 1, us, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    capes = ranked[ranked["vessel_class"] == "Capesize"]
    assert not capes.empty and capes["part_loaded"].all()
