from src.feasibility import check_feasibility, feasible_combinations, seasonal_draft_limit


def _row(df, col, value):
    return df[df[col] == value].iloc[0]


def test_capesize_part_loaded_at_gangavaram_in_monsoon_month(ports_df, vessels_df):
    port = _row(ports_df, "name", "Gangavaram")
    vessel = _row(vessels_df, "vessel_class", "Capesize")

    result = check_feasibility(vessel, port, month=7)

    assert result.usable_draft_m == 17.7
    assert result.feasible is True
    assert result.part_loaded is True
    assert result.draft_limit_m == 17.7


def test_capesize_feasible_at_gangavaram_outside_monsoon(ports_df, vessels_df):
    port = _row(ports_df, "name", "Gangavaram")
    vessel = _row(vessels_df, "vessel_class", "Capesize")

    result = check_feasibility(vessel, port, month=3)

    assert result.usable_draft_m == 18.0
    assert result.feasible is True
    assert result.part_loaded is False
    assert result.reasons_failed == []


def test_post_panamax_excluded_at_gopalpur_any_month(ports_df, vessels_df):
    port = _row(ports_df, "name", "Gopalpur")
    vessel = _row(vessels_df, "vessel_class", "Post-Panamax")

    for month in (1, 7):
        result = check_feasibility(vessel, port, month=month)
        assert result.feasible is False
        assert any("not an accepted class" in r for r in result.reasons_failed)


def test_draft_too_shallow_even_part_loaded_is_rejected(ports_df, vessels_df):
    port = _row(ports_df, "name", "Haldia")
    vessel = _row(vessels_df, "vessel_class", "Capesize")
    result = check_feasibility(vessel, port, month=1)
    assert result.feasible is False
    assert any("even part-loaded" in r for r in result.reasons_failed)


def test_haldia_takes_part_loaded_handysize_all_year(ports_df, vessels_df):
    port = _row(ports_df, "name", "Haldia")
    vessel = _row(vessels_df, "vessel_class", "Handysize")
    for month in range(1, 13):
        result = check_feasibility(vessel, port, month=month)
        assert result.feasible and result.part_loaded, month


def test_part_load_fraction_from_tpc(vessels_df):
    from src.feasibility import part_load_fraction

    handysize = _row(vessels_df, "vessel_class", "Handysize")
    assert part_load_fraction(handysize, 12.0) == 1.0
    lost = (float(handysize["draft_laden_m"]) - 9.0) * 100 * float(handysize["tpc_t_per_cm"])
    assert part_load_fraction(handysize, 9.0) == (float(handysize["dwt_max"]) - lost) / float(handysize["dwt_max"])
    no_tpc = handysize.copy()
    no_tpc["tpc_t_per_cm"] = None
    assert part_load_fraction(no_tpc, 9.0) is None


def test_capesize_excluded_at_paradip_any_month(ports_df, vessels_df):
    port = _row(ports_df, "name", "Paradip")
    vessel = _row(vessels_df, "vessel_class", "Capesize")

    for month in (1, 7):
        result = check_feasibility(vessel, port, month=month)
        assert result.feasible is False
        assert any("not an accepted class" in r for r in result.reasons_failed)


def test_seasonal_draft_limit_non_monsoon_uses_full_draft(ports_df):
    port = _row(ports_df, "name", "Gangavaram")
    assert seasonal_draft_limit(port, month=3) == float(port["max_draft_m"])


def test_seasonal_draft_limit_monsoon_subtracts_reduction(ports_df):
    port = _row(ports_df, "name", "Gangavaram")
    expected = float(port["max_draft_m"]) - float(port["monsoon_draft_reduction_m"])
    assert seasonal_draft_limit(port, month=6) == expected


def test_feasible_combinations_returns_both_feasible_and_rejected_rows(ports_df, vessels_df):
    combos = feasible_combinations(ports_df, vessels_df, month=7)

    assert len(combos) == len(ports_df) * len(vessels_df)
    assert combos["feasible"].any()
    assert (~combos["feasible"]).any()

    rejected = combos[~combos["feasible"]]
    assert (rejected["reasons_failed"] != "").all()


from src.feasibility import check_load_port, monsoon_months


def test_monsoon_window_from_port_columns(ports_df):
    port = _row(ports_df, "name", "Dhamra").copy()
    port["monsoon_start_month"] = 5
    port["monsoon_end_month"] = 11
    assert monsoon_months(port) == set(range(5, 12))


def test_monsoon_window_wraps_year(ports_df):
    port = _row(ports_df, "name", "Dhamra").copy()
    port["monsoon_start_month"] = 11
    port["monsoon_end_month"] = 2
    assert monsoon_months(port) == {11, 12, 1, 2}


def test_monsoon_fallback_when_columns_missing(ports_df):
    port = _row(ports_df, "name", "Dhamra").copy()
    port["monsoon_start_month"] = None
    assert monsoon_months(port) == {6, 7, 8, 9}


def test_load_port_reasons_are_prefixed(vessels_df, origin_transit_df):
    capesize = _row(vessels_df, "vessel_class", "Capesize")
    origin = origin_transit_df.iloc[0].copy()
    origin["load_port"] = "Test Terminal"
    origin["load_max_loa_m"] = 250.0
    reasons = check_load_port(capesize, origin)
    assert reasons and all(r.startswith("load port Test Terminal") for r in reasons)


def test_shallow_load_port_rejects_with_load_port_reason(ports_df, vessels_df, origin_transit_df):
    capesize = _row(vessels_df, "vessel_class", "Capesize")
    origin = origin_transit_df.iloc[0].copy()
    origin["load_port"] = "Test Terminal"
    origin["load_max_draft_m"] = 10.0
    result = check_feasibility(capesize, _row(ports_df, "name", "Dhamra"), month=1, origin_row=origin)
    assert not result.feasible
    assert any(r.startswith("load port Test Terminal") and "even part-loaded" in r for r in result.reasons_failed)


def test_allowed_classes_exist_in_vessel_classes(ports_df, vessels_df):
    known = set(vessels_df["vessel_class"])
    for classes in ports_df["vessel_classes_allowed"]:
        assert set(classes) <= known


def test_port_specific_monsoon_windows(ports_df):
    gangavaram = _row(ports_df, "name", "Gangavaram")
    dhamra = _row(ports_df, "name", "Dhamra")
    assert {5, 11} <= monsoon_months(gangavaram)
    assert 11 not in monsoon_months(dhamra)


def test_capesize_part_loaded_at_gangavaram_in_october(ports_df, vessels_df):
    """Gangavaram's monsoon runs to November, so October has the reduced draft."""
    result = check_feasibility(_row(vessels_df, "vessel_class", "Capesize"), _row(ports_df, "name", "Gangavaram"), month=10)
    assert result.usable_draft_m == 17.7 and result.part_loaded
