import { type ReactNode, createContext, useCallback, useContext, useMemo } from "react";
import type { ShipmentRequest } from "../api";
import type { CoalGrade, ReferenceData } from "../types";
import { useReference } from "./queries";
import { useAuth } from "./auth";
import { useSearchParam } from "./router";

export const CARGO_MIN = 10_000;
export const CARGO_MAX = 200_000;
export const CARGO_STEP = 5_000;
const DEFAULT_CARGO = 75_000;
const DEFAULT_MONTH = 10;
export const DURATIONS = [0, 3, 6, 12] as const;
const DEFAULT_DURATION = 6;
export const TOLERANCES = [0, 5, 10] as const;
const GRADES: CoalGrade[] = ["hard_coking", "semi_soft", "pci"];

export interface Shipment {
  cargoTonnes: number;
  month: number;
  origin: string;
  plant: string;
  /** Contract length in months; 0 means a single spot voyage. */
  duration: number;
  /** Coal grade; null means any grade the origin ships. */
  grade: CoalGrade | null;
  /** More-or-less quantity, percent (MOLOO). */
  tolerancePct: number;
  /** Laycan days within the (start) month; null means the whole month. */
  laycanStart: number | null;
  laycanEnd: number | null;
  /** The planner's own fixed choices; null means the plan picks. */
  fixedClass: string | null;
  fixedPort: string | null;
}

interface ShipmentState {
  reference: ReferenceData | undefined;
  referenceError: boolean;
  retryReference: () => void;
  shipment: Shipment | null;
  request: ShipmentRequest | null;
  update: (patch: Partial<Shipment>) => void;
}

const ShipmentContext = createContext<ShipmentState | null>(null);

function clampCargo(n: number) {
  if (!Number.isFinite(n)) return DEFAULT_CARGO;
  return Math.min(CARGO_MAX, Math.max(CARGO_MIN, Math.round(n)));
}

/** The plan's plant for a profile's "plant or unit" ("Bhilai Steel Plant" -> "Bhilai"), if any. */
function plantFromProfile(unit: string | undefined, plants: string[]) {
  const u = (unit ?? "").toLowerCase();
  return u ? plants.find((p) => u.includes(p.toLowerCase())) : undefined;
}

/** The shipment a set of query parameters describes, falling back to defaults
 *  (the person's own plant, when their profile names one). */
export function parseShipment(params: URLSearchParams, r: ReferenceData, profilePlant?: string): Shipment {
  const month = Number(params.get("month"));
  const cargo = params.get("cargo");
  const origin = params.get("origin");
  const plant = params.get("plant");
  const duration = params.get("dur");
  const grade = params.get("grade") as CoalGrade | null;
  const tol = Number(params.get("tol"));
  const [ls, le] = (params.get("lay") ?? "").split("-").map(Number);
  const cls = params.get("cls");
  const dport = params.get("dport");
  const validGrade = grade && GRADES.includes(grade) ? grade : null;
  // An origin must ship the chosen grade; otherwise the first origin that does.
  const ships = (o: string) => !validGrade || (r.origin_grades?.[o] ?? GRADES).includes(validGrade);
  const pickedOrigin = origin && r.origins.includes(origin) && ships(origin) ? origin : (r.origins.find(ships) ?? r.origins[0]);
  const day = (n: number) => (Number.isInteger(n) && n >= 1 && n <= 31 ? n : null);
  const laycanStart = day(ls);
  const laycanEnd = laycanStart !== null ? (day(le) !== null && le >= laycanStart ? le : laycanStart) : null;
  return {
    cargoTonnes: cargo ? clampCargo(Number(cargo)) : DEFAULT_CARGO,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : DEFAULT_MONTH,
    origin: pickedOrigin,
    plant: plant && r.plants.includes(plant) ? plant : (plantFromProfile(profilePlant, r.plants) ?? r.plants[0]),
    duration: duration !== null && (DURATIONS as readonly number[]).includes(Number(duration)) ? Number(duration) : DEFAULT_DURATION,
    grade: validGrade,
    tolerancePct: (TOLERANCES as readonly number[]).includes(tol) ? tol : 0,
    laycanStart,
    laycanEnd,
    fixedClass: cls && r.vessel_classes.some((v) => v.name === cls) ? cls : null,
    fixedPort: dport && r.ports.includes(dport) ? dport : null,
  };
}

/** Query string for a shipment, the same parameters the shipment bar writes. */
export function shipmentQuery(s: Shipment): string {
  const q = new URLSearchParams({
    cargo: String(s.cargoTonnes),
    month: String(s.month),
    origin: s.origin,
    plant: s.plant,
    dur: String(s.duration),
  });
  if (s.grade) q.set("grade", s.grade);
  if (s.tolerancePct) q.set("tol", String(s.tolerancePct));
  if (s.laycanStart !== null) q.set("lay", `${s.laycanStart}-${s.laycanEnd ?? s.laycanStart}`);
  if (s.fixedClass) q.set("cls", s.fixedClass);
  if (s.fixedPort) q.set("dport", s.fixedPort);
  return q.toString();
}

export function ShipmentProvider({ children }: { children: ReactNode }) {
  const ref = useReference();
  const { user } = useAuth();
  const [cargoParam, setCargo] = useSearchParam("cargo");
  const [monthParam, setMonth] = useSearchParam("month");
  const [originParam, setOrigin] = useSearchParam("origin");
  const [plantParam, setPlant] = useSearchParam("plant");
  const [durationParam, setDuration] = useSearchParam("dur");
  const [gradeParam, setGrade] = useSearchParam("grade");
  const [tolParam, setTol] = useSearchParam("tol");
  const [layParam, setLay] = useSearchParam("lay");
  const [clsParam, setCls] = useSearchParam("cls");
  const [portParam, setPort] = useSearchParam("dport");

  const shipment = useMemo<Shipment | null>(() => {
    if (!ref.data) return null;
    const params = new URLSearchParams();
    const set = (k: string, v: string | null) => v !== null && params.set(k, v);
    set("cargo", cargoParam);
    set("month", monthParam);
    set("origin", originParam);
    set("plant", plantParam);
    set("dur", durationParam);
    set("grade", gradeParam);
    set("tol", tolParam);
    set("lay", layParam);
    set("cls", clsParam);
    set("dport", portParam);
    return parseShipment(params, ref.data, user?.plant);
  }, [ref.data, cargoParam, monthParam, originParam, plantParam, durationParam, gradeParam, tolParam, layParam, clsParam, portParam, user?.plant]);

  const update = useCallback(
    (patch: Partial<Shipment>) => {
      if (patch.cargoTonnes !== undefined) setCargo(String(clampCargo(patch.cargoTonnes)));
      if (patch.month !== undefined) setMonth(String(patch.month));
      if (patch.origin !== undefined) setOrigin(patch.origin);
      if (patch.plant !== undefined) setPlant(patch.plant);
      if (patch.duration !== undefined) setDuration(String(patch.duration));
      if (patch.grade !== undefined) setGrade(patch.grade);
      if (patch.tolerancePct !== undefined) setTol(patch.tolerancePct ? String(patch.tolerancePct) : null);
      if (patch.laycanStart !== undefined || patch.laycanEnd !== undefined) {
        const start = patch.laycanStart !== undefined ? patch.laycanStart : null;
        const end = patch.laycanEnd !== undefined ? patch.laycanEnd : start;
        setLay(start === null ? null : `${start}-${Math.max(start, end ?? start)}`);
      }
      if (patch.fixedClass !== undefined) setCls(patch.fixedClass);
      if (patch.fixedPort !== undefined) setPort(patch.fixedPort);
    },
    [setCargo, setMonth, setOrigin, setPlant, setDuration, setGrade, setTol, setLay, setCls, setPort]
  );

  const request = useMemo<ShipmentRequest | null>(
    () =>
      shipment
        ? {
            cargo_tonnes: shipment.cargoTonnes,
            month: shipment.month,
            origin: shipment.origin,
            plant_name: shipment.plant,
            tolerance_pct: shipment.tolerancePct,
            coal_grade: shipment.grade,
          }
        : null,
    [shipment]
  );

  const value = useMemo<ShipmentState>(
    () => ({
      reference: ref.data,
      referenceError: ref.isError,
      retryReference: () => void ref.refetch(),
      shipment,
      request,
      update,
    }),
    [ref, shipment, request, update]
  );

  return <ShipmentContext.Provider value={value}>{children}</ShipmentContext.Provider>;
}

export function useShipment() {
  const ctx = useContext(ShipmentContext);
  if (!ctx) throw new Error("useShipment outside ShipmentProvider");
  return ctx;
}
