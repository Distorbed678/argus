// GPS-interference ESTIMATE from ADS-B navigation-quality fields (same idea as gpsjam.org):
// airborne aircraft reporting a degraded position accuracy (NACp < 8, i.e. worse than ~93 m EPU)
// are counted per 1°×1° cell over a sliding window. Spoofing/jamming is only one possible cause
// (old avionics, firmware quirks, terrain masking), so this is always presented as an estimate.

export const CELL_DEG = 1;
export const WINDOW_MS = 30 * 60_000;
/** cells need at least this many distinct aircraft before they are shown */
export const MIN_AIRCRAFT = 3;

export const isDegraded = (nacp: number, _nic?: number) => nacp < 8;

export const cellOf = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)},${Math.floor(lon / CELL_DEG)}`;

export function cellBounds(key: string) {
  const [y, x] = key.split(',').map(Number);
  return { south: y * CELL_DEG, north: (y + 1) * CELL_DEG, west: x * CELL_DEG, east: (x + 1) * CELL_DEG };
}

/** gpsjam.org-style bands on the share of degraded aircraft */
export function level(badShare: number): 'low' | 'medium' | 'high' {
  return badShare > 0.1 ? 'high' : badShare >= 0.02 ? 'medium' : 'low';
}

export interface CellStat {
  key: string;
  total: number;
  bad: number;
  share: number;
  level: 'low' | 'medium' | 'high';
  last: number;
}

export class NavGrid {
  /** cell → aircraft hex → { degraded, t } */
  private cells = new Map<string, Map<string, { bad: boolean; t: number }>>();
  reports = 0;

  add(hex: string, lat: number, lon: number, nacp: number, nic: number | undefined, t: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(nacp)) return;
    const k = cellOf(lat, lon);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = new Map()));
    const prev = c.get(hex);
    // an aircraft counts as degraded in a cell if any of its recent reports there was degraded
    c.set(hex, { bad: (prev?.bad && t - prev.t < WINDOW_MS) || isDegraded(nacp, nic), t: Math.max(t, prev?.t ?? 0) });
    this.reports++;
  }

  prune(now: number) {
    for (const [k, c] of this.cells) {
      for (const [h, v] of c) if (now - v.t > WINDOW_MS) c.delete(h);
      if (!c.size) this.cells.delete(k);
    }
  }

  stats(minAircraft = MIN_AIRCRAFT): CellStat[] {
    const out: CellStat[] = [];
    for (const [key, c] of this.cells) {
      if (c.size < minAircraft) continue;
      let bad = 0;
      let last = 0;
      for (const v of c.values()) {
        if (v.bad) bad++;
        last = Math.max(last, v.t);
      }
      const share = bad / c.size;
      out.push({ key, total: c.size, bad, share, level: level(share), last });
    }
    return out;
  }

  get cellCount() {
    return this.cells.size;
  }
}
