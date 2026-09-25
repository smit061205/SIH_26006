import pytest

from tests.auth_helpers import signed_in_client

client = signed_in_client()


@pytest.fixture(scope="module")
def reference():
    return client.get("/api/reference").json()


def test_get_reference_returns_dropdown_lists(reference):
    assert len(reference["ports"]) > 0
    assert len(reference["plants"]) > 0
    assert len(reference["origins"]) > 0
    assert len(reference["months"]) == 12


def test_post_rank_returns_ranked_and_feasibility(reference):
    resp = client.post("/api/rank", json={
        "cargo_tonnes": 75000,
        "month": 9,
        "origin": reference["origins"][0],
        "plant_name": reference["plants"][0],
    })
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["ranked"]) > 0
    assert "usd_per_tonne" in body["ranked"][0]
    assert len(body["feasibility"]) > 0


def test_post_rank_unknown_origin_returns_400(reference):
    resp = client.post("/api/rank", json={
        "cargo_tonnes": 75000,
        "month": 9,
        "origin": "Nonexistent Origin",
        "plant_name": reference["plants"][0],
    })
    assert resp.status_code == 400


def test_post_plan_respects_cap_via_api(reference):
    resp = client.post("/api/plan", json={
        "cargo_tonnes": 75000,
        "month": 9,
        "origin": reference["origins"][0],
        "plant_name": reference["plants"][0],
        "n_shipments": 5,
        "max_calls_per_port_month": 2,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["assignments"]) == 5

    from collections import Counter

    counts = Counter((a["port"], a["month"]) for a in body["assignments"])
    assert all(c <= 2 for c in counts.values())


def test_post_contract_split_returns_expected_keys_including_new_per_tonne_field():
    resp = client.post("/api/scenario/contract-split", json={
        "cargo_tonnes": 500000,
        "current_rate": 21297,
        "forecast_point": 25000,
        "forecast_lower": 20000,
        "forecast_upper": 30000,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert 20.0 <= body["contract_pct"] <= 80.0
    assert body["cost_comparison"]
    for row in body["cost_comparison"]:
        assert "estimated_hire_cost_usd_per_tonne" in row


def test_get_forecast_returns_history_and_forecast():
    resp = client.get("/api/forecast", params={"horizon": 8})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["forecast"]) == 8
    assert len(body["history"]) > 0


def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# --- new endpoints -------------------------------------------------------------

import backend.main as main_module

FAKE_WEATHER = {
    name: {"dates": ["2026-09-24", "2026-09-25"], "wave_height_max_m": [3.0, 1.0]}
    for name in ["Gangavaram", "Dhamra", "Paradip", "Haldia", "Visakhapatnam", "Gopalpur", "Sagar-Sandheads"]
}


def _no_network(monkeypatch):
    monkeypatch.setattr(main_module, "_weather", lambda forecast_days: FAKE_WEATHER)


def test_reference_includes_vessel_classes_and_durations(reference):
    names = [v["name"] for v in reference["vessel_classes"]]
    assert {"Handysize", "Supramax", "Panamax", "Capesize"} <= set(names)
    assert [d["value"] for d in reference["durations"]] == [0, 3, 6, 12]


def test_forecast_vessel_class_param():
    ok = client.get("/api/forecast", params={"vessel_class": "Panamax", "horizon": 8})
    assert ok.status_code == 200 and ok.json()["series_class"] == "Panamax"
    assert client.get("/api/forecast", params={"vessel_class": "Post-Panamax"}).json()["series_class"] == "Panamax"
    assert client.get("/api/forecast", params={"vessel_class": "Nope"}).status_code == 400


def test_rank_rejects_zero_cargo(reference):
    resp = client.post("/api/rank", json={"cargo_tonnes": 0, "month": 9, "origin": reference["origins"][0], "plant_name": reference["plants"][0]})
    assert resp.status_code == 422


def test_rank_rows_include_voyages(reference):
    body = client.post("/api/rank", json={"cargo_tonnes": 180000, "month": 9, "origin": reference["origins"][0], "plant_name": reference["plants"][0]}).json()
    assert all(r["n_voyages"] >= 2 for r in body["ranked"])


def test_timing_shape():
    body = client.get("/api/timing", params={"vessel_class": "Supramax", "duration_months": 6, "n_voyages": 12}).json()
    assert body["signal"] in {"fix_now", "wait", "stagger"}
    assert {"week_index", "date", "expected_rate", "saving_vs_now_pct"} <= set(body["best_fix"])
    all_contract = body["contract"]["cost_comparison"][2]["estimated_hire_cost_usd"]
    assert all_contract == pytest.approx(12 * 20.0 * body["current_rate"], rel=1e-6)
    assert len(body["forecast"]) >= 12
    assert "20" not in body["signal_reason"][:4]  # dates are written as "11 Oct", not ISO


def test_schedule_shape(reference):
    body = client.post("/api/schedule", json={
        "monthly_cargo_tonnes": 75000, "start_month": 11, "duration_months": 3,
        "origin": reference["origins"][0], "plant_name": reference["plants"][0],
    }).json()
    assert [m["month"] for m in body["months"]] == [11, 12, 1]
    assert body["totals"]["voyages"] >= 3


def test_plants_endpoint():
    plants = client.get("/api/plants").json()["plants"]
    assert len(plants) == 5 and all("days_of_cover" in p for p in plants)


def test_alerts_endpoint_thresholds_are_adjustable(monkeypatch):
    _no_network(monkeypatch)
    default = client.get("/api/alerts", params={"port": "Paradip", "include_market": False}).json()
    assert any(a["category"] == "weather" for a in default["alerts"])
    relaxed = client.get("/api/alerts", params={"port": "Paradip", "include_market": False, "wave_m": 3.5}).json()
    assert not any(a["category"] == "weather" for a in relaxed["alerts"])


def test_idle_endpoint(monkeypatch, reference):
    _no_network(monkeypatch)
    body = client.post("/api/scenario/idle", json={"cargo_tonnes": 75000, "month": 9, "origin": reference["origins"][0], "plant_name": reference["plants"][0]}).json()
    assert body["result"]["baseline"]["expected_idle_days"] >= 0


def test_charter_plan_shape(reference):
    body = client.post("/api/charter-plan", json={
        "plant_name": reference["plants"][0], "origin": reference["origins"][0],
        "start_month": 10, "monthly_cargo_tonnes": 75000, "duration_months": 6,
    }).json()
    rec = body["recommendation"]
    assert rec["basis"] == "contract"
    assert rec["top"]["vessel_class"] == body["schedule"]["contract_vessel_class"]
    assert rec["total_voyages"] == body["schedule"]["totals"]["voyages"]
    assert "stockout_before_arrival" in body["plant"]
    # Next best is never cheaper than the recommendation over the contract.
    assert all(a["usd_per_tonne_over_contract"] >= rec["usd_per_tonne_over_contract"] for a in rec["alternatives"])


@pytest.mark.parametrize("duration", [0, 3, 12])
def test_charter_plan_prices_hire_like_timing(reference, duration):
    """The recommendation's hire per voyage equals the timing block's
    all-contract hire per voyage: one market rate everywhere."""
    body = client.post("/api/charter-plan", json={
        "plant_name": reference["plants"][0], "origin": reference["origins"][0],
        "start_month": 10, "monthly_cargo_tonnes": 75000, "duration_months": duration,
    }).json()
    top = body["recommendation"]["top"]
    contract = body["timing"]["contract"]
    per_voyage_engine = (top["hire_cost_usd"] + top["waiting_hire_usd"]) / top["n_voyages"]
    per_voyage_timing = contract["cost_comparison"][2]["estimated_hire_cost_usd"] / contract["n_voyages"]
    assert per_voyage_engine == pytest.approx(per_voyage_timing, rel=2e-3)
    assert top["hire_rate_usd_per_day"] == body["timing"]["current_rate"]
    if duration == 0:
        assert body["recommendation"]["basis"] == "single"
        assert body["schedule"] is None


def test_charter_plan_single_alternatives_not_cheaper(reference):
    body = client.post("/api/charter-plan", json={
        "plant_name": reference["plants"][0], "origin": reference["origins"][0],
        "start_month": 3, "monthly_cargo_tonnes": 75000, "duration_months": 0,
    }).json()
    top = body["recommendation"]["top"]
    assert all(a["usd_per_tonne"] >= top["usd_per_tonne"] for a in body["recommendation"]["alternatives"])


def test_charter_plan_fix_by_date(reference):
    body = client.post("/api/charter-plan", json={
        "plant_name": "Bokaro Steel Plant", "origin": reference["origins"][0],
        "start_month": 1, "monthly_cargo_tonnes": 75000, "duration_months": 0,
    }).json()
    plant = body["plant"]
    if plant["days_to_fix"] >= 0:
        assert plant["fix_by_date"] is not None
    else:
        assert plant["fix_by_date"] is None and plant["stockout_before_arrival"]


@pytest.mark.parametrize("path", ["/api/rank", "/api/scenario/wait", "/api/plan", "/api/scenario/idle"])
def test_unknown_origin_or_plant_is_400(reference, path):
    good = {"cargo_tonnes": 75000, "month": 9, "origin": reference["origins"][0], "plant_name": reference["plants"][0]}
    assert client.post(path, json={**good, "origin": "Atlantis"}).status_code == 400
    assert client.post(path, json={**good, "plant_name": "Nowhere Steel"}).status_code == 400


def test_exclude_port_validates_and_drops_dependent_anchorage(reference):
    body = {"cargo_tonnes": 75000, "month": 1, "origin": reference["origins"][0], "plant_name": reference["plants"][0]}
    assert client.post("/api/scenario/exclude-port", params={"excluded_port": "Atlantis"}, json=body).status_code == 400
    ranked = client.post("/api/scenario/exclude-port", params={"excluded_port": "Haldia"}, json=body).json()["ranked"]
    assert ranked and not {"Haldia", "Sagar-Sandheads"} & {r["port"] for r in ranked}


def test_wait_scenario_shape(reference):
    rows = client.post("/api/scenario/wait", json={
        "cargo_tonnes": 75000, "month": 9, "origin": reference["origins"][0], "plant_name": reference["plants"][0],
    }).json()["wait_scenarios"]
    assert [r["wait_days"] for r in rows] == [0, 3, 7, 14]
    assert all(b["total_usd"] > a["total_usd"] for a, b in zip(rows, rows[1:]))


def test_plan_reports_infeasible_instead_of_zero(reference):
    body = client.post("/api/plan", json={
        "cargo_tonnes": 1_000_000, "month": 1, "origin": reference["origins"][0], "plant_name": reference["plants"][0],
        "n_shipments": 3, "max_calls_per_port_month": 2,
    }).json()
    assert body["status"] == "infeasible"
    assert body["total_cost_usd"] is None and body["reason"]


def test_plan_respects_port_calls(reference):
    body = client.post("/api/plan", json={
        "cargo_tonnes": 75000, "month": 1, "origin": reference["origins"][0], "plant_name": reference["plants"][0],
        "n_shipments": 5, "max_calls_per_port_month": 2,
    }).json()
    assert body["status"] == "planned"
    calls: dict[str, int] = {}
    for a in body["assignments"]:
        calls[a["port"]] = calls.get(a["port"], 0) + a["n_voyages"]
    assert max(calls.values()) <= 2


def test_contract_split_rejects_zero_rate():
    body = {"cargo_tonnes": 75000, "current_rate": 0, "forecast_point": 1, "forecast_lower": 0, "forecast_upper": 2}
    assert client.post("/api/scenario/contract-split", json=body).status_code == 422


def test_backtest_horizon_bounds():
    assert client.get("/api/backtest", params={"horizon": 0}).status_code == 422
    assert client.get("/api/backtest", params={"horizon": 27}).status_code == 422


def test_ports_map_shape():
    ports = client.get("/api/ports/map").json()["ports"]
    assert len(ports) == 7
    sandheads = next(p for p in ports if p["name"] == "Sagar-Sandheads")
    assert sandheads["rail_via_port"] == "Haldia" and sandheads["port_type"] == "anchorage_transshipment"


def test_alerts_weather_status(monkeypatch):
    monkeypatch.setattr(main_module, "_weather", lambda d: {**FAKE_WEATHER, "Haldia": {"error": "timeout"}})
    assert client.get("/api/alerts", params={"include_market": False}).json()["sources"]["weather"] == "partial"
    monkeypatch.setattr(main_module, "_weather", lambda d: {p: {"error": "timeout"} for p in FAKE_WEATHER})
    body = client.get("/api/alerts", params={"include_market": False}).json()
    assert body["sources"]["weather"] == "unavailable"
    assert any(a["id"] == "weather-unavailable" for a in body["alerts"])


def test_alerts_carry_structured_fields(monkeypatch):
    _no_network(monkeypatch)
    alerts = client.get("/api/alerts", params={"include_market": True, "vessel_class": "Panamax"}).json()["alerts"]
    kinds = {a["kind"] for a in alerts}
    assert "rough_sea" in kinds
    rough = next(a for a in alerts if a["kind"] == "rough_sea")
    assert rough["days_over"] >= 1 and rough["days_total"] == 2 and rough["peak_date"]
    for a in alerts:
        if a["kind"] == "long_wait":
            assert a["wait_min_days"] <= a["wait_max_days"]
        if a["kind"] == "rate_move":
            assert a["direction"] in ("up", "down")


def test_drivers_endpoint():
    drivers = client.get("/api/drivers").json()["drivers"]
    assert {d["key"] for d in drivers} == {"coal_au", "brent", "usd_inr"}
    for d in drivers:
        assert d["latest"]["value"] > 0 and len(d["history"]) > 12
        assert d["history"][-1]["date"] == d["latest"]["date"]


def test_backtest_includes_driver_model():
    names = {m["model"] for m in client.get("/api/backtest", params={"horizon": 8, "vessel_class": "Handysize"}).json()["models"]}
    assert {"arima", "gbrt", "gbrt_drivers"} <= names


def test_load_ports_endpoint():
    rows = client.get("/api/load-ports").json()["load_ports"]
    assert len(rows) == 6
    assert all(r["activity_port"] and r["recent_calls_per_day"] is not None for r in rows)


def test_port_history_endpoint():
    body = client.get("/api/ports/Dhamra/history", params={"weeks": 52}).json()
    assert len(body["weeks"]) == 52 and body["average_calls_per_week"] > 0
    assert client.get("/api/ports/Hay Point/history").json()["weeks"]
    assert client.get("/api/ports/Gangavaram/history").json()["weeks"] == []
    assert client.get("/api/ports/Atlantis/history").status_code == 404


def test_alerts_include_loading_port(monkeypatch, reference):
    _no_network(monkeypatch)
    body = client.get("/api/alerts", params={"include_market": False, "origin": reference["origins"][0], "activity_pct": 1}).json()
    assert all(a["scope"] in ("discharge", "load") for a in body["alerts"])
    assert client.get("/api/alerts", params={"origin": "Atlantis"}).status_code == 400


def test_plan_capacity_scaled_by_traffic(reference):
    body = client.post("/api/plan", json={
        "cargo_tonnes": 75000, "month": 1, "origin": reference["origins"][0], "plant_name": reference["plants"][0],
        "n_shipments": 5, "max_calls_per_port_month": 2, "capacity_basis": "traffic",
    }).json()
    caps = body["capacities"]
    assert caps["Visakhapatnam"] > caps["Dhamra"]  # Vizag handles about three times Dhamra's dry-bulk calls
    assert caps["Gangavaram"] == 2  # no traffic data: the slider value


def test_reference_has_ship_particulars(reference):
    classes = reference["vessel_classes"]
    assert len(classes) == 5
    for v in classes:
        assert v["loa_m"] > 0 and v["beam_m"] > 0 and v["draft_laden_m"] > 0
        assert v["depth_m"] > v["draft_laden_m"]
        assert v["holds"] > 0 and v["cranes"] >= 0
    capesize = next(v for v in classes if v["name"] == "Capesize")
    assert capesize["cranes"] == 0 and capesize["holds"] == 9


def test_feasibility_rows_carry_draft_limit(reference):
    body = client.post("/api/rank", json={"cargo_tonnes": 75000, "month": 7, "origin": reference["origins"][0], "plant_name": reference["plants"][0]}).json()
    assert all("draft_limit_m" in f for f in body["feasibility"])


def test_public_routes_cover_every_origin_and_port_without_sign_in():
    from tests.auth_helpers import new_client

    r = new_client().get("/api/public/routes")
    assert r.status_code == 200
    body = r.json()
    assert len(body["routes"]) == len(body["load_ports"]) * len(body["ports"])
    assert all(len(route["coords"]) >= 2 and route["nm"] > 500 for route in body["routes"])


def test_route_for_a_voyage_uses_the_planning_transit_time():
    r = client.get("/api/routes", params={"origin": "Australia (Hay Point/Dalrymple Bay)", "port": "Paradip"})
    assert r.status_code == 200
    body = r.json()
    assert body["transit_days"] == 17
    assert body["load_port"]["name"] == "Dalrymple Bay Coal Terminal"
    assert abs(body["coords"][0][0] - body["load_port"]["lon"]) < 1
    assert client.get("/api/routes", params={"origin": "Nowhere", "port": "Paradip"}).status_code == 404


def test_forecast_work_is_cached_on_disk_by_its_inputs(tmp_path, monkeypatch):
    from backend import main

    monkeypatch.setattr(main, "FORECAST_CACHE", tmp_path)
    calls = []
    compute = lambda: calls.append(1) or {"model": "arima"}  # noqa: E731
    assert main._disk_cached("backtest", "Panamax", (12, "2026-09-20"), compute) == {"model": "arima"}
    # A second server process (or a restart) reads it back instead of recomputing.
    assert main._disk_cached("backtest", "Panamax", (12, "2026-09-20"), compute) == {"model": "arima"}
    assert len(calls) == 1 and len(list(tmp_path.glob("backtest-panamax-*.json"))) == 1
    # Different inputs are a different entry.
    main._disk_cached("backtest", "Panamax", (26, "2026-09-20"), compute)
    assert len(calls) == 2
