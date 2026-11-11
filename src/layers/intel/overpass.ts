// OpenStreetMap Overpass queries for the current view (only when zoomed in).
import { BillboardCollection, Cartesian3, NearFarScalar, Math as CMath, type Billboard } from 'cesium';
import { getData, describeError } from '../../data/fetcher';
import { cameraInfo } from '../../core/viewer';
import { icon, fmtLL, esc } from '../../core/fmt';
import { pid, type LayerFactory } from '../Layer';

const MAX_ALT = 600_000;
const SCALE = new NearFarScalar(1e3, 1.3, 1e6, 0.5);

const KINDS: Record<string, { q: string; color: string; icon: Parameters<typeof icon>[0] }> = {
  military: { q: 'nwr["military"]({{bbox}});nwr["landuse"="military"]({{bbox}});', color: '#ff3b5c', icon: 'diamond' },
  nuclear: { q: 'nwr["plant:source"="nuclear"]({{bbox}});nwr["generator:source"="nuclear"]["power"="plant"]({{bbox}});nwr["reactor"]({{bbox}});', color: '#d4ff3d', icon: 'tri' },
  power: { q: 'nwr["power"="plant"]({{bbox}});nwr["power"="substation"]["voltage"~"^[2-9][0-9]{5}"]({{bbox}});', color: '#ffd166', icon: 'diamond' },
  airports: { q: 'nwr["aeroway"="aerodrome"]({{bbox}});nwr["aeroway"="heliport"]({{bbox}});', color: '#9be7ff', icon: 'cross' },
  ports: { q: 'nwr["harbour"]({{bbox}});nwr["industrial"="port"]({{bbox}});nwr["landuse"="port"]({{bbox}});', color: '#00e5ff', icon: 'ring' },
  towers: { q: 'nwr["man_made"~"^(mast|tower)$"]["tower:type"~"communication|radar"]({{bbox}});nwr["man_made"="antenna"]({{bbox}});', color: '#b388ff', icon: 'radio' },
};

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

export function overpassLayer(kind: string): LayerFactory {
  const K = KINDS[kind];
  return (ctx) => {
    let coll: BillboardCollection | undefined;
    const els = new Map<string, any>();
    const bbs = new Map<string, Billboard>();
    let moveOff: (() => void) | undefined;
    let timer: number | undefined;
    let lastBox = '';

    const refresh = async () => {
      if (!coll) return;
      const c = cameraInfo();
      if (c.alt > MAX_ALT) {
        ctx.status('standby', `zoom below ${MAX_ALT / 1000} km to scan`, els.size);
        return;
      }
      const rect = ctx.viewer.camera.computeViewRectangle();
      if (!rect) return;
      const r = (v: number) => CMath.toDegrees(v).toFixed(2);
      const box = `${r(rect.south)},${r(rect.west)},${r(rect.north)},${r(rect.east)}`;
      if (box === lastBox) return;
      lastBox = box;
      const q = `[out:json][timeout:25];(${K.q.replaceAll('{{bbox}}', box)});out center 400;`;
      ctx.status('loading', 'querying Overpass…', els.size);
      let lastErr: unknown;
      for (const ep of ENDPOINTS) {
        try {
          const res = await getData<any>(`${ep}?data=${encodeURIComponent(q)}`, { via: 'auto', ttl: 30 * 60_000, persist: true, timeout: 35000 });
          for (const e of res.data.elements ?? []) {
            const lat = e.lat ?? e.center?.lat;
            const lon = e.lon ?? e.center?.lon;
            if (lat == null) continue;
            const key = `${e.type}/${e.id}`;
            if (bbs.has(key)) continue;
            els.set(key, { ...e, lat, lon });
            bbs.set(key, coll.add({ position: Cartesian3.fromDegrees(lon, lat), image: icon(K.icon, K.color, 32), width: 18, height: 18, scaleByDistance: SCALE, id: pid(ctx.id, key) }));
          }
          ctx.status('live', `OSM ${new URL(ep).hostname} · view scan`, els.size);
          ctx.requestRender();
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      lastBox = ''; // allow a retry of the same view
      const d = describeError(lastErr);
      ctx.status(d.status, d.detail, els.size);
    };

    return {
      enable() {
        coll = ctx.viewer.scene.primitives.add(new BillboardCollection());
        lastBox = '';
        refresh();
        moveOff = ctx.viewer.camera.moveEnd.addEventListener(() => {
          clearTimeout(timer);
          timer = window.setTimeout(refresh, 1500);
        });
      },
      disable() {
        moveOff?.();
        clearTimeout(timer);
        if (coll) ctx.viewer.scene.primitives.remove(coll);
        coll = undefined;
        els.clear();
        bbs.clear();
      },
      pick(key) {
        const e = els.get(key);
        if (!e) return;
        const t = e.tags ?? {};
        const fields: [string, string][] = [['POSITION', fmtLL(e.lat, e.lon)]];
        for (const k of ['military', 'landuse', 'operator', 'power', 'plant:source', 'plant:output:electricity', 'aeroway', 'iata', 'icao', 'harbour', 'man_made', 'tower:type', 'height', 'website'])
          if (t[k]) fields.push([k.toUpperCase(), esc(t[k])]);
        return {
          layer: ctx.id,
          key,
          kind: `OSINT · ${kind.toUpperCase()}`,
          title: t.name ?? t['name:en'] ?? t.ref ?? `${kind} site`,
          subtitle: `OpenStreetMap ${key}`,
          fields,
          position: () => Cartesian3.fromDegrees(e.lon, e.lat),
          range: 6000,
          actions: [{ label: 'OSM ↗', run: () => window.open(`https://www.openstreetmap.org/${key}`, '_blank', 'noopener') }],
        };
      },
    };
  };
}
