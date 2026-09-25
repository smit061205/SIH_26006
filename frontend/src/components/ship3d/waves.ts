/**
 * Sea state as a sum of Gerstner wave trains, sized from a significant wave
 * height (Hs, metres) such as the port's marine forecast. Pure numbers, shared
 * by the ocean shader and by the ship's motion, so the ship rides the same
 * waves that are drawn.
 *
 * - Peak period from Hs, a common rule for a wind sea: Tp ~ 4.8 x sqrt(Hs) s.
 * - Wavelengths from deep-water dispersion: lambda = g Tp^2 / (2 pi), w = sqrt(g k).
 * - Amplitudes scaled so the trains' combined Hs = 4 sqrt(sum(a^2 / 2)) matches.
 */

export const G = 9.81;
export const MAX_WAVES = 6;

export interface WaveTrain {
  /** Unit direction of travel on the sea surface (x, z). */
  dir: [number, number];
  /** Wavenumber 2 pi / wavelength. */
  k: number;
  /** Amplitude (half the crest-to-trough height), metres. */
  a: number;
  /** Gerstner steepness: how sharp the crests are (0 = sine waves). */
  q: number;
  phase: number;
}

// Relative wavelength, direction offset (radians) and amplitude weight of each train.
const SPECTRUM: [number, number, number][] = [
  [1.0, 0, 1],
  [0.72, 0.45, 0.7],
  [1.35, -0.3, 0.55],
  [0.5, -0.8, 0.45],
  [0.33, 0.9, 0.3],
  [0.23, -1.25, 0.2],
];

export function peakPeriod(hs: number) {
  return Math.max(2.5, 4.8 * Math.sqrt(Math.max(0, hs)));
}

/** Wave trains for a significant wave height, heading `heading` radians from +x. */
export function seaState(hs: number, heading = 0.5): WaveTrain[] {
  const h = Math.max(0.05, hs);
  const tp = peakPeriod(h);
  const lambda = (G * tp * tp) / (2 * Math.PI);
  const norm = Math.sqrt(8 * SPECTRUM.reduce((s, [, , w]) => s + w * w, 0));
  return SPECTRUM.map(([ratio, offset, weight], i) => {
    const k = (2 * Math.PI) / (lambda * ratio);
    const a = (weight * h) / norm;
    const angle = heading + offset;
    return {
      dir: [Math.cos(angle), Math.sin(angle)],
      k,
      a,
      // Sharper crests in rougher seas, never looping over.
      q: Math.min(1, (0.35 + 0.25 * Math.min(1, h / 3)) / (k * a * SPECTRUM.length)),
      phase: i * 1.7,
    };
  });
}

/** Significant wave height of a set of trains (should equal the Hs asked for). */
export function significantHeight(waves: WaveTrain[]) {
  return 4 * Math.sqrt(waves.reduce((s, w) => s + (w.a * w.a) / 2, 0));
}

/** Surface height at (x, z) and time t (the horizontal Gerstner drift is small and ignored here). */
export function surfaceHeight(waves: WaveTrain[], x: number, z: number, t: number) {
  let y = 0;
  for (const w of waves) {
    const f = w.k * (w.dir[0] * x + w.dir[1] * z) - Math.sqrt(G * w.k) * t + w.phase;
    y += w.a * Math.sin(f);
  }
  return y;
}

/**
 * Heave, pitch and roll of a ship of length L and beam B lying along x with
 * its midship at (cx, cz), from the sea surface under its ends and sides.
 * Long ships average out short waves, so the motion is gentle unless the sea
 * is long and high.
 */
export function shipMotion(waves: WaveTrain[], L: number, B: number, t: number, cx = 0, cz = 0) {
  const at = (dx: number, dz: number) => surfaceHeight(waves, cx + dx, cz + dz, t);
  const bow = (at(L * 0.4, 0) + at(L * 0.3, 0)) / 2;
  const stern = (at(-L * 0.4, 0) + at(-L * 0.3, 0)) / 2;
  const port = at(0, B * 0.45);
  const starboard = at(0, -B * 0.45);
  const mid = at(0, 0);
  return {
    heave: (bow + stern + mid * 2) / 4,
    pitch: Math.atan2(bow - stern, L * 0.7),
    roll: Math.atan2(port - starboard, B * 0.9) * 0.8,
  };
}
