"""SIH26006 coverage: freight by trade route, alternative employment for idle
ships, cargo-handling capability, bunkers from Brent, route transit, fixture
terms (tolerance, grade, laycan, fixed choices), own plant stock and notices."""
import pytest

from src.cost_engine import discharge_rate_for
from src.data_loader import load_cost_assumptions, load_ports, load_vessel_classes, route_distance_nm
from tests.auth_helpers import HEADERS, PASSWORD, new_client, signed_in_client

client = signed_in_client()
AUS = "Australia (Hay Point/Dalrymple Bay)"
BODY = {"cargo_tonnes": 75000, "month": 10, "origin": AUS, "plant_name": "Bhilai Steel Plant"}


def test_geared_ships_discharge_faster_where_the_port_uses_mobile_cranes():
    ports = load_ports().set_index("name")
    vessels = load_vessel_classes().set_index("vessel_class")
    ca = load_cost_assumptions()
    paradip = ports.loc["Paradip"].copy()
    paradip["name"] = "Paradip"
    supramax = vessels.loc["Supramax"].copy()
    panamax = vessels.loc["Panamax"].copy()
    assert discharge_rate_for(supramax, paradip, ca) > discharge_rate_for(panamax, paradip, ca)
    # At a grab-unloader berth the ship's own cranes don't add anything.
    dhamra = ports.loc["Dhamra"].copy()
    assert discharge_rate_for(supramax, dhamra, ca) == discharge_rate_for(panamax, dhamra, ca)


def test_every_port_records_its_unloading_equipment():
    ports = load_ports()
    assert ports["handling_type"].notna().all() and ports["handling_source"].str.len().gt(10).all()


def test_transit_follows_each_routes_own_distance():
    ranked = client.post("/api/rank", json=BODY).json()["ranked"]
    by_port = {r["port"]: r for r in ranked}
    for port, row in by_port.items():
        nm = route_distance_nm(AUS, port)
        assert row["route_nm"] == nm
        assert row["transit_days"] == pytest.approx(nm / (13.5 * 24), abs=0.06)


def test_landed_cost_includes_bunkers():
    top = client.post("/api/rank", json=BODY).json()["ranked"][0]
    assert top["bunker_cost_usd"] > 0 and top["bunker_tonnes"] > 0


def test_tolerance_can_save_a_voyage():
    tight = client.post("/api/rank", json={**BODY, "cargo_tonnes": 78000}).json()["ranked"]
    loose = client.post("/api/rank", json={**BODY, "cargo_tonnes": 78000, "tolerance_pct": 10}).json()["ranked"]
    key = lambda r: (r["port"], r["vessel_class"])
    tight_by = {key(r): r for r in tight}
    assert any(r["n_voyages"] < tight_by[key(r)]["n_voyages"] for r in loose if key(r) in tight_by)


def test_coal_grade_must_be_shipped_from_the_origin():
    assert client.post("/api/rank", json={**BODY, "coal_grade": "hard_coking"}).status_code == 200
    r = client.post("/api/rank", json={**BODY, "origin": "Indonesia (Kalimantan/Tanjung Bara)", "coal_grade": "hard_coking"})
    assert r.status_code == 400


def test_plan_can_fix_the_port_and_uses_the_laycan():
    body = client.post("/api/charter-plan", json={
        "plant_name": "Bhilai Steel Plant", "origin": AUS, "start_month": 10, "monthly_cargo_tonnes": 75000,
        "port": "Paradip", "laycan_start_day": 10, "laycan_end_day": 20,
    }).json()
    assert body["recommendation"]["top"]["port"] == "Paradip"
    assert body["laycan"]["start"] <= body["laycan"]["end"]
    assert body["plant"]["arrival_in_days"] >= body["plant"]["lead_days"]


def test_contract_months_show_the_spot_alternative():
    body = client.post("/api/charter-plan", json={
        "plant_name": "Bhilai Steel Plant", "origin": AUS, "start_month": 10, "monthly_cargo_tonnes": 75000, "duration_months": 3,
    }).json()
    months = body["schedule"]["months"]
    assert all(m["spot_total_usd"] is not None for m in months)
    # Month 0 is fixed now, so spot equals the contract cost that month.
    assert months[0]["spot_total_usd"] == pytest.approx(months[0]["total_usd"], rel=1e-6)


def test_forecast_names_its_model():
    body = client.get("/api/forecast", params={"vessel_class": "Handysize"}).json()
    assert body["model"] in ("arima", "gbrt_drivers") and body["model_label"]


def test_route_freight_ranks_routes_and_forecasts_them():
    body = client.get("/api/route-freight", params={"vessel_class": "Panamax"}).json()
    routes = body["routes"]
    assert len(routes) > 5 and routes == sorted(routes, key=lambda r: r["now"])
    first = routes[0]
    assert first["week_12"]["lower"] <= first["week_12"]["point"] <= first["week_12"]["upper"]
    series = client.get("/api/route-freight/series", params={"vessel_class": "Panamax", "origin": first["origin"], "port": first["port"]}).json()
    assert series["history"] and series["forecast"]


def test_alternative_employment_compares_wait_sublet_and_backhaul():
    body = client.post("/api/scenario/employment", json={**BODY, "idle_days": 20}).json()
    kinds = {o["option"] for o in body["options"]}
    assert {"wait", "sublet"} <= kinds
    wait = next(o for o in body["options"] if o["option"] == "wait")
    sublet = next(o for o in body["options"] if o["option"] == "sublet")
    assert sublet["net_cost_usd"] < wait["net_cost_usd"]
    assert body["best"] in kinds
    assert "strong_market_weeks" in body["periods"]


def test_planner_can_enter_their_own_plant_stock():
    c = signed_in_client()
    before = next(p for p in c.get("/api/plants").json()["plants"] if p["name"] == "Bhilai Steel Plant")
    r = c.put("/api/plants/stock", json={"plant_name": "Bhilai Steel Plant", "tonnes": 10000})
    mine = next(p for p in r.json()["plants"] if p["name"] == "Bhilai Steel Plant")
    assert mine["current_inventory_tonnes"] == 10000 and mine["stock_source"] == "yours"
    assert mine["days_of_cover"] < before["days_of_cover"]
    # Other planners still see the reference figure.
    other = next(p for p in client.get("/api/plants").json()["plants"] if p["name"] == "Bhilai Steel Plant")
    assert other["stock_source"] == "reference"
    cleared = c.put("/api/plants/stock", json={"plant_name": "Bhilai Steel Plant", "tonnes": None}).json()["plants"]
    assert next(p for p in cleared if p["name"] == "Bhilai Steel Plant")["stock_source"] == "reference"


def test_only_developers_add_notices_and_they_raise_alerts():
    notice = {"port": "Paradip", "start_date": "2026-01-01", "end_date": "2099-01-01", "title": "Berth 5 closed for dredging", "severity": "high"}
    assert client.post("/api/notices", json=notice).status_code == 403
    dev = new_client()
    import secrets

    email = f"dev-{secrets.token_hex(3)}@example.com"
    dev.post("/api/auth/signup", json={"name": "Dev", "email": email, "password": PASSWORD, "accept_privacy": True, "accept_terms": True, "developer_code": "test-dev-code"})
    dev.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    created = dev.post("/api/notices", json=notice)
    assert created.status_code == 200
    alerts = client.get("/api/alerts", params={"port": "Paradip", "include_market": False}).json()["alerts"]
    assert any(a["kind"] == "notice" and "dredging" in a["title"] for a in alerts)
    assert dev.delete(f"/api/notices/{created.json()['id']}").status_code == 200


def test_backend_rejects_absurd_inputs():
    assert client.post("/api/rank", json={**BODY, "cargo_tonnes": 1e12}).status_code == 422
    assert client.get("/api/alerts", params={"port": "Atlantis"}).status_code == 400


def test_post_panamax_forecast_is_the_panamax_index_times_its_premium():
    base = client.get("/api/forecast", params={"vessel_class": "Panamax", "horizon": 4}).json()
    pp = client.get("/api/forecast", params={"vessel_class": "Post-Panamax", "horizon": 4}).json()
    premium = pp["premium"]
    assert premium > 1 and pp["series_class"] == "Panamax"
    assert pp["current_rate"] == pytest.approx(base["current_rate"] * premium, rel=1e-3)
    assert pp["forecast"][0]["forecast"] == pytest.approx(base["forecast"][0]["forecast"] * premium, rel=1e-3)


def test_validation_errors_name_the_field():
    r = client.post("/api/rank", json={**BODY, "cargo_tonnes": -5})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"][-1] == "cargo_tonnes"


def test_public_ports_give_live_sea_state_and_activity_per_discharge_port():
    body = new_client().get("/api/public/ports").json()
    names = {p["name"] for p in body["ports"]}
    assert "Paradip" in names and len(names) == 7
    assert body["weather"] in {"live", "partial", "unavailable"}
    for p in body["ports"]:
        assert set(p) == {"name", "dates", "wave_height_max_m", "activity_vs_normal_pct"}


def test_stress_test_moves_costs_the_right_way_and_can_change_the_choice():
    base = client.post("/api/stress", json=BODY).json()
    assert base["changed"] is False and base["same_option"]["usd_per_tonne"] == base["baseline"]["usd_per_tonne"]
    dearer = client.post("/api/stress", json={**BODY, "freight_change_pct": 50, "bunker_change_pct": 30, "extra_wait_days": 5}).json()
    assert dearer["same_option"]["usd_per_tonne"] > base["baseline"]["usd_per_tonne"]
    assert dearer["same_option"]["hire_rate_usd_per_day"] > base["baseline"]["hire_rate_usd_per_day"]
    assert dearer["same_option"]["waiting_hire_usd"] > base["baseline"]["waiting_hire_usd"]
    # Closing the recommended port forces another choice.
    shut = client.post("/api/stress", json={**BODY, "closed_port": base["baseline"]["port"]}).json()
    assert shut["same_option"] is None and shut["changed"] is True
    assert all(o["port"] != base["baseline"]["port"] for o in shut["options"])
    assert client.post("/api/stress", json={**BODY, "freight_change_pct": 500}).status_code == 422
