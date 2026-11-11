// ADS-B / OpenSky record parsing and dead reckoning (pure, unit-tested).

export interface Ac {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  lat: number;
  lon: number;
  alt: number | 'ground'; // ft
  gs?: number; // kt
  track?: number;
  baro_rate?: number;
  squawk?: string;
  category?: string;
  mil?: boolean;
  country?: string;
  seen: number; // ms epoch when fix was valid
  src: string;
  /** ADS-B navigation accuracy / integrity (absent for OpenSky) */
  nacp?: number;
  nic?: number;
}

export const EMERG: Record<string, string> = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'GENERAL EMERGENCY' };

export function fromAdsb(a: any, now: number, src: string): Ac | null {
  if (a.lat == null || a.lon == null) return null;
  return {
    hex: a.hex,
    flight: a.flight?.trim(),
    r: a.r,
    t: a.t,
    desc: a.desc,
    lat: a.lat,
    lon: a.lon,
    alt: a.alt_baro ?? a.alt_geom ?? 0,
    gs: a.gs,
    track: a.track ?? a.true_heading,
    baro_rate: a.baro_rate,
    squawk: a.squawk,
    category: a.category,
    mil: !!(a.dbFlags & 1),
    seen: now - (a.seen_pos ?? a.seen ?? 0) * 1000,
    src,
    nacp: typeof a.nac_p === 'number' ? a.nac_p : undefined,
    nic: typeof a.nic === 'number' ? a.nic : undefined,
  };
}

export function fromOpenSky(s: any[], src: string): Ac | null {
  if (s[5] == null || s[6] == null) return null;
  return {
    hex: s[0],
    flight: s[1]?.trim(),
    country: s[2],
    lon: s[5],
    lat: s[6],
    alt: s[8] ? 'ground' : (s[7] ?? 0) / 0.3048,
    gs: s[9] != null ? s[9] * 1.94384 : undefined,
    track: s[10],
    baro_rate: s[11] != null ? s[11] * 196.85 : undefined,
    squawk: s[14],
    seen: (s[3] ?? s[4]) * 1000,
    src,
  };
}

export function deadReckon(a: Ac, t: number) {
  if (!a.gs || a.track == null || a.alt === 'ground') return { lat: a.lat, lon: a.lon };
  const dt = Math.min(120, Math.max(0, (t - a.seen) / 1000));
  const d = (a.gs * 0.514444 * dt) / 6371000;
  const tr = (a.track * Math.PI) / 180;
  const lat = a.lat + ((d * Math.cos(tr)) * 180) / Math.PI;
  const lon = a.lon + ((d * Math.sin(tr)) / Math.cos((a.lat * Math.PI) / 180)) * (180 / Math.PI);
  return { lat, lon };
}

