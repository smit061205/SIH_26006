import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type AlertThresholds,
  type ShipmentRequest,
  getAlerts,
  getBacktest,
  getForecast,
  getHealth,
  getPlants,
  getPortsMap,
  getReference,
  postEmployment,
  getRouteFreight,
  getRouteSeries,
  getTiming,
  getWeather,
  postCharterPlan,
  postExcludePort,
  postIdle,
  postPlan,
  postRank,
  postWaitScenario,
  getDrivers,
  getLoadPorts,
  getPortHistory,
} from "../api";
import type { Shipment } from "./shipment";

const keyOf = (s: ShipmentRequest | null) => (s ? [s.cargo_tonnes, s.month, s.origin, s.plant_name] : ["pending"]);

export function useReference() {
  return useQuery({
    queryKey: ["reference"],
    queryFn: ({ signal }) => getReference(signal),
    staleTime: Infinity,
  });
}

export function useRank(s: ShipmentRequest | null) {
  return useQuery({
    queryKey: ["rank", ...keyOf(s)],
    queryFn: ({ signal }) => postRank(s!, signal),
    enabled: !!s,
    placeholderData: keepPreviousData,
  });
}

export function useExcludePort(s: ShipmentRequest | null, port: string | null) {
  return useQuery({
    queryKey: ["exclude-port", port, ...keyOf(s)],
    queryFn: ({ signal }) => postExcludePort(s!, port!, signal),
    enabled: !!s && !!port,
    placeholderData: keepPreviousData,
  });
}

export function useWaitScenarios(s: ShipmentRequest | null) {
  return useQuery({
    queryKey: ["wait", ...keyOf(s)],
    queryFn: ({ signal }) => postWaitScenario(s!, signal),
    enabled: !!s,
    placeholderData: keepPreviousData,
  });
}

export function usePlan(s: ShipmentRequest | null, nShipments: number, slots: number, basis: "flat" | "traffic") {
  return useQuery({
    queryKey: ["plan", nShipments, slots, basis, ...keyOf(s)],
    queryFn: ({ signal }) =>
      postPlan({ ...s!, n_shipments: nShipments, max_calls_per_port_month: slots, capacity_basis: basis }, signal),
    enabled: !!s,
    placeholderData: keepPreviousData,
  });
}

export function useForecast(horizon: number, vesselClass: string | null) {
  return useQuery({
    queryKey: ["forecast", vesselClass, horizon],
    queryFn: ({ signal }) => getForecast(horizon, vesselClass!, signal),
    enabled: !!vesselClass,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useBacktest(horizon: number, vesselClass: string) {
  return useQuery({
    queryKey: ["backtest", vesselClass, horizon],
    queryFn: ({ signal }) => getBacktest(horizon, vesselClass, signal),
    staleTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useTiming(
  p: { vesselClass: string; durationMonths: number; nVoyages: number; hireDays: number; cargoTotal: number } | null
) {
  return useQuery({
    queryKey: ["timing", p],
    queryFn: ({ signal }) => getTiming(p!, signal),
    enabled: !!p,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCharterPlan(s: Shipment | null) {
  const body = s
    ? {
        plant_name: s.plant,
        origin: s.origin,
        start_month: s.month,
        monthly_cargo_tonnes: s.cargoTonnes,
        duration_months: s.duration,
        vessel_class: s.fixedClass,
        port: s.fixedPort,
        tolerance_pct: s.tolerancePct,
        coal_grade: s.grade,
        laycan_start_day: s.laycanStart,
        laycan_end_day: s.laycanEnd,
      }
    : null;
  return useQuery({
    queryKey: ["charter-plan", body],
    queryFn: ({ signal }) => postCharterPlan(body!, signal),
    enabled: !!body,
    placeholderData: keepPreviousData,
  });
}

export function useAlerts(
  scope: { port?: string | null; vesselClass?: string | null; origin?: string | null; includeMarket?: boolean; horizon?: number } | null,
  thresholds: AlertThresholds
) {
  return useQuery({
    queryKey: ["alerts", scope, thresholds],
    queryFn: ({ signal }) => getAlerts({ ...scope!, ...thresholds }, signal),
    enabled: !!scope,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useLoadPorts() {
  return useQuery({
    queryKey: ["load-ports"],
    queryFn: ({ signal }) => getLoadPorts(signal),
    staleTime: 60 * 60_000,
  });
}

export function usePortHistory(port: string | null, weeks: number) {
  return useQuery({
    queryKey: ["port-history", port, weeks],
    queryFn: ({ signal }) => getPortHistory(port!, weeks, signal),
    enabled: !!port,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useDrivers() {
  return useQuery({
    queryKey: ["drivers"],
    queryFn: ({ signal }) => getDrivers(signal),
    staleTime: 60 * 60_000,
  });
}

export function usePlants() {
  return useQuery({
    queryKey: ["plants"],
    queryFn: ({ signal }) => getPlants(signal),
    staleTime: 10 * 60_000,
  });
}

export function useIdle(s: ShipmentRequest | null, waveThresholdM: number, port?: string, vesselClass?: string) {
  return useQuery({
    queryKey: ["idle", port, vesselClass, waveThresholdM, ...keyOf(s)],
    queryFn: ({ signal }) =>
      postIdle({ ...s!, port, vessel_class: vesselClass, wave_threshold_m: waveThresholdM }, signal),
    enabled: !!s,
    placeholderData: keepPreviousData,
  });
}

export function usePorts() {
  return useQuery({
    queryKey: ["ports"],
    queryFn: ({ signal }) => getPortsMap(signal),
    staleTime: Infinity,
  });
}

export function useWeather(days: number) {
  return useQuery({
    queryKey: ["weather", days],
    queryFn: ({ signal }) => getWeather(days, signal),
    staleTime: 30 * 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 60_000,
    retry: 1,
    meta: { progress: false },
  });
}

export function useRouteFreight(p: { vessel_class: string; cargo: number; month: number; plant: string } | null) {
  return useQuery({
    queryKey: ["route-freight", p],
    queryFn: ({ signal }) => getRouteFreight(p!, signal),
    enabled: !!p,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useRouteSeries(p: { vessel_class: string; origin: string; port: string; cargo: number; month: number; plant: string } | null) {
  return useQuery({
    queryKey: ["route-series", p],
    queryFn: ({ signal }) => getRouteSeries(p!, signal),
    enabled: !!p,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useEmployment(s: ShipmentRequest | null, vesselClass: string | null, port: string | null, idleDays: number | null) {
  return useQuery({
    queryKey: ["employment", vesselClass, port, idleDays, ...keyOf(s)],
    queryFn: ({ signal }) => postEmployment({ ...s!, vessel_class: vesselClass, port, idle_days: idleDays }, signal),
    enabled: !!s,
    placeholderData: keepPreviousData,
  });
}
