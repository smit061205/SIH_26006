import type {
  LoadPort,
  PortHistory,
  DriversResponse,
  AlertsResponse,
  BacktestResponse,
  CharterPlanResponse,
  CoalGrade,
  DisruptionNotice,
  EmploymentResponse,
  ForecastResponse,
  IdleResponse,
  PlanResponse,
  PlantCover,
  PortsMapResponse,
  RankedRow,
  RankResponse,
  ReferenceData,
  RouteFreightResponse,
  RouteSeriesResponse,
  TimingResponse,
  WaitScenarioRow,
  WeatherResponse,
} from "./types";

// In development the API runs on its own port; in production it's served from the same origin
// (the host rewrites /api/* to the backend), so session cookies stay first-party.
export const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:8000" : "");

export interface ShipmentRequest {
  cargo_tonnes: number;
  month: number;
  origin: string;
  plant_name: string;
  /** More-or-less quantity, percent. */
  tolerance_pct?: number;
  coal_grade?: CoalGrade | null;
}

/** An API error with the server's own message (shown on the auth forms). */
export class ApiError extends Error {
  status: number;
  /** No answer in time: the server is busy or waking up. Not retried automatically. */
  timedOut: boolean;
  constructor(status: number, message: string, timedOut = false) {
    super(message);
    this.status = status;
    this.timedOut = timedOut;
  }
}

/** Longest wait for an answer; a sleeping free-tier server can take most of a minute to wake. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Fired when a signed-in request comes back 401: the session ended. */
export const UNAUTHORIZED_EVENT = "fw:unauthorized";

/** FastAPI's validation errors ([{loc: ["body", "title"], msg: "..."}]) as one readable line. */
function validationMessage(detail: unknown): string | null {
  if (!Array.isArray(detail)) return null;
  const parts = detail
    .map((d: { loc?: unknown[]; msg?: string }) => {
      const field = String(d.loc?.[d.loc.length - 1] ?? "").replace(/_/g, " ");
      const msg = (d.msg ?? "").replace(/^Value error, /, "");
      return field && field !== "body" ? `${field[0].toUpperCase()}${field.slice(1)}: ${msg}` : msg;
    })
    .filter(Boolean);
  return parts.length ? parts.join(". ") : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Our own deadline, alongside the caller's signal (a query cancelled when the page changes).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const outer = init.signal;
  const forward = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", forward, { once: true });
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      // The session is an HttpOnly cookie; the header marks the request as the app's own (CSRF check).
      credentials: "include",
      headers: { "X-Requested-With": "freightwise", ...(init.headers ?? {}) },
    });
  } catch (e) {
    if (timedOut) throw new ApiError(0, "The server took too long to answer. It may be starting up; try again in a minute.", true);
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
  if (!res.ok) {
    let detail = res.status >= 500 ? "Something went wrong on the server. Try again shortly." : `${path} returned ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else detail = validationMessage(body.detail) ?? detail;
    } catch {
      // Not JSON; keep the status line.
    }
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return send<T>("POST", path, body, signal);
}

// --- accounts ---------------------------------------------------------------

export interface Me {
  email: string;
  name: string;
  organisation: string;
  role_title: string;
  plant: string;
  email_verified: boolean;
  created_at: string;
  /** Signed up (or upgraded) with the developer access code: has the dev tools. */
  is_developer: boolean;
  /** A "Try the demo" account: no email or password, deleted after a day. */
  is_demo: boolean;
}

export interface SessionInfo {
  id: number;
  current: boolean;
  created_at: string;
  last_seen: string;
  user_agent: string;
  ip: string;
}

type Message = { message: string; dev_link?: string };

export const auth = {
  me: () => request<Me>("/api/auth/me"),
  /** The signed-in user, or null; never a 401. */
  session: () => request<{ user: Me | null }>("/api/auth/session").then((r) => r.user),
  login: (email: string, password: string, remember: boolean) => post<Me>("/api/auth/login", { email, password, remember }),
  logout: () => post<Message>("/api/auth/logout", {}),
  demo: () => post<Me>("/api/auth/demo", {}),
  signup: (body: {
    name: string;
    email: string;
    organisation: string;
    role_title: string;
    plant: string;
    password: string;
    accept_privacy: boolean;
    accept_terms: boolean;
    developer_code?: string;
  }) => post<Message & { developer?: boolean }>("/api/auth/signup", body),
  becomeDeveloper: (code: string) => post<Me>("/api/auth/developer", { code }),
  verifyEmail: (token: string) => post<Message>("/api/auth/verify-email", { token }),
  resendVerification: (email: string) => post<Message>("/api/auth/resend-verification", { email }),
  forgotPassword: (email: string) => post<Message>("/api/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) => post<Message>("/api/auth/reset-password", { token, password }),
  changePassword: (current_password: string, new_password: string) =>
    post<Message>("/api/auth/change-password", { current_password, new_password }),
  updateMe: (body: Partial<Pick<Me, "name" | "organisation" | "role_title" | "plant">>) => send<Me>("PATCH", "/api/auth/me", body),
  sessions: () => request<{ sessions: SessionInfo[] }>("/api/auth/sessions"),
  endSession: (id: number) => send<Message>("DELETE", `/api/auth/sessions/${id}`, {}),
  exportData: () => request<Record<string, unknown>>("/api/auth/export"),
  deleteAccount: (password: string) => send<Message>("DELETE", "/api/auth/account", { password }),
};

export interface PublicSummary {
  rates: Record<string, { rate: number; as_of: string }>;
  /** 6-month contracts planned with the forecast against month-by-month spot fixing, replayed on the history. */
  savings: { duration_months: number; median_saving_pct: number; cheaper_share_pct: number; since: string };
  ports: number;
  load_ports: number;
  plants: number;
  vessel_types: number;
}

export function getPublicSummary(signal?: AbortSignal) {
  return request<PublicSummary>("/api/public/summary", { signal });
}

export interface PublicPorts {
  ports: { name: string; dates: string[] | null; wave_height_max_m: number[] | null; activity_vs_normal_pct: number | null }[];
  weather: "live" | "partial" | "unavailable";
}

export function getPublicPorts(signal?: AbortSignal) {
  return request<PublicPorts>("/api/public/ports", { signal });
}

export interface LonLat {
  lon: number;
  lat: number;
}

export interface SeaRoute {
  origin: string;
  port: string;
  /** Route length, nautical miles. */
  nm: number;
  /** [lon, lat] points along the shipping lanes. */
  coords: [number, number][];
}

export interface PublicRoutes {
  load_ports: Record<string, LonLat>;
  ports: Record<string, LonLat>;
  routes: SeaRoute[];
}

export interface VoyageRoute extends SeaRoute {
  transit_days: number;
  load_port: LonLat & { name: string };
  discharge: LonLat & { name: string };
}

export function getPublicRoutes(signal?: AbortSignal) {
  return request<PublicRoutes>("/api/public/routes", { signal });
}

export function getRoute(origin: string, port: string, signal?: AbortSignal) {
  return request<VoyageRoute>(`/api/routes?${new URLSearchParams({ origin, port })}`, { signal });
}

export function getReference(signal?: AbortSignal) {
  return request<ReferenceData>("/api/reference", { signal });
}

export function postRank(body: ShipmentRequest, signal?: AbortSignal) {
  return post<RankResponse>("/api/rank", body, signal);
}

export function postExcludePort(body: ShipmentRequest, excludedPort: string, signal?: AbortSignal) {
  return post<{ ranked: RankedRow[] }>(
    `/api/scenario/exclude-port?excluded_port=${encodeURIComponent(excludedPort)}`,
    body,
    signal
  );
}

function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) q.set(k, String(v));
  return q.toString();
}

export function getForecast(horizon: number, vesselClass: string, signal?: AbortSignal) {
  return request<ForecastResponse>(`/api/forecast?${qs({ horizon, vessel_class: vesselClass })}`, { signal });
}

/** Planning with the forecast against fixing every voyage on spot as it comes up, replayed on the history. */
export interface SavingsResponse {
  vessel_class: string;
  series_class: string;
  duration_months: number;
  n_windows: number;
  first_start: string;
  last_start: string;
  median_saving_pct: number;
  mean_saving_pct: number;
  cheaper_share_pct: number;
  best_saving_pct: number;
  worst_saving_pct: number;
  windows: { start: string; signal: string; contract_pct: number; saving_pct: number }[];
}

export function getSavings(vesselClass: string, durationMonths: number, signal?: AbortSignal) {
  return request<SavingsResponse>(`/api/savings?${qs({ vessel_class: vesselClass, duration_months: durationMonths })}`, { signal });
}

export function getBacktest(horizon: number, vesselClass: string, signal?: AbortSignal) {
  return request<BacktestResponse>(`/api/backtest?${qs({ horizon, vessel_class: vesselClass })}`, { signal });
}

export function getTiming(
  p: { vesselClass: string; durationMonths: number; nVoyages: number; hireDays: number; cargoTotal: number },
  signal?: AbortSignal
) {
  return request<TimingResponse>(
    `/api/timing?${qs({
      vessel_class: p.vesselClass,
      duration_months: p.durationMonths,
      n_voyages: p.nVoyages,
      hire_days_per_voyage: p.hireDays,
      cargo_tonnes_total: p.cargoTotal,
    })}`,
    { signal }
  );
}

export function getLoadPorts(signal?: AbortSignal) {
  return request<{ load_ports: LoadPort[] }>("/api/load-ports", { signal });
}

export function getPortHistory(port: string, weeks: number, signal?: AbortSignal) {
  return request<PortHistory>(`/api/ports/${encodeURIComponent(port)}/history?weeks=${weeks}`, { signal });
}

export function getDrivers(signal?: AbortSignal) {
  return request<DriversResponse>("/api/drivers", { signal });
}

export function getPlants(signal?: AbortSignal) {
  return request<{ plants: PlantCover[] }>("/api/plants", { signal });
}

/** The planner's own stock for a plant; null goes back to the reference figure. */
export function putPlantStock(plant_name: string, tonnes: number | null) {
  return send<{ plants: PlantCover[] }>("PUT", "/api/plants/stock", { plant_name, tonnes });
}

export function getRouteFreight(p: { vessel_class: string; cargo: number; month: number; plant: string }, signal?: AbortSignal) {
  const q = new URLSearchParams({ vessel_class: p.vessel_class, cargo: String(p.cargo), month: String(p.month), plant: p.plant });
  return request<RouteFreightResponse>(`/api/route-freight?${q}`, { signal });
}

export function getRouteSeries(
  p: { vessel_class: string; origin: string; port: string; cargo: number; month: number; plant: string },
  signal?: AbortSignal
) {
  const q = new URLSearchParams({
    vessel_class: p.vessel_class, origin: p.origin, port: p.port, cargo: String(p.cargo), month: String(p.month), plant: p.plant,
  });
  return request<RouteSeriesResponse>(`/api/route-freight/series?${q}`, { signal });
}

export function postEmployment(body: ShipmentRequest & { vessel_class?: string | null; port?: string | null; idle_days?: number | null }, signal?: AbortSignal) {
  return post<EmploymentResponse>("/api/scenario/employment", body, signal);
}

export const notices = {
  list: (signal?: AbortSignal) => request<{ notices: DisruptionNotice[] }>("/api/notices", { signal }),
  add: (body: Omit<DisruptionNotice, "id">) => post<DisruptionNotice>("/api/notices", body),
  remove: (id: number) => send<{ message: string }>("DELETE", `/api/notices/${id}`, {}),
};

export interface AlertThresholds {
  wave_m: number;
  wait_days: number;
  activity_pct: number;
  band_pct: number;
  move_pct: number;
}

export function getAlerts(
  p: { port?: string | null; vesselClass?: string | null; origin?: string | null; includeMarket?: boolean; horizon?: number } & AlertThresholds,
  signal?: AbortSignal
) {
  const { port, vesselClass, origin, includeMarket = true, ...t } = p;
  return request<AlertsResponse>(
    `/api/alerts?${qs({ port, vessel_class: vesselClass, origin, include_market: includeMarket, ...t })}`,
    { signal }
  );
}

export function postIdle(
  body: ShipmentRequest & { port?: string; vessel_class?: string; wave_threshold_m?: number },
  signal?: AbortSignal
) {
  return post<IdleResponse>("/api/scenario/idle", body, signal);
}

export function postCharterPlan(
  body: {
    plant_name: string;
    origin: string;
    start_month: number;
    monthly_cargo_tonnes: number;
    duration_months: number;
    vessel_class?: string | null;
    port?: string | null;
    tolerance_pct?: number;
    coal_grade?: CoalGrade | null;
    laycan_start_day?: number | null;
    laycan_end_day?: number | null;
  },
  signal?: AbortSignal
) {
  return post<CharterPlanResponse>("/api/charter-plan", body, signal);
}

export interface StressShock {
  freight_change_pct: number;
  bunker_change_pct: number;
  extra_wait_days: number;
  closed_port: string | null;
}

export interface StressResponse {
  baseline: RankedRow | null;
  /** The same port and class under the shock; null when the shock closes its port. */
  same_option: RankedRow | null;
  best: RankedRow | null;
  changed: boolean;
  options: RankedRow[];
}

export function postStress(body: ShipmentRequest & StressShock & { port?: string | null; vessel_class?: string | null }, signal?: AbortSignal) {
  return post<StressResponse>("/api/stress", body, signal);
}

export interface CharterTerms {
  port: string;
  vessel_class: string;
  n_voyages: number;
  time_charter_usd: number;
  time_charter_usd_per_tonne: number;
  voyage_freight_usd_per_tonne: number;
  voyage_charter_usd: number;
  voyage_charter_usd_per_tonne: number;
  laytime_days: number;
  demurrage_days: number;
  demurrage_usd: number;
  demurrage_rate_usd_per_day: number;
  despatch_rate_usd_per_day: number;
  cheaper: "time" | "voyage";
}

export function postCharterTerms(body: ShipmentRequest & { port?: string | null; vessel_class?: string | null }, signal?: AbortSignal) {
  return post<{ options: CharterTerms[] }>("/api/charter-terms", body, signal);
}

export function postWaitScenario(body: ShipmentRequest, signal?: AbortSignal) {
  return post<{ wait_scenarios: WaitScenarioRow[] }>("/api/scenario/wait", body, signal);
}

export function postPlan(
  body: ShipmentRequest & { n_shipments: number; max_calls_per_port_month: number; capacity_basis: "flat" | "traffic" },
  signal?: AbortSignal
) {
  return post<PlanResponse>("/api/plan", body, signal);
}

export function getWeather(forecastDays: number, signal?: AbortSignal) {
  return request<WeatherResponse>(`/api/weather?forecast_days=${forecastDays}`, { signal });
}

export function getPortsMap(signal?: AbortSignal) {
  return request<PortsMapResponse>("/api/ports/map", { signal });
}

export function getHealth(signal?: AbortSignal) {
  return request<{ status: string }>("/api/health", { signal });
}

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR";

export async function getUsdInr(signal?: AbortSignal): Promise<{ rate: number; date: string }> {
  const res = await fetch(FX_URL, { signal });
  if (!res.ok) throw new Error(`FX returned ${res.status}`);
  const data: { date: string; rates: { INR?: number } } = await res.json();
  if (!data.rates.INR) throw new Error("FX response had no INR rate");
  return { rate: data.rates.INR, date: data.date };
}
