from src.multi_shipment import Shipment, plan_shipments


def _five_shipments(origin, plant_name):
    return [Shipment(f"S{i}", 75000, 9, origin, plant_name) for i in range(1, 6)]


def test_five_shipments_cap_two_naive_breaches_capacity(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    """All 5 shipments independently pick the same cheapest port (Dhamra) at
    this cargo size/month, which breaches a cap of 2 - the exact scenario
    joint optimization exists to prevent."""
    result = plan_shipments(
        _five_shipments(default_origin, default_plant), ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions,
        max_calls_per_port_month=2,
    )
    assert not result.naive_capacity_violations.empty
    assert (result.naive_capacity_violations["calls_assigned"] > result.naive_capacity_violations["cap"]).all()


def test_optimized_plan_never_exceeds_capacity_cap(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    cap = 2
    result = plan_shipments(
        _five_shipments(default_origin, default_plant), ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions,
        max_calls_per_port_month=cap,
    )
    counts = result.assignments.groupby(["port", "month"]).size()
    assert (counts <= cap).all()
    assert result.solver_status in ("OPTIMAL", "FEASIBLE")


def test_optimized_plan_assigns_every_shipment(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    shipments = _five_shipments(default_origin, default_plant)
    result = plan_shipments(
        shipments, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, max_calls_per_port_month=2,
    )
    assert len(result.assignments) == len(shipments)
    assert set(result.assignments["shipment_id"]) == {s.shipment_id for s in shipments}


def test_optimized_plan_cost_gte_naive_when_naive_is_infeasible(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    """A constrained-feasible plan can never beat the unconstrained argmin
    on cost - it can only match or exceed it."""
    result = plan_shipments(
        _five_shipments(default_origin, default_plant), ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions,
        max_calls_per_port_month=2,
    )
    assert result.total_cost_usd >= result.naive_total_cost_usd


def test_relaxed_cap_lets_optimized_match_naive(ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, default_origin, default_plant):
    """With a cap of 5 (>= shipment count), every shipment can take the
    naive cheapest option, so optimized cost should equal naive cost."""
    shipments = _five_shipments(default_origin, default_plant)
    result = plan_shipments(
        shipments, ports_df, vessels_df, rail_df, origin_transit_df, cost_assumptions, max_calls_per_port_month=5,
    )
    assert result.naive_capacity_violations.empty
    assert result.total_cost_usd == result.naive_total_cost_usd
