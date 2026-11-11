// US Temporary Flight Restrictions: FAA TFR GeoServer polygons, filtered to NOTAMs on the FAA's
// current TFR list. tfr.faa.gov sends no CORS headers, so both go through the relay.
import {
  BillboardCollection,
  Cartesian3,
  Color,
  Material,
  NearFarScalar,
  PolylineCollection,
  VerticalOrigin,
} from 'cesium';
import { getData, describeError, Poller } from '../../data/fetcher';
import { bus } from '../../core/bus';
import { icon, fmtLL } from '../../core/fmt';
import { densify, shapeCenter, type LatLon } from '../../core/geo';
import { pid, type Dossier, type LayerFactory } from '../Layer';

interface Tfr {
  id: string; // NOTAM id, e.g. 6/7098
  key: string;
  title: string;
  legal: string;
  type?: string;
  facility?: string;
  state?: string;
  created?: string;
  rings: LatLon[][];
  lat: number;
  lon: number;
}

const WFS = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326';
const LIST = 'https://tfr.faa.gov/tfrapi/exportTfrList';
const COLORS: Record<string, string> = { SECURITY: '#ff3b5c', 'SPACE OPERATIONS': '#b388ff', HAZARDS: '#ff9f1c', VIP: '#ff2d55', 'SPECIAL': '#ffd166' };
const colorOf = (t: Tfr) => COLORS[(t.type ?? t.legal ?? '').toUpperCase()] ?? '#ffd166';

const factory: LayerFactory = (ctx) => {
  let lc: PolylineCollection | undefined;
  let bbs: BillboardCollection | undefined;
  let poller: Poller | undefined;
  const tfrs = new Map<string, Tfr>();
  let sig = '';

  const refresh = async () => {
    try {
      const [geo, list] = await Promise.all([
        getData<any>(WFS, { via: 'proxy', ttl: 14 * 60_000, persist: true, timeout: 30000 }),
        getData<any[]>(LIST, { via: 'proxy', ttl: 14 * 60_000, persist: true, timeout: 30000 }),
      ]);
      const current = new Map<string, any>((list.data ?? []).map((x) => [String(x.notam_id), x]));
      const next = new Map<string, Tfr>();
      for (const f of geo.data.features ?? []) {
        const p = f.properties ?? {};
        const id = String(p.NOTAM_KEY ?? '').split('-')[0];
        const meta = current.get(id);
        if (!meta || f.geometry?.type !== 'Polygon') continue; // not on the active list = expired
        const rings: LatLon[][] = f.geometry.coordinates.map((r: [number, number][]) => r.map(([x, y]) => [y, x] as LatLon));
        const key = `${p.NOTAM_KEY}|${p.GID}`;
        const c = shapeCenter({ kind: 'poly', pts: rings[0] });
        next.set(key, { id, key, title: p.TITLE ?? meta.description, legal: p.LEGAL ?? '', type: meta.type, facility: meta.facility, state: meta.state, created: meta.creation_date, rings, lat: c.lat, lon: c.lon });
      }
      const nsig = [...next.keys()].sort().join(',');
      if (nsig !== sig) {
        sig = nsig;
        tfrs.clear();
        for (const [k, v] of next) tfrs.set(k, v);
        draw();
      }
      bus.emit('feed', { layer: ctx.id, items: [...tfrs.values()].map((t) => ({ key: t.key, lat: t.lat, lon: t.lon, label: `TFR ${t.id} ${t.type ?? t.legal}` })) });
      ctx.status(geo.stale || list.stale ? 'cached' : 'live', `FAA TFR · ${current.size} NOTAMs, ${tfrs.size} mapped areas`, tfrs.size);
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail, tfrs.size);
      throw e;
    }
  };

  const draw = () => {
    lc!.removeAll();
    bbs!.removeAll();
    const scale = new NearFarScalar(5e4, 1.1, 8e6, 0.45);
    for (const t of tfrs.values()) {
      const col = Color.fromCssColorString(colorOf(t));
      for (const r of t.rings) lc!.add({ positions: densify(r, 20).map(([la, lo]) => Cartesian3.fromDegrees(lo, la, 300)), width: 2, material: Material.fromType('Color', { color: col.withAlpha(0.85) }) });
      bbs!.add({ position: Cartesian3.fromDegrees(t.lon, t.lat, 300), image: icon('tri', colorOf(t), 32), width: 16, height: 16, scaleByDistance: scale, verticalOrigin: VerticalOrigin.CENTER, id: pid(ctx.id, t.key) });
    }
    ctx.requestRender();
  };

  const dossier = (key: string): Dossier | undefined => {
    const t = tfrs.get(key);
    if (!t) return;
    return {
      layer: ctx.id,
      key,
      kind: 'AIRSPACE RESTRICTION',
      title: `TFR ${t.id}`,
      subtitle: t.title,
      classification: /SECURITY|VIP/i.test(t.type ?? t.legal) ? 'RESTRICTED // NATIONAL DEFENSE AIRSPACE' : undefined,
      fields: [
        ['TYPE', t.type ?? t.legal ?? '—'],
        ['FACILITY', `${t.facility ?? '—'} · ${t.state ?? ''}`],
        ['ISSUED', t.created ?? '—'],
        ['CENTRE', fmtLL(t.lat, t.lon)],
        ['VERTICES', String(t.rings[0]?.length ?? 0)],
      ],
      position: () => Cartesian3.fromDegrees(t.lon, t.lat),
      range: 1.5e5,
      actions: [{ label: 'FAA NOTAM ↗', run: () => window.open(`https://tfr.faa.gov/tfr3/?page=detail_${t.id.replace('/', '_')}`, '_blank', 'noopener') }],
    };
  };

  return {
    enable() {
      lc = ctx.viewer.scene.primitives.add(new PolylineCollection());
      bbs = ctx.viewer.scene.primitives.add(new BillboardCollection());
      sig = '';
      poller = new Poller(refresh, 15 * 60_000);
      poller.start();
    },
    disable() {
      poller?.stop();
      if (lc) ctx.viewer.scene.primitives.remove(lc);
      if (bbs) ctx.viewer.scene.primitives.remove(bbs);
      lc = bbs = undefined;
      tfrs.clear();
      bus.emit('feed', { layer: ctx.id, items: [] });
    },
    pick: dossier,
    locate(key) {
      const t = tfrs.get(key);
      return t ? { lat: t.lat, lon: t.lon } : undefined;
    },
    find(q) {
      const s = q.trim().toUpperCase();
      for (const t of tfrs.values()) if (`TFR ${t.id}` === s || t.id === s) return dossier(t.key);
      return;
    },
  };
};
export default factory;
