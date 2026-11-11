// Objects about to re-enter: CelesTrak SPECIAL=DECAYING elements (CORS-enabled, cached 2 h for
// their fair-use rule), propagated with SGP4 on the main thread (only a few dozen objects) and a
// labelled drag-decay countdown estimate.
import { NearFarScalar } from 'cesium';
import { json2satrec, propagate, gstime, eciToGeodetic, type SatRec, type OMMJsonObject } from 'satellite.js';
import { getData } from '../../data/fetcher';
import { simNow } from '../../core/clock';
import { dur, fmtLL, utc } from '../../core/fmt';
import { pointLayer } from '../pointLayer';
import { estimateDecay, uncertaintyDays, type DecayEstimate } from './decay';

interface Obj {
  omm: any;
  rec: SatRec | null;
  est: DecayEstimate | null;
  lat: number;
  lon: number;
  alt: number; // km
}

const TTL = 2 * 3600_000;
const recs = new Map<number, SatRec | null>();
let gp: any[] = [];
let gpAt = 0;

const countdown = (at: number) => {
  const s = (at - Date.now()) / 1000;
  return s > 0 ? `T−${dur(s)}` : `overdue ${dur(-s)}`;
};
const color = (e: DecayEstimate | null) => (!e ? '#8aa4c8' : e.days < 2 ? '#ff2d55' : e.days < 10 ? '#ff9f1c' : '#ffd166');

export default pointLayer<Obj>({
  interval: 20_000, // re-propagate positions; the element set itself is cached 2 h
  detail: 'CelesTrak DECAYING · SGP4 · re-entry ESTIMATE',
  scale: new NearFarScalar(2e5, 1.2, 3e7, 0.6),
  load: async () => {
    const r = await getData<any[]>('https://celestrak.org/NORAD/elements/gp.php?SPECIAL=DECAYING&FORMAT=json', { ttl: TTL, persist: true, cacheKey: 'celestrak:decaying', timeout: 30000 });
    if (r.at !== gpAt) {
      gp = r.data;
      gpAt = r.at;
    }
    const t = simNow();
    const d = new Date(t);
    const g = gstime(d);
    const out: Obj[] = [];
    for (const o of gp) {
      let rec = recs.get(o.NORAD_CAT_ID);
      if (rec === undefined) {
        try {
          rec = json2satrec(o as OMMJsonObject);
        } catch {
          rec = null;
        }
        recs.set(o.NORAD_CAT_ID, rec);
      }
      if (!rec) continue;
      const pv = propagate(rec, d);
      if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
      const geo = eciToGeodetic(pv.position, g);
      out.push({ omm: o, rec, est: estimateDecay(o), lat: (geo.latitude * 180) / Math.PI, lon: (geo.longitude * 180) / Math.PI, alt: geo.height });
    }
    out.sort((a, b) => (a.est?.at ?? Infinity) - (b.est?.at ?? Infinity));
    return { data: out, fromCache: r.fromCache, stale: r.stale };
  },
  toItem: (o) => ({ key: String(o.omm.NORAD_CAT_ID), lat: o.lat, lon: o.lon, h: o.alt * 1000, color: color(o.est), icon: 'tri', size: o.est && o.est.days < 2 ? 22 : 16 }),
  label: (o) => `${o.omm.OBJECT_NAME} re-entry est. ${o.est ? countdown(o.est.at) : '?'}`,
  onNew: (o, ctx) => {
    if (o.est && o.est.days < 2) ctx.log(`${o.omm.OBJECT_NAME} (NORAD ${o.omm.NORAD_CAT_ID}) re-entry estimated ${countdown(o.est.at)}`, 'warn', o);
  },
  match: (o, q) => o.omm.OBJECT_NAME.toLowerCase().includes(q.toLowerCase()) || String(o.omm.NORAD_CAT_ID) === q.trim(),
  dossier: (o) => {
    const e = o.est;
    const u = e ? uncertaintyDays(e.days) : 0;
    return {
      kind: 'DECAYING OBJECT',
      title: o.omm.OBJECT_NAME,
      subtitle: `NORAD ${o.omm.NORAD_CAT_ID} · ${o.omm.OBJECT_ID}`,
      classification: e && e.days < 2 ? 'PRIORITY // RE-ENTRY IMMINENT (ESTIMATE)' : undefined,
      fields: [
        ['ELEMENT EPOCH', `${String(o.omm.EPOCH).replace('T', ' ').slice(0, 19)}Z`],
        ['PERIGEE / APOGEE', e ? `${e.perigeeKm.toFixed(0)} / ${e.apogeeKm.toFixed(0)} km` : '—'],
        ['DECAY RATE', e ? `${(-e.dhdt).toFixed(2)} km/day` : '—'],
        ['RE-ENTRY (EST.)', e ? `${utc(e.at).slice(0, 16)} ± ${dur(u * 86400)}` : 'not estimable'],
        ['METHOD', 'drag-decay estimate from mean-motion derivative · not an official prediction'],
      ],
      ref: String(o.omm.NORAD_CAT_ID),
      live: () => [
        ['COUNTDOWN', e ? `${countdown(e.at)} (est.)` : '—'],
        ['SUB-POINT', fmtLL(o.lat, o.lon)],
        ['ALTITUDE', `${o.alt.toFixed(1)} km`],
      ],
      actions: [{ label: 'AEROSPACE ↗', run: () => window.open('https://aerospace.org/reentries', '_blank', 'noopener') }],
      range: 2.5e6,
    };
  },
});
