/// <reference lib="webworker" />
// SGP4 propagation for the whole catalog, off the main thread.
import { json2satrec, propagate, gstime, eciToEcf, ecfToLookAngles, eciToGeodetic, type SatRec, type OMMJsonObject } from 'satellite.js';

let recs: (SatRec | null)[] = [];
const DEG = Math.PI / 180;

type Msg =
  | { type: 'load'; omms: OMMJsonObject[] }
  | { type: 'tick'; t: number; id: number }
  | { type: 'passes'; idx: number; lat: number; lon: number; h: number; t: number; hours: number; reqId: number }
  | { type: 'overhead'; lat: number; lon: number; h: number; t: number; minEl: number; reqId: number };

function ecefAt(rec: SatRec, date: Date, gmst: number) {
  const pv = propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  return { ecf: eciToEcf(pv.position, gmst), eci: pv.position };
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'load') {
    recs = m.omms.map((o) => {
      try {
        const r = json2satrec(o);
        return r && !r.error ? r : null;
      } catch {
        return null;
      }
    });
    (self as any).postMessage({ type: 'loaded', n: recs.length, ok: recs.filter(Boolean).length });
  } else if (m.type === 'tick') {
    const n = recs.length;
    const buf = new Float32Array(n * 3);
    const date = new Date(m.t);
    const gmst = gstime(date);
    for (let i = 0; i < n; i++) {
      const r = recs[i];
      const p = r ? ecefAt(r, date, gmst) : null;
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
  }
};

