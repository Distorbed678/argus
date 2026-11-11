// Re-entry time estimate from public GP elements (CelesTrak SPECIAL=DECAYING).
// Authoritative predictions (Space-Track TIP, Aerospace Corp.) need a login or block browsers, so
// this is a first-order drag-decay ESTIMATE and is always labelled as such.

const MU = 398600.4418; // km³/s²
const RE = 6378.137; // km
const REENTRY_KM = 120;

/** Semi-major axis (km) from mean motion in rev/day. */
export function semiMajorKm(revPerDay: number): number {
  const n = (revPerDay * 2 * Math.PI) / 86400;
  return Math.cbrt(MU / (n * n));
}

/** Rough density scale height near altitude h (km), from standard-atmosphere tables. */
export function scaleHeightKm(h: number): number {
  if (h < 150) return 22;
  if (h < 200) return 30;
  if (h < 250) return 38;
  if (h < 300) return 45;
  if (h < 400) return 53;
  return 60;
}

export interface DecayEstimate {
  perigeeKm: number;
  apogeeKm: number;
  /** current orbit-average decay rate, km/day (negative = falling) */
  dhdt: number;
  /** estimated days from epoch to reaching ~120 km */
  days: number;
  /** estimated re-entry time (ms epoch) */
  at: number;
}

/**
 * Near-circular orbit with an exponential atmosphere: dh/dt ∝ exp(−h/H), so the time to fall from
 * h to h_r is H/|dh/dt| · (1 − exp(−(h − h_r)/H)). da/dt comes from the observed mean-motion
 * derivative: da/dt = −(2/3)(a/n)·dn/dt, where OMM's MEAN_MOTION_DOT is dn/dt / 2 (rev/day²).
 */
export function estimateDecay(o: { MEAN_MOTION: number; MEAN_MOTION_DOT: number; ECCENTRICITY: number; EPOCH: string }): DecayEstimate | null {
  const n = o.MEAN_MOTION;
  const ndot = 2 * o.MEAN_MOTION_DOT;
  if (!(n > 0) || !Number.isFinite(ndot)) return null;
  const a = semiMajorKm(n);
  const perigeeKm = a * (1 - o.ECCENTRICITY) - RE;
  const apogeeKm = a * (1 + o.ECCENTRICITY) - RE;
  const dadt = -(2 / 3) * (a / n) * ndot; // km/day
  const epoch = Date.parse(o.EPOCH.endsWith('Z') ? o.EPOCH : o.EPOCH + 'Z');
  if (!(dadt < 0) || !Number.isFinite(epoch)) return null;
  // drag is dominated by perigee; use the mean of perigee and the orbit-average height
  const h = Math.max(REENTRY_KM + 1, (perigeeKm + (a - RE)) / 2);
  const H = scaleHeightKm(h);
  const days = (H / -dadt) * (1 - Math.exp(-(h - REENTRY_KM) / H));
  return { perigeeKm, apogeeKm, dhdt: dadt, days, at: epoch + days * 86400_000 };
}

/** Human uncertainty band: these estimates are good to roughly ±25 % close in, worse further out. */
export function uncertaintyDays(days: number): number {
  return Math.max(0.1, days * (days < 3 ? 0.25 : days < 14 ? 0.35 : 0.5));
}
