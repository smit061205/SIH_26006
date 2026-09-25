import type { VesselClassInfo } from "../../types";

/**
 * The five vessel classes as the API serves them (data/vessel_classes.csv,
 * payload at the planning utilisation), for the component kit and the hull
 * checks when no data is loaded. npm run check:hull verifies these still
 * match the CSV.
 */
export const SAMPLE_CLASSES: VesselClassInfo[] = [
  { name: "Handysize", dwt_min: 25000, dwt_max: 40000, payload_tonnes: 38000, freight_series_class: "Handysize", loa_m: 180, beam_m: 29.8, depth_m: 14.3, draft_laden_m: 10.5, holds: 5, cranes: 4, tpc_t_per_cm: 45, crane_swl_t: 30, hatch_cover_type: "folding", block_coefficient: 0.8 },
  { name: "Supramax", dwt_min: 50000, dwt_max: 60000, payload_tonnes: 57000, freight_series_class: "Supramax", loa_m: 190, beam_m: 32.26, depth_m: 18.3, draft_laden_m: 12.8, holds: 5, cranes: 4, tpc_t_per_cm: 57, crane_swl_t: 35, hatch_cover_type: "folding", block_coefficient: 0.84 },
  { name: "Panamax", dwt_min: 60000, dwt_max: 80000, payload_tonnes: 76000, freight_series_class: "Panamax", loa_m: 225, beam_m: 32.3, depth_m: 19.6, draft_laden_m: 14.2, holds: 7, cranes: 0, tpc_t_per_cm: 68, crane_swl_t: null, hatch_cover_type: "side_rolling", block_coefficient: 0.86 },
  { name: "Post-Panamax", dwt_min: 80000, dwt_max: 120000, payload_tonnes: 114000, freight_series_class: "Panamax", loa_m: 250, beam_m: 40, depth_m: 20, draft_laden_m: 15, holds: 7, cranes: 0, tpc_t_per_cm: 80, crane_swl_t: null, hatch_cover_type: "side_rolling", block_coefficient: 0.86 },
  { name: "Capesize", dwt_min: 150000, dwt_max: 180000, payload_tonnes: 171000, freight_series_class: "Capesize", loa_m: 290, beam_m: 45, depth_m: 24.5, draft_laden_m: 18, holds: 9, cranes: 0, tpc_t_per_cm: 122, crane_swl_t: null, hatch_cover_type: "side_rolling", block_coefficient: 0.87 },
];
