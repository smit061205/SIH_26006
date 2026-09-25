"""Timing, contract schedule, plant stock cover, alerts and idle time."""
import math

import numpy as np
import pandas as pd

from src.alerts import AlertThresholds, congestion_alerts, market_alerts, port_activity, weather_alerts
from src.cost_engine import compute_landed_cost
from src.rank import origin_row_for, rail_row_for
from src.scenario import idle_time_analysis, recommend_contract_split
from src.schedule import build_contract_schedule, contract_months
from src.stock import cover_vs_lead_time, plant_stock_cover
from src.timing import best_fix_week, fix_signal

DATES = [f"2026-10-{d:02d}" for d in (4, 11, 18, 25)]


def _window(current, point, band=0.02):
    point = np.array(point, dtype=float)
    return best_fix_week(current, "2026-09-27", DATES, point, point * (1 - band), point * (1 + band), 4)


# --- timing -----------------------------------------------------------------

def test_best_fix_week_is_cheapest_point():
    best = _window(100, [99, 90, 95, 97])
    assert best.week_index == 2 and best.expected_rate == 90


def test_best_fix_is_now_when_rates_rise():
    best = _window(100, [101, 104, 108, 110])
    assert best.week_index == 0
    assert fix_signal(100, best)[0] == "fix_now"


def test_signal_wait_when_saving_large_and_downside_small():
    best = _window(100, [95, 90, 92, 93], band=0.05)
    assert fix_signal(100, best)[0] == "wait"


def test_signal_fix_now_when_saving_trivial():
    best = _window(100, [99.5, 99, 99.2, 99.4])
    assert fix_signal(100, best)[0] == "fix_now"


def test_signal_stagger_when_range_is_wide():
    best = _window(100, [95, 90, 92, 93], band=0.3)
    assert fix_signal(100, best)[0] == "stagger"


def test_contract_split_scales_with_voyages_and_contract_rate():
    one = recommend_contract_split(75000, 20000, 22000, 21000, 23000, transit_plus_wait_days=20)
    six = recommend_contract_split(75000, 20000, 22000, 21000, 23000, transit_plus_wait_days=20, n_voyages=6)
    for a, b in zip(one.cost_comparison["estimated_hire_cost_usd"], six.cost_comparison["estimated_hire_cost_usd"]):
        assert math.isclose(b, 6 * a, rel_tol=1e-3)
    priced = recommend_contract_split(75000, 20000, 22000, 21000, 23000, transit_plus_wait_days=20, contract_rate=18000)
    contract_row = priced.cost_comparison[priced.cost_comparison["strategy"].str.startswith("100% contract")].iloc[0]
    assert contract_row["estimated_hire_cost_usd"] == 20 * 18000


# --- schedule ---------------------------------------------------------------

def test_contract_months_wrap_year():
    assert contract_months(11, 4) == [11, 12, 1, 2]


def _schedule(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, origin, plant, **kw):
    return build_contract_schedule(75000, 10, 6, origin, plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, **kw)


def test_contract_class_is_feasible_every_month(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    s = _schedule(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant)
    assert s["contract_vessel_class"]
    assert len(s["months"]) == 6
    assert all(m["vessel_class"] == s["contract_vessel_class"] for m in s["months"])


def test_contract_total_not_below_free_choice(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    s = _schedule(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant, vessel_class="Supramax")
    assert s["contract_vessel_class"] == "Supramax"
    assert s["totals"]["contract_total_usd"] >= s["totals"]["unconstrained_total_usd"]
    assert s["totals"]["flexibility_cost_usd"] >= 0


# --- plant stock ------------------------------------------------------------

def test_bhilai_days_of_cover(plants_df):
    bhilai = next(p for p in plant_stock_cover(plants_df) if p["name"] == "Bhilai Steel Plant")
    assert bhilai["days_of_cover"] == 20.0
    assert bhilai["status"] == "below_buffer"


def test_zero_demand_has_no_cover_figure():
    df = pd.DataFrame([{"name": "X", "monthly_coking_coal_demand_tonnes": 0, "current_inventory_tonnes": 10, "buffer_days_target": 30}])
    assert plant_stock_cover(df)[0]["days_of_cover"] is None


def test_stockout_before_arrival():
    assert cover_vs_lead_time({"days_of_cover": 20.0}, 23)["stockout_before_arrival"] is True
    assert cover_vs_lead_time({"days_of_cover": 30.0}, 23)["stockout_before_arrival"] is False


# --- alerts -----------------------------------------------------------------

def test_wave_threshold_is_inclusive():
    weather = {"Paradip": {"dates": ["2026-09-24", "2026-09-25"], "wave_height_max_m": [2.5, 1.0]}}
    assert len(weather_alerts(weather, AlertThresholds())) == 1
    assert weather_alerts(weather, AlertThresholds(wave_height_m=2.6)) == []


def test_weather_error_payload_ignored():
    assert weather_alerts({"Paradip": {"error": "timeout"}}, AlertThresholds()) == []


def test_wait_alert_uses_midpoint(ports_df):
    haldia = ports_df[ports_df["name"] == "Haldia"]
    alerts = congestion_alerts(haldia, {}, AlertThresholds(wait_days=5))
    assert any(a["id"] == "wait-Haldia" for a in alerts)
    assert congestion_alerts(haldia, {}, AlertThresholds(wait_days=6)) == []


def test_activity_surge_compares_recent_with_previous_year():
    dates = pd.date_range("2025-01-01", "2026-06-30", freq="D")
    calls = np.where(dates >= pd.Timestamp("2026-06-03"), 4, 2)
    act = port_activity(pd.DataFrame({"date": dates, "portcalls_dry_bulk": calls}), recent_days=28)
    assert act["pct_vs_normal"] == 100.0


def test_activity_none_without_data():
    assert port_activity(None) is None


def test_market_alerts_band_and_move():
    f = {"Capesize": {"current_rate": 100, "point": [100, 115], "lower": [90, 70], "upper": [110, 130], "dates": DATES[:2]}}
    ids = {a["id"] for a in market_alerts(f, AlertThresholds())}
    assert ids == {"band-Capesize", "move-Capesize"}
    assert market_alerts(f, AlertThresholds(forecast_band_pct=70, forecast_move_pct=20)) == []


# --- idle time --------------------------------------------------------------

def test_idle_cost_is_hire_for_idle_days(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    """On time charter, idle days cost the hire rate per voyage (Dhamra has no
    time-based port charges)."""
    result = idle_time_analysis(75000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, port="Dhamra")
    base = result["baseline"]
    assert base["port"] == "Dhamra"
    rate = float(vessels_df[vessels_df["vessel_class"] == base["vessel_class"]].iloc[0]["market_hire_rate_usd_per_day"])
    assert math.isclose(base["idle_cost_usd"], rate * base["expected_idle_days"] * base["n_voyages"], rel_tol=1e-6)


def test_idle_includes_seasonal_swell_in_monsoon(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    july = idle_time_analysis(75000, 7, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, port="Dhamra")
    january = idle_time_analysis(75000, 1, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, port="Dhamra")
    dhamra = ports_df[ports_df["name"] == "Dhamra"].iloc[0]
    assert july["baseline"]["weather_basis"] == "seasonal"
    assert july["baseline"]["weather_delay_days"] == float(dhamra["weather_delay_days_monsoon"])
    assert january["baseline"]["weather_delay_days"] == 0


def test_idle_month_shift_out_of_monsoon_saves_swell_days(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    """Dhamra's monsoon ends in September, so arriving in October avoids its swell days."""
    result = idle_time_analysis(75000, 9, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, port="Dhamra")
    later = [a for a in result["alternatives"] if a["option_type"] == "month" and a["month"] == 10]
    assert later and later[0]["idle_days_saved"] > 0


def test_far_voyage_uses_seasonal_not_this_weeks_weather(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    stormy = {p: {"dates": DATES, "wave_height_max_m": [4.0] * 4} for p in ports_df["name"]}
    result = idle_time_analysis(
        75000, 1, default_origin, default_plant, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, weather=stormy
    )
    assert result["baseline"]["weather_basis"] == "seasonal"
    assert result["baseline"]["weather_delay_days"] == 0


def test_close_voyage_uses_live_weather(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant, monkeypatch):
    # A 2-day voyage: switch off the per-route distances so the origin's transit estimate applies.
    monkeypatch.setattr("src.data_loader._sea_route_lengths", lambda: {})
    quick = origin_transit_df.copy()
    quick["transit_days_est"] = 2
    quick["load_rate_tpd"] = 1_000_000
    stormy = {p: {"dates": DATES, "wave_height_max_m": [4.0, 4.0, 1.0, 1.0]} for p in ports_df["name"]}
    result = idle_time_analysis(75000, 1, default_origin, default_plant, ports_df, vessels_df, rail_df, quick, cost_assumptions, weather=stormy)
    assert result["baseline"]["weather_basis"] == "forecast"
    assert result["baseline"]["weather_delay_days"] == 2


def test_notice_alerts_window():
    import pandas as pd

    from src.alerts import notice_alerts

    notices = pd.DataFrame(
        {
            "port": ["Paradip", "Haldia", "Dhamra"],
            "start_date": pd.to_datetime(["2026-09-20", "2026-12-01", "2026-09-01"]),
            "end_date": pd.to_datetime(["2026-09-30", "2026-12-05", "2026-09-10"]),
            "title": ["Strike", "Dredging", "Old closure"],
            "severity": ["high", "medium", "high"],
            "source": ["test"] * 3,
        }
    )
    alerts = notice_alerts(notices, pd.Timestamp("2026-09-24"))
    assert [a["port"] for a in alerts] == ["Paradip"]
    assert alerts[0]["kind"] == "notice" and alerts[0]["peak_date"] == "2026-09-30"
