export interface VesselClassInfo {
  name: string;
  dwt_min: number;
  dwt_max: number;
  payload_tonnes: number;
  freight_series_class: string;
  loa_m: number;
  beam_m: number;
  draft_laden_m: number;
  depth_m: number | null;
  holds: number;
  cranes: number;
  tpc_t_per_cm: number | null;
  crane_swl_t: number | null;
  hatch_cover_type: "folding" | "side_rolling" | null;
  block_coefficient: number | null;
}

export interface ReferenceData {
  ports: string[];
  plants: string[];
  origins: string[];
  months: { value: number; label: string }[];
  vessel_classes: VesselClassInfo[];
  freight_series_classes: string[];
  durations: { value: number; label: string }[];
  coal_grades: { value: CoalGrade; label: string }[];
  /** Grades each origin ships. */
  origin_grades: Record<string, CoalGrade[]>;
}

export type CoalGrade = "hard_coking" | "semi_soft" | "pci";

export interface RankedRow {
  rank: number;
  port: string;
  vessel_class: string;
  usd_per_tonne: number;
  total_usd: number;
  expected_wait_days: number;
  weather_days: number;
  transit_days: number;
  rail_transit_days: number;
  hire_cost_usd: number;
  waiting_hire_usd: number;
  transfer_cost_usd: number;
  port_charges_usd: number;
  rail_cost_usd: number;
  transshipment_cost_usd: number;
  n_voyages: number;
  payload_tonnes: number;
  vessel_fill_pct: number;
  berth_days: number;
  load_days: number;
  transshipment_days: number;
  total_lead_days: number;
  hire_rate_usd_per_day: number;
  part_loaded: boolean;
  /** Fuel the charterer buys (VLSFO, priced from Brent). */
  bunker_cost_usd: number;
  bunker_tonnes: number;
  /** Days queued at the loading terminal. */
  load_wait_days: number;
  /** Sea-route length over real shipping lanes. */
  route_nm: number | null;
  discharge_rate_tpd: number | null;
  /** Tonnes actually shipped (within the more-or-less tolerance). */
  cargo_shipped_tonnes: number;
  reason: string;
}

export interface FeasibilityRow {
  port_id: number;
  port_name: string;
  vessel_class: string;
  feasible: boolean;
  part_loaded: boolean;
  usable_draft_m: number;
  draft_limit_m: number | null;
  reasons_failed: string;
  avg_wait_days_min: number;
  avg_wait_days_max: number;
}

export interface RankResponse {
  ranked: RankedRow[];
  feasibility: FeasibilityRow[];
}

export interface ForecastPoint {
  date: string;
  forecast: number;
  lower: number;
  upper: number;
}

export interface ForecastResponse {
  vessel_class: string;
  series_class: string;
  as_of: string;
  history: { date: string; actual: number }[];
  forecast: ForecastPoint[];
  current_rate: number;
  /** Which model made the forecast: the better of ARIMA and gradient boosting with coal, oil and rupee. */
  model: "arima" | "gbrt_drivers";
  model_label: string;
  /** What's behind the forecast: the series' momentum, season and level; the drivers model's reliance on each input. */
  explain: {
    factors: {
      horizon_weeks: number;
      momentum_4w_pct: number;
      momentum_12w_pct: number;
      seasonal_pct: number | null;
      seasonal_years: number;
      vs_3y_median_pct: number;
      forecast_change_pct: number;
    };
    importance: { input: string; share_pct: number }[] | null;
  };
}

export interface BacktestModelRow {
  model: string;
  n_splits: number;
  mean_mase: number;
  mean_directional_accuracy: number;
}

export interface BacktestResponse {
  vessel_class: string;
  series_class: string;
  models: BacktestModelRow[];
}

export interface PortWeather {
  dates?: string[];
  wave_height_max_m?: number[];
  wind_wave_height_max_m?: number[];
  error?: string;
}

export interface WeatherResponse {
  ports: Record<string, PortWeather>;
}

export interface WaitScenarioRow {
  wait_days: number;
  usd_per_tonne: number;
  total_usd: number;
  waiting_hire_usd: number;
  n_voyages: number;
}

export interface CostComparisonRow {
  strategy: string;
  contract_pct: number;
  estimated_hire_cost_usd: number;
  estimated_hire_cost_usd_per_tonne: number;
}

export interface ContractSplit {
  contract_pct: number;
  spot_pct: number;
  expected_change_pct: number;
  band_width_pct: number;
  n_voyages: number;
  cost_comparison: CostComparisonRow[];
}

export interface FixWindow {
  week_index: number;
  date: string;
  expected_rate: number;
  lower: number;
  upper: number;
  saving_vs_now_pct: number;
}

export type FixSignal = "fix_now" | "wait" | "stagger";

export interface TimingResponse {
  vessel_class: string;
  series_class: string;
  duration_months: number;
  window_weeks: number;
  current_rate: number;
  as_of: string;
  forecast: ForecastPoint[];
  best_fix: FixWindow;
  signal: FixSignal;
  signal_reason: string;
  contract: ContractSplit;
}

export interface ScheduleMonth {
  month: number;
  month_label: string;
  port: string | null;
  vessel_class?: string;
  n_voyages?: number;
  usd_per_tonne?: number;
  total_usd?: number;
  expected_wait_days?: number;
  monsoon?: boolean;
  unconstrained_best?: { port: string; vessel_class: string; usd_per_tonne: number; total_usd: number } | null;
  /** The same month's voyages fixed on the spot market at the forecast rate. */
  spot_total_usd?: number | null;
  note: string | null;
}

export interface ScheduleResponse {
  contract_vessel_class: string | null;
  months: ScheduleMonth[];
  totals: {
    contract_total_usd: number;
    unconstrained_total_usd: number;
    flexibility_cost_usd: number;
    spot_total_usd: number | null;
    voyages: number;
    cargo_tonnes: number;
  };
  note: string | null;
}

export interface PlantCover {
  name: string;
  monthly_demand_tonnes: number;
  current_inventory_tonnes: number;
  daily_consumption_tonnes: number;
  days_of_cover: number | null;
  buffer_days_target: number;
  cover_gap_days: number | null;
  status: "ok" | "below_buffer" | "critical";
  tonnes_to_buffer: number;
  /** "yours" when the planner entered the plant's stock, else the reference figure. */
  stock_source?: "yours" | "reference";
  stock_updated_at?: string | null;
}

export type AlertKind = "rough_sea" | "long_wait" | "busy" | "rate_range" | "rate_move" | "notice" | "weather_unavailable";

export interface Alert {
  id: string;
  category: "weather" | "congestion" | "market" | "disruption" | "data";
  kind: AlertKind;
  severity: "high" | "medium" | "info";
  scope: "discharge" | "load";
  port: string | null;
  vessel_class: string | null;
  title: string;
  message: string;
  value: number | null;
  threshold: number | null;
  unit: string | null;
  date: string | null;
  days_over: number | null;
  days_total: number | null;
  peak_date: string | null;
  direction: "up" | "down" | null;
  wait_min_days?: number;
  wait_max_days?: number;
  recent_calls_per_day?: number;
  baseline_calls_per_day?: number;
}

export interface AlertsResponse {
  alerts: Alert[];
  sources: { weather: "live" | "partial" | "unavailable" };
}

export interface IdleOption {
  option_type: "current" | "port" | "vessel_class" | "month";
  description: string;
  port: string;
  vessel_class: string;
  month: number;
  n_voyages: number;
  expected_idle_days: number;
  idle_cost_usd: number;
  usd_per_tonne: number;
  total_usd: number;
  idle_days_saved?: number;
  delta_vs_baseline_usd?: number;
}

export interface IdleResponse {
  result: {
    baseline: IdleOption & {
      weather_delay_days: number;
      weather_basis: "forecast" | "seasonal";
      expected_wait_days: number;
      idle_cost_usd_per_tonne: number;
    };
    alternatives: IdleOption[];
  } | null;
  weather: "live" | "partial" | "unavailable" | "not used";
}

export type AlternativeRow = RankedRow & { usd_per_tonne_over_contract: number };

export interface CharterPlanResponse {
  /** The laycan used (its next occurrence), ISO dates. */
  laycan: { start: string; end: string };
  recommendation: {
    basis: "single" | "contract";
    top: RankedRow;
    alternatives: AlternativeRow[];
    cheapest_single: RankedRow | null;
    total_usd_over_contract: number;
    usd_per_tonne_over_contract: number;
    total_voyages: number;
    note: string | null;
  } | null;
  schedule: ScheduleResponse | null;
  timing: TimingResponse | null;
  /** Sailing slower to meet the berth instead of waiting at anchor, per shipment; null when the queue is short. */
  virtual_arrival: {
    speed_knots: number;
    service_speed_knots: number;
    anchorage_days_avoided: number;
    fuel_saved_t: number;
    fuel_saved_usd: number;
    co2_saved_t: number;
  } | null;
  plant:
    | (PlantCover & {
        arrival_in_days: number;
        lead_days: number;
        days_until_laycan: number;
        stockout_before_arrival: boolean;
        days_short: number | null;
        days_to_fix: number | null;
        fix_by_date: string | null;
        fastest_option: RankedRow | null;
      })
    | null;
}

export interface PlanAssignment {
  shipment_id: string;
  port: string;
  vessel_class: string;
  month: number;
  n_voyages: number;
  usd_per_tonne: number;
  total_usd: number;
}

export interface PlanResponse {
  status: "planned" | "infeasible" | "no_options";
  reason: string | null;
  assignments: PlanAssignment[];
  total_cost_usd: number | null;
  naive_total_cost_usd: number;
  naive_capacity_violations: { port: string; month: number; calls_assigned: number; cap: number }[];
  solver_status: string;
  unplanned: string[];
  capacities: Record<string, number>;
}

export interface LoadPort {
  origin: string;
  load_port: string | null;
  activity_port: string | null;
  transit_days: number;
  max_draft_m: number | null;
  max_loa_m: number | null;
  max_beam_m: number | null;
  max_dwt: number | null;
  load_rate_tpd: number | null;
  recent_calls_per_day: number | null;
  baseline_calls_per_day: number | null;
  activity_vs_normal_pct: number | null;
  activity_as_of: string | null;
}

export interface PortHistory {
  port: string;
  weeks: { date: string; calls: number }[];
  average_calls_per_week?: number;
}

export interface PortMapEntry {
  name: string;
  latitude: number;
  longitude: number;
  max_draft_m: number;
  monsoon_draft_reduction_m: number;
  monsoon_months: number[];
  monsoon_closed: boolean;
  weather_delay_days_monsoon: number | null;
  loa_max_m: number | null;
  beam_max_m: number | null;
  avg_wait_days_min: number;
  avg_wait_days_max: number;
  vessel_classes_allowed: string[];
  discharge_rate_tpd: number | null;
  port_type: "berth" | "anchorage_transshipment";
  rail_via_port: string | null;
  transshipment_days: number | null;
  real_avg_dry_bulk_calls_per_day: number | null;
  recent_calls_per_day: number | null;
  baseline_calls_per_day: number | null;
  activity_vs_normal_pct: number | null;
  activity_as_of: string | null;
  handling_type: "grab_unloaders" | "mobile_harbour_cranes" | "floating_cranes" | null;
  shore_equipment: string | null;
}

export interface PortsMapResponse {
  ports: PortMapEntry[];
}

export interface DriverSeries {
  key: "coal_au" | "brent" | "usd_inr";
  label: string;
  unit: string;
  frequency: "monthly" | "weekly";
  source: string;
  latest: { date: string; value: number };
  change_3m_pct: number | null;
  change_12m_pct: number | null;
  history: { date: string; value: number }[];
}

export interface DriversResponse {
  drivers: DriverSeries[];
}

export interface RouteFreightRange {
  point: number;
  lower: number;
  upper: number;
}

export interface RouteFreightRow {
  origin: string;
  port: string;
  route_nm: number | null;
  transit_days: number;
  n_voyages: number;
  part_loaded: boolean;
  now: number;
  week_4?: RouteFreightRange;
  week_12?: RouteFreightRange;
  week_26?: RouteFreightRange;
}

export interface RouteFreightResponse {
  vessel_class: string;
  month: number;
  cargo_tonnes: number;
  model: string;
  model_label: string;
  as_of: string;
  routes: RouteFreightRow[];
}

export interface RouteSeriesResponse {
  vessel_class: string;
  origin: string;
  port: string;
  model_label: string;
  history: { date: string; usd_per_tonne: number }[];
  forecast: { date: string; usd_per_tonne: number; lower: number; upper: number }[];
}

export interface EmploymentOption {
  option: "wait" | "sublet" | "backhaul";
  days: number;
  net_cost_usd: number;
  revenue_usd: number;
  late_days: number;
  saving_vs_wait_usd: number;
  detail: Record<string, number | string>;
}

export interface EmploymentResponse {
  vessel_class: string;
  port: string;
  origin: string;
  idle_days: number;
  idle_days_source: "input" | "stock" | "default";
  window_days: number;
  options: EmploymentOption[] | null;
  best: "wait" | "sublet" | "backhaul";
  periods: {
    stock_spare_days: number | null;
    monsoon_months: number[];
    port_closed_in_monsoon: boolean;
    strong_market_weeks: { date: string; rate_usd_per_day: number }[];
  } | null;
}

export interface DisruptionNotice {
  id: number;
  port: string;
  start_date: string;
  end_date: string;
  title: string;
  severity: "high" | "medium";
  source: string;
}
