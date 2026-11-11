/// <reference lib="webworker" />
// SGP4 propagation for the whole catalog, off the main thread.
import { json2satrec, propagate, gstime, eciToEcf, ecfToLookAngles, eciToGeodetic, type SatRec, type OMMJsonObject } from 'satellite.js';

import { parseCsv } from './omm';
import { inShape, type Shape } from '../../core/geo';

let recs: (SatRec | null)[] = [];
let mask: Uint8Array | null = null;
const DEG = Math.PI / 180;

type Msg =
  | { type: 'load'; csv: string[] }
  | { type: 'vis'; mask: Uint8Array }
  | { type: 'tick'; t: number; id: number }
  | { type: 'passes'; idx: number; lat: number; lon: number; h: number; t: number; hours: number; reqId: number }
  | { type: 'overhead'; lat: number; lon: number; h: number; t: number; minEl: number; reqId: number }
  | { type: 'aoiSats'; idxs: Int32Array; shapes: Shape[]; t: number; reqId: number }
  | { type: 'revisit'; idxs: Int32Array; lat: number; lon: number; t: number; hours: number; minEl: number; reqId: number };

export interface RevisitPass {
  idx: number;
  aos: number;
  los: number;
  maxEl: number;
  maxAt: number;
  /** geostationary / high orbit: continuously in view for the whole window */
  persistent?: boolean;
}

const yieldNow = () => new Promise((r) => setTimeout(r, 0));

/**
 * Passes of each candidate satellite over one ground point in [t, t + hours]. 60 s coarse steps,
 * the culmination refined at 5 s. Yields to the event loop every few satellites so position ticks
 * keep flowing while this runs.
 */
async function revisit(m: Extract<Msg, { type: 'revisit' }>): Promise<RevisitPass[]> {
  const obs = { latitude: m.lat * DEG, longitude: m.lon * DEG, height: 0 };
  const end = m.t + m.hours * 3600_000;
  const out: RevisitPass[] = [];
  const elAt = (r: SatRec, t: number) => {
    const d = new Date(t);
    const p = ecefAt(r, d, gstime(d));
    return p && Number.isFinite(p.ecf.x) ? ecfToLookAngles(obs, p.ecf).elevation / DEG : NaN;
  };
  let n = 0;
  for (const i of m.idxs) {
    if (++n % 25 === 0) await yieldNow();
    const r = recs[i];
    if (!r) continue;
    const revPerDay = (r.no * 1440) / (2 * Math.PI);
    if (revPerDay < 1.5) {
      // GEO / high orbit: it either always sees the point or never does
      const el = elAt(r, m.t);
      if (el >= m.minEl) out.push({ idx: i, aos: m.t, los: end, maxEl: el, maxAt: m.t, persistent: true });
      continue;
    }
    // MEO / HEO (GNSS, Molniya…) aren't imaging passes: LEO only (≥ 11 rev/day ≈ below ~2,000 km)
    if (revPerDay < 11) continue;
    // ground-track latitude can't exceed the inclination (+ ~12° of sensor reach)
    const inc = r.inclo / DEG;
    const reach = Math.min(90, (inc > 90 ? 180 - inc : inc) + 12);
    if (Math.abs(m.lat) > reach) continue;
    let cur: { aos: number; maxEl: number; maxAt: number } | null = null;
    for (let t = m.t; t <= end; t += 60_000) {
      const el = elAt(r, t);
      if (Number.isNaN(el)) break;
      if (el > 0) {
        if (!cur) cur = { aos: t, maxEl: el, maxAt: t };
        else if (el > cur.maxEl) (cur.maxEl = el), (cur.maxAt = t);
      } else if (cur) {
        if (cur.maxEl >= m.minEl - 8) {
          // refine the culmination around the coarse maximum
          for (let tt = cur.maxAt - 55_000; tt <= cur.maxAt + 55_000; tt += 5000) {
            const e = elAt(r, tt);
            if (e > cur.maxEl) (cur.maxEl = e), (cur.maxAt = tt);
          }
          if (cur.maxEl >= m.minEl) out.push({ idx: i, aos: cur.aos, los: t, maxEl: cur.maxEl, maxAt: cur.maxAt });
        }
        cur = null;
      }
    }
  }
  out.sort((a, b) => a.aos - b.aos);
  return out;
}

function ecefAt(rec: SatRec, date: Date, gmst: number) {
  const pv = propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  return { ecf: eciToEcf(pv.position, gmst), eci: pv.position };
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'load') {
    const omms: OMMJsonObject[] = m.csv.flatMap((c) => parseCsv(c));
    recs = omms.map((o) => {
      try {
        const r = json2satrec(o);
        return r && !r.error ? r : null;
      } catch {
        return null;
      }
    });
    (self as any).postMessage({ type: 'loaded', n: recs.length, ok: recs.filter(Boolean).length });
  } else if (m.type === 'vis') {
    mask = m.mask;
  } else if (m.type === 'tick') {
    const n = recs.length;
    const buf = new Float32Array(n * 3);
    const date = new Date(m.t);
    const gmst = gstime(date);
    for (let i = 0; i < n; i++) {
      const r = recs[i];
      // hidden categories are skipped entirely (NaN = not drawn)
      const p = r && (!mask || mask[i]) ? ecefAt(r, date, gmst) : null;
      if (!p || !Number.isFinite(p.ecf.x)) {
        buf[i * 3] = NaN;
        continue;
      }
      buf[i * 3] = p.ecf.x * 1000;
      buf[i * 3 + 1] = p.ecf.y * 1000;
      buf[i * 3 + 2] = p.ecf.z * 1000;
    }
    (self as any).postMessage({ type: 'pos', id: m.id, t: m.t, buf }, [buf.buffer]);
  } else if (m.type === 'passes') {
    const r = recs[m.idx];
    const obs = { latitude: m.lat * DEG, longitude: m.lon * DEG, height: m.h / 1000 };
    const out: { aos: number; los: number; maxEl: number; maxAt: number }[] = [];
    if (r) {
      const step = 20_000;
      let cur: { aos: number; maxEl: number; maxAt: number } | null = null;
      const end = m.t + m.hours * 3600_000;
      for (let t = m.t; t < end && out.length < 12; t += step) {
        const d = new Date(t);
        const g = gstime(d);
        const p = ecefAt(r, d, g);
        if (!p) break;
        const el = ecfToLookAngles(obs, p.ecf).elevation / DEG;
        if (el > 0) {
          if (!cur) cur = { aos: t, maxEl: el, maxAt: t };
          else if (el > cur.maxEl) {
            cur.maxEl = el;
            cur.maxAt = t;
          }
        } else if (cur) {
          if (cur.maxEl >= 5) out.push({ ...cur, los: t });
          cur = null;
        }
      }
    }
    (self as any).postMessage({ type: 'passes', reqId: m.reqId, passes: out });
  } else if (m.type === 'overhead') {
    const obs = { latitude: m.lat * DEG, longitude: m.lon * DEG, height: m.h / 1000 };
    const d = new Date(m.t);
    const g = gstime(d);
    const res: { idx: number; az: number; el: number; range: number; alt: number }[] = [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r) continue;
      const p = ecefAt(r, d, g);
      if (!p || !Number.isFinite(p.ecf.x)) continue;
      const la = ecfToLookAngles(obs, p.ecf);
      const el = la.elevation / DEG;
      if (el >= m.minEl) {
        const geo = eciToGeodetic(p.eci, g);
        res.push({ idx: i, az: la.azimuth / DEG, el, range: la.rangeSat, alt: geo.height });
      }
    }
    res.sort((a, b) => b.el - a.el);
    (self as any).postMessage({ type: 'overhead', reqId: m.reqId, list: res });
  } else if (m.type === 'aoiSats') {
    // which candidate satellites have their sub-satellite point inside each AOI right now
    const d = new Date(m.t);
    const g = gstime(d);
    const hits: { aoi: number; idx: number; lat: number; lon: number; alt: number }[] = [];
    for (const i of m.idxs) {
      const r = recs[i];
      if (!r) continue;
      const pv = propagate(r, d);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const geo = eciToGeodetic(pv.position, g);
      const lat = geo.latitude / DEG;
      const lon = geo.longitude / DEG;
      if (!Number.isFinite(lat)) continue;
      for (let k = 0; k < m.shapes.length; k++) if (inShape(lat, lon, m.shapes[k])) hits.push({ aoi: k, idx: i, lat, lon, alt: geo.height });
    }
    (self as any).postMessage({ type: 'aoiSats', reqId: m.reqId, list: hits });
  } else if (m.type === 'revisit') {
    revisit(m).then((list) => (self as any).postMessage({ type: 'revisit', reqId: m.reqId, list }));
  }
};

