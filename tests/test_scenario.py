import math

import pytest

from src.scenario import recommend_contract_split, simulate_port_exclusion, simulate_wait_scenarios


def test_recommend_contract_split_cost_comparison_uses_hire_days_only():
    """Regression test for the dead-code fix: cargo_tonnes must not appear
    as a multiplier in the whole-voyage $ figures (hire_days * rate only)."""
    result = recommend_contract_split(
        cargo_tonnes=75000, current_rate=21297, forecast_point=25000,
        forecast_lower=20000, forecast_upper=30000, transit_plus_wait_days=20.0,
    )
    spot_row = result.cost_comparison[result.cost_comparison["strategy"].str.startswith("100% spot")].iloc[0]
    contract_row = result.cost_comparison[result.cost_comparison["strategy"].str.startswith("100% contract")].iloc[0]

    assert spot_row["estimated_hire_cost_usd"] == round(20.0 * 25000, 0)
    assert contract_row["estimated_hire_cost_usd"] == round(20.0 * 21297, 0)

    # Changing cargo_tonnes must not change the whole-voyage cost figures.
    result_other_tonnage = recommend_contract_split(
        cargo_tonnes=150000, current_rate=21297, forecast_point=25000,
        forecast_lower=20000, forecast_upper=30000, transit_plus_wait_days=20.0,
    )
    assert result_other_tonnage.cost_comparison["estimated_hire_cost_usd"].tolist() == result.cost_comparison["estimated_hire_cost_usd"].tolist()


def test_recommend_contract_split_per_tonne_columns_present_and_correct():
    result = recommend_contract_split(
        cargo_tonnes=75000, current_rate=21297, forecast_point=25000,
        forecast_lower=20000, forecast_upper=30000, transit_plus_wait_days=20.0,
    )
    assert "estimated_hire_cost_usd_per_tonne" in result.cost_comparison.columns
    for _, row in result.cost_comparison.iterrows():
        expected = round(row["estimated_hire_cost_usd"] / 75000, 4)
        assert math.isclose(row["estimated_hire_cost_usd_per_tonne"], expected, rel_tol=1e-6)


def test_recommend_contract_split_zero_cargo_tonnes_raises():
    with pytest.raises(ValueError):
        recommend_contract_split(cargo_tonnes=0, current_rate=21297, forecast_point=25000, forecast_lower=20000, forecast_upper=30000)


def test_recommend_contract_split_negative_cargo_tonnes_raises():
    with pytest.raises(ValueError):
        recommend_contract_split(cargo_tonnes=-1, current_rate=21297, forecast_point=25000, forecast_lower=20000, forecast_upper=30000)


def test_recommend_contract_split_rising_forecast_tilts_toward_contract():
    result = recommend_contract_split(cargo_tonnes=75000, current_rate=20000, forecast_point=25000, forecast_lower=24000, forecast_upper=26000)
    assert result.contract_pct > 50.0


def test_recommend_contract_split_falling_forecast_tilts_toward_spot():
    result = recommend_contract_split(cargo_tonnes=75000, current_rate=20000, forecast_point=15000, forecast_lower=14000, forecast_upper=16000)
    assert result.contract_pct < 50.0


def test_recommend_contract_split_clipped_to_20_80_band():
    result = recommend_contract_split(cargo_tonnes=75000, current_rate=10000, forecast_point=100000, forecast_lower=99000, forecast_upper=101000)
    assert result.contract_pct == 80.0
    assert result.spot_pct == 20.0


def test_simulate_wait_scenarios_returns_one_row_per_wait_option(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    result = simulate_wait_scenarios(
        75000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions,
        wait_days_options=(0, 3, 7, 14),
    )
    assert len(result) == 4
    assert list(result["wait_days"]) == [0, 3, 7, 14]


def test_simulate_port_exclusion_excludes_named_port(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    result = simulate_port_exclusion(75000, 9, default_origin, default_plant, "Dhamra", ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions)
    assert "Dhamra" not in result["port"].values
