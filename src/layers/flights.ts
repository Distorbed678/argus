// Live aircraft. Zoomed in: adsb.lol (→ adsb.fi → airplanes.live) radius query at the view center.
// Zoomed out: OpenSky global snapshot. All through the CORS proxy. Dead-reckoned between polls.
import { BillboardCollection, Cartesian3, NearFarScalar, type Billboard } from 'cesium';
import { getData, describeError, Poller } from '../data/fetcher';
import { cameraInfo, viewCenter } from '../core/viewer';
import { icon, fmtLL, ago } from '../core/fmt';
import { pid, type Dossier, type LayerFactory } from './Layer';

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
}

const EMERG: Record<string, string> = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'GENERAL EMERGENCY' };

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
  };
}

function fromOpenSky(s: any[], src: string): Ac | null {
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

const altColor = (a: Ac) => {
  if (a.squawk && EMERG[a.squawk]) return '#ff2d55';
  if (a.mil) return '#ff9f1c';
  if (a.alt === 'ground') return '#6b7d99';
  const ft = a.alt;
  return ft > 30000 ? '#9be7ff' : ft > 15000 ? '#4fc3ff' : ft > 5000 ? '#2f80ff' : '#7cffb2';
};

export function deadReckon(a: Ac, t: number) {
  if (!a.gs || a.track == null || a.alt === 'ground') return { lat: a.lat, lon: a.lon };
  const dt = Math.min(120, Math.max(0, (t - a.seen) / 1000));
  const d = (a.gs * 0.514444 * dt) / 6371000;
  const tr = (a.track * Math.PI) / 180;
  const lat = a.lat + ((d * Math.cos(tr)) * 180) / Math.PI;
  const lon = a.lon + ((d * Math.sin(tr)) / Math.cos((a.lat * Math.PI) / 180)) * (180 / Math.PI);
  return { lat, lon };
}

export function acDossier(layer: string, a: Ac, get: () => Ac | undefined): Dossier {
  const pos = () => {
    const cur = get() ?? a;
    const p = deadReckon(cur, Date.now());
    return Cartesian3.fromDegrees(p.lon, p.lat, cur.alt === 'ground' ? 0 : cur.alt * 0.3048);
  };
  const emerg = a.squawk ? EMERG[a.squawk] : undefined;
  return {
    layer,
    key: a.hex,
    kind: a.mil ? 'MILITARY AIRCRAFT' : 'AIRCRAFT',
    title: a.flight || a.r || a.hex.toUpperCase(),
    subtitle: [a.t, a.desc, a.country].filter(Boolean).join(' · ') || 'ADS-B target',
    classification: emerg ? `EMERGENCY // SQUAWK ${a.squawk} ${emerg}` : a.mil ? 'MIL // ADS-B OPEN BROADCAST' : undefined,
    fields: [
      ['ICAO HEX', a.hex.toUpperCase()],
      ['REGISTRATION', a.r ?? '—'],
      ['TYPE', a.t ?? '—'],
      ['SOURCE', a.src],
    ],
    live: () => {
      const c = get() ?? a;
      const p = deadReckon(c, Date.now());
      return [
        ['POSITION', fmtLL(p.lat, p.lon)],
        ['ALTITUDE', c.alt === 'ground' ? 'ON GROUND' : `${Math.round(c.alt).toLocaleString()} ft`],
        ['GROUND SPEED', c.gs != null ? `${Math.round(c.gs)} kt` : '—'],
        ['TRACK', c.track != null ? `${Math.round(c.track)}°` : '—'],
        ['VERT RATE', c.baro_rate != null ? `${Math.round(c.baro_rate)} fpm` : '—'],
        ['SQUAWK', c.squawk ?? '—'],
        ['LAST FIX', ago(c.seen)],
      ];
    },
    position: pos,
    range: 60000,
    actions: [{ label: 'ADSBX ↗', run: () => window.open(`https://globe.adsbexchange.com/?icao=${a.hex}`, '_blank', 'noopener') }],
  };
}

/** Shared billboard manager for aircraft-like layers. */
export function acRenderer(ctx: Parameters<LayerFactory>[0]) {
  let coll: BillboardCollection | undefined;
  const bbs = new Map<string, Billboard>();
  const acs = new Map<string, Ac>();
  const scale = new NearFarScalar(5e4, 1.3, 1.2e7, 0.45);
  let off: (() => void) | undefined;
  let lastDR = 0;

  const place = (a: Ac, b: Billboard, t: number) => {
    const p = deadReckon(a, t);
    b.position = Cartesian3.fromDegrees(p.lon, p.lat, a.alt === 'ground' ? 0 : a.alt * 0.3048);
  };

  return {
    acs,
    start() {
      coll = ctx.viewer.scene.primitives.add(new BillboardCollection());
      off = ctx.viewer.scene.preUpdate.addEventListener(() => {
        const now = performance.now();
        if (now - lastDR < 250 || document.hidden || bbs.size === 0) return;
        if (bbs.size > 4000 && cameraInfo().alt > 3e6) return; // too far to see motion
        lastDR = now;
        const t = Date.now();
        for (const [k, b] of bbs) place(acs.get(k)!, b, t);
        ctx.requestRender();
      });
    },
    stop() {
      off?.();
      if (coll) ctx.viewer.scene.primitives.remove(coll);
      coll = undefined;
      bbs.clear();
      acs.clear();
    },
    update(list: Ac[], replace: boolean, onNew?: (a: Ac) => void) {
      if (!coll) return;
      const seen = new Set<string>();
      const t = Date.now();
      for (const a of list) {
        seen.add(a.hex);
        const prev = acs.get(a.hex);
        acs.set(a.hex, a);
        let b = bbs.get(a.hex);
        const col = altColor(a);
        if (!b) {
          b = coll.add({ position: Cartesian3.ZERO, image: icon('plane', col, 32), width: 18, height: 18, alignedAxis: Cartesian3.UNIT_Z, scaleByDistance: scale, id: pid(ctx.id, a.hex) });
          bbs.set(a.hex, b);
          if (!prev) onNew?.(a);
        } else if (prev && altColor(prev) !== col) b.image = icon('plane', col, 32) as any;
        b.rotation = -((a.track ?? 0) * Math.PI) / 180;
        place(a, b, t);
      }
      for (const [k, b] of bbs) {
        const a = acs.get(k)!;
        if ((replace && !seen.has(k)) || t - a.seen > 180_000) {
          coll.remove(b);
          bbs.delete(k);
          acs.delete(k);
        }
      }
      ctx.requestRender();
    },
  };
}

const factory: LayerFactory = (ctx) => {
  const r = acRenderer(ctx);
  let poller: Poller | undefined;
  let mode: 'regional' | 'global' | null = null;
  const alerted = new Set<string>();

  const checkEmerg = (a: Ac) => {
    if (a.squawk && EMERG[a.squawk] && !alerted.has(a.hex)) {
      alerted.add(a.hex);
      ctx.log(`SQUAWK ${a.squawk} ${EMERG[a.squawk]} — ${a.flight || a.hex} ${a.t ?? ''}`, 'alert', { lon: a.lon, lat: a.lat });
    }
  };

  const regional = async (lat: number, lon: number, nm: number) => {
    const now = Date.now();
    const la = lat.toFixed(2);
    const lo = lon.toFixed(2);
    const sources: [string, string][] = [
      ['adsb.lol', `https://api.adsb.lol/v2/point/${la}/${lo}/${nm}`],
      ['adsb.fi', `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${nm}`],
      ['airplanes.live', `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}`],
    ];
    let lastErr: unknown;
    for (const [name, url] of sources) {
      try {
        const res = await getData<any>(url, { via: 'proxy', ttl: 8000, timeout: 15000 });
        const list = ((res.data.ac ?? res.data.aircraft ?? []) as any[]).map((a) => fromAdsb(a, now, name)).filter(Boolean) as Ac[];
        return { list, name };
      } catch (e) {
        lastErr = e;
        if (describeError(e).status === 'proxy') break;
      }
    }
    throw lastErr;
  };

  const tick = async () => {
    const c = cameraInfo();
    const want = c.alt > 2.5e6 ? 'global' : 'regional';
    if (want !== mode) {
      mode = want;
      r.update([], true);
    }
    try {
      if (mode === 'global') {
        const res = await getData<any>('https://opensky-network.org/api/states/all', { via: 'proxy', ttl: 110_000, timeout: 30000 });
        const list = ((res.data.states ?? []) as any[]).map((s) => fromOpenSky(s, 'OpenSky')).filter(Boolean) as Ac[];
        r.update(list, true, checkEmerg);
        ctx.status(res.stale ? 'cached' : 'live', `GLOBAL · OpenSky snapshot ${ago(res.at)}`, r.acs.size);
      } else {
        const vc = viewCenter();
        const nm = Math.round(Math.max(30, Math.min(250, vc.dist / 1852 / 2.5)));
        const { list, name } = await regional(vc.lat, vc.lon, nm);
        r.update(list, false, checkEmerg);
        ctx.status('live', `REGIONAL ${nm}nm · ${name}`, r.acs.size);
      }
    } catch (e) {
      const d = describeError(e);
      if (mode === 'global') {
        // OpenSky anonymous quota exhausted? fall back to a regional sweep at view center
        try {
          const { list, name } = await regional(c.lat, c.lon, 250);
          r.update(list, false, checkEmerg);
          ctx.status('live', `OpenSky unavailable → ${name} 250nm`, r.acs.size);
          return;
        } catch {
          /* fallthrough */
        }
      }
      ctx.status(d.status, d.detail, r.acs.size);
      throw e;
    }
  };

  let moveOff: (() => void) | undefined;
  return {
    enable() {
      r.start();
      mode = null;
      poller = new Poller(tick, 10_000);
      poller.start();
      let debounce: number | undefined;
      moveOff = ctx.viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(debounce);
        debounce = window.setTimeout(() => poller?.kick(), 600);
      });
    },
    disable() {
      moveOff?.();
      poller?.stop();
      r.stop();
    },
    pick(key) {
      const a = r.acs.get(key);
      return a ? acDossier(ctx.id, a, () => r.acs.get(key)) : undefined;
    },
    find(q) {
      const s = q.trim().toUpperCase();
      for (const a of r.acs.values()) if (a.flight?.toUpperCase() === s || a.hex.toUpperCase() === s || a.r?.toUpperCase() === s) return acDossier(ctx.id, a, () => r.acs.get(a.hex));
      return;
    },
  };
};
export default factory;
