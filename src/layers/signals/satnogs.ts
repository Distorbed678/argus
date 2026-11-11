// SatNOGS open ground-station network: online/testing stations (bundled snapshot) and recent +
// in-progress observations (live API via the relay). In-progress passes draw a downlink line from
// the station to the satellite, propagated from the TLE the observation itself carries.
import {
  BillboardCollection,
  Cartesian3,
  Color,
  Material,
  NearFarScalar,
  PolylineCollection,
  VerticalOrigin,
} from 'cesium';
import { twoline2satrec, propagate, gstime, eciToEcf, type SatRec } from 'satellite.js';
import { getData, describeError, Poller } from '../../data/fetcher';
import { bus } from '../../core/bus';
import { ago, esc, fmtLL, icon, utc } from '../../core/fmt';
import { pid, type Dossier, type LayerFactory } from '../Layer';

type Station = [number, string, number, number, number, 'O' | 'T', number, number | null, string | null, string];

interface Obs {
  id: number;
  start: string;
  end: string;
  ground_station: number;
  norad_cat_id: number;
  station_name: string;
  station_lat: number;
  station_lng: number;
  station_alt: number;
  status: string;
  tle0?: string;
  tle1?: string;
  tle2?: string;
  transmitter_description?: string;
  transmitter_mode?: string;
  observation_frequency?: number;
  max_altitude?: number;
  waterfall?: string;
  vetted_user?: string | null;
}

const API = 'https://network.satnogs.org/api/observations/?format=json';
const ON = Color.fromCssColorString('#7cffb2');
// string data URLs → one shared atlas entry per variant
const ICON_ON = icon('radio', '#7cffb2', 32);
const ICON_TEST = icon('radio', '#ffb347', 32);

const factory: LayerFactory = (ctx) => {
  let bbs: BillboardCollection | undefined;
  let lines: PolylineCollection | undefined;
  let poller: Poller | undefined;
  let timer: number | undefined;
  const stations = new Map<number, Station>();
  const obs = new Map<number, Obs>();
  const recs = new Map<number, SatRec | null>();

  const satName = (o: Obs) => (o.tle0 ?? '').replace(/^0 /, '').trim() || `NORAD ${o.norad_cat_id}`;
  const live = () => {
    const now = Date.now();
    return [...obs.values()].filter((o) => Date.parse(o.start) <= now && Date.parse(o.end) >= now);
  };

  const satPos = (o: Obs, t: number) => {
    let rec = recs.get(o.id);
    if (rec === undefined) {
      try {
        rec = o.tle1 && o.tle2 ? twoline2satrec(o.tle1, o.tle2) : null;
      } catch {
        rec = null;
      }
      recs.set(o.id, rec);
    }
    if (!rec) return null;
    const d = new Date(t);
    const pv = propagate(rec, d);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const e = eciToEcf(pv.position, gstime(d));
    return new Cartesian3(e.x * 1000, e.y * 1000, e.z * 1000);
  };

  const drawLinks = () => {
    if (!lines) return;
    lines.removeAll();
    const t = Date.now();
    for (const o of live()) {
      const p = satPos(o, t);
      if (!p) continue;
      lines.add({
        positions: [Cartesian3.fromDegrees(o.station_lng, o.station_lat, o.station_alt ?? 0), p],
        width: 2,
        material: Material.fromType('PolylineDash', { color: ON.withAlpha(0.85), dashLength: 8 }),
        id: pid(ctx.id, `o${o.id}`),
      });
    }
    ctx.requestRender();
  };

  const refresh = async () => {
    try {
      const [good, future] = await Promise.all([
        getData<Obs[]>(`${API}&status=good`, { via: 'proxy', ttl: 55_000, timeout: 20000 }),
        getData<Obs[]>(`${API}&status=future`, { via: 'proxy', ttl: 55_000, timeout: 20000 }).catch(() => ({ data: [] as Obs[] })),
      ]);
      obs.clear();
      for (const o of [...(good.data ?? []), ...(future.data ?? [])]) obs.set(o.id, o);
      if (recs.size > 500) recs.clear();
      drawLinks();
      const n = live().length;
      ctx.status(good.stale ? 'cached' : 'live', `${stations.size} stations · ${n} passes in progress · ${good.data?.length ?? 0} recent good obs`, stations.size);
    } catch (e) {
      // stations still work without the relay
      const d = describeError(e);
      ctx.status(d.status === 'proxy' ? 'proxy' : d.status, `${stations.size} stations (snapshot) · live observations: ${d.detail}`, stations.size);
      throw e;
    }
  };

  const stationDossier = (s: Station): Dossier => {
    const recent = [...obs.values()].filter((o) => o.ground_station === s[0]).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
    const extra = document.createElement('div');
    extra.className = 'passes';
    extra.innerHTML = recent.length
      ? `<div class="sub">OBSERVATIONS IN THE LIVE FEED</div><table>${recent
          .slice(0, 8)
          .map((o) => `<tr><td>${utc(Date.parse(o.start)).slice(5, 16)}</td><td>${esc(satName(o))}</td><td>${esc(o.transmitter_mode ?? '')}</td></tr>`)
          .join('')}</table>`
      : '<div class="dim">no observations from this station in the latest feed page</div>';
    return {
      layer: ctx.id,
      key: `s${s[0]}`,
      kind: 'GROUND STATION',
      title: s[1],
      subtitle: `SatNOGS #${s[0]} · ${s[5] === 'O' ? 'ONLINE' : 'TESTING'}`,
      fields: [
        ['POSITION', `${fmtLL(s[2], s[3])} · ${s[4]} m`],
        ['BANDS', s[9] || '—'],
        ['OBSERVATIONS', s[6].toLocaleString()],
        ['SUCCESS RATE', s[7] != null ? `${s[7]}%` : '—'],
        ['LAST SEEN', s[8] ? ago(Date.parse(s[8])) + ' (snapshot)' : '—'],
      ],
      extra,
      position: () => Cartesian3.fromDegrees(s[3], s[2], s[4]),
      range: 4e4,
      actions: [{ label: 'SATNOGS ↗', run: () => window.open(`https://network.satnogs.org/stations/${s[0]}/`, '_blank', 'noopener') }],
    };
  };

  const obsDossier = (o: Obs): Dossier => ({
    layer: ctx.id,
    key: `o${o.id}`,
    kind: 'DOWNLINK INTERCEPT',
    title: satName(o),
    subtitle: `${o.station_name} ← NORAD ${o.norad_cat_id}`,
    classification: 'SIGINT // AMATEUR OPEN NETWORK',
    fields: [
      ['WINDOW', `${utc(Date.parse(o.start)).slice(11, 19)}–${utc(Date.parse(o.end)).slice(11, 19)}`],
      ['TRANSMITTER', o.transmitter_description ?? '—'],
      ['MODE', o.transmitter_mode ?? '—'],
      ['FREQUENCY', o.observation_frequency ? `${(o.observation_frequency / 1e6).toFixed(4)} MHz` : '—'],
      ['MAX ELEVATION', o.max_altitude != null ? `${o.max_altitude.toFixed(0)}°` : '—'],
      ['STATUS', o.status],
    ],
    position: () => satPos(o, Date.now()) ?? Cartesian3.fromDegrees(o.station_lng, o.station_lat),
    range: 2e6,
    actions: [
      { label: 'OBSERVATION ↗', run: () => window.open(`https://network.satnogs.org/observations/${o.id}/`, '_blank', 'noopener') },
      ...(o.waterfall ? [{ label: 'WATERFALL ↗', run: () => window.open(o.waterfall, '_blank', 'noopener') }] : []),
    ],
  });

  return {
    async enable() {
      bbs = ctx.viewer.scene.primitives.add(new BillboardCollection());
      lines = ctx.viewer.scene.primitives.add(new PolylineCollection());
      const r = await getData<{ s: Station[] }>('./data/satnogs-stations.json', { ttl: 86400_000 });
      const scale = new NearFarScalar(1e5, 1.1, 2e7, 0.5);
      for (const s of r.data.s) {
        stations.set(s[0], s);
        bbs.add({ position: Cartesian3.fromDegrees(s[3], s[2], s[4]), image: s[5] === 'O' ? ICON_ON : ICON_TEST, width: 16, height: 16, scaleByDistance: scale, verticalOrigin: VerticalOrigin.CENTER, id: pid(ctx.id, `s${s[0]}`) });
      }
      bus.emit('feed', { layer: ctx.id, items: [...stations.values()].map((s) => ({ key: `s${s[0]}`, lat: s[2], lon: s[3], label: `SatNOGS ${s[1]}` })) });
      ctx.status('loading', `${stations.size} stations · fetching live observations`, stations.size);
      poller = new Poller(refresh, 60_000);
      poller.start();
      timer = window.setInterval(() => !document.hidden && drawLinks(), 5000);
    },
    disable() {
      poller?.stop();
      clearInterval(timer);
      if (bbs) ctx.viewer.scene.primitives.remove(bbs);
      if (lines) ctx.viewer.scene.primitives.remove(lines);
      bbs = lines = undefined;
      stations.clear();
      obs.clear();
      recs.clear();
      bus.emit('feed', { layer: ctx.id, items: [] });
    },
    pick(key) {
      if (key.startsWith('s')) {
        const s = stations.get(Number(key.slice(1)));
        return s ? stationDossier(s) : undefined;
      }
      const o = obs.get(Number(key.slice(1)));
      return o ? obsDossier(o) : undefined;
    },
    locate(key) {
      const s = stations.get(Number(key.slice(1)));
      return s ? { lat: s[2], lon: s[3], alt: s[4] } : undefined;
    },
    find(q) {
      const s = q.trim().toLowerCase();
      for (const st of stations.values()) if (st[1].toLowerCase() === s) return stationDossier(st);
      return;
    },
  };
};

export default factory;
