// Active tropical cyclones (Atlantic, East & Central Pacific): NHC/CPHC forecast cones, forecast
// and past tracks, forecast points. Source: NOAA's NHC ArcGIS MapServer, which is CORS-enabled.
import {
  BillboardCollection,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPrimitive,
  Material,
  NearFarScalar,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  VerticalOrigin,
} from 'cesium';
import { getData, describeError, Poller } from '../../data/fetcher';
import { bus } from '../../core/bus';
import { icon, fmtLL } from '../../core/fmt';
import { densify, type LatLon } from '../../core/geo';
import { pid, type Dossier, type FeedItem, type LayerFactory } from '../Layer';

const BASE = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
const SLOTS = ['AT1', 'AT2', 'AT3', 'AT4', 'AT5', 'EP1', 'EP2', 'EP3', 'EP4', 'EP5', 'CP1', 'CP2', 'CP3', 'CP4', 'CP5'];
// layer ids follow a fixed stride of 26 per storm slot (AT1 forecast points = 6, cone = 8, …)
const lid = (slot: number, off: number) => 6 + slot * 26 + off;
const OFF = { points: 0, track: 1, cone: 2, past: 6 };

const TYPE: Record<string, string> = { HU: 'Hurricane', MH: 'Major hurricane', TS: 'Tropical storm', TD: 'Tropical depression', STS: 'Subtropical storm', STD: 'Subtropical depression', PTC: 'Potential tropical cyclone', PT: 'Post-tropical', TC: 'Tropical cyclone', LO: 'Remnant low', DB: 'Disturbance' };
const SS = (kt: number) => (kt >= 137 ? 5 : kt >= 113 ? 4 : kt >= 96 ? 3 : kt >= 83 ? 2 : kt >= 64 ? 1 : 0);
/** NHC names already carry the type ("Tropical Storm Pena"); only prefix bare names. */
const fullName = (p: Pt) => (/storm|hurricane|depression|cyclone|disturbance|remnant|low/i.test(p.stormname) ? p.stormname : `${TYPE[p.stormtype] ?? p.stormtype} ${p.stormname}`);
const color = (kt: number) => (kt >= 96 ? '#ff2d55' : kt >= 64 ? '#ff7a3d' : kt >= 34 ? '#ffd166' : '#4fc3ff');

interface Pt {
  stormname: string;
  stormtype: string;
  basin: string;
  advdate: string;
  advisnum: string;
  maxwind: number;
  gust: number;
  mslp: number;
  tcdir: number;
  tcspd: number;
  tau: number;
  datelbl: string;
  fldatelbl: string;
  lat: number;
  lon: number;
}

interface Storm {
  slot: string;
  pts: Pt[];
  cone: LatLon[][];
  track: LatLon[][];
  past: LatLon[][];
}

const q = (layer: number, extra = '') => `${BASE}/${layer}/query?where=1%3D1&outFields=*&f=geojson${extra}`;
const lines = (gj: any): LatLon[][] =>
  (gj?.features ?? []).flatMap((f: any) => {
    const g = f.geometry;
    if (!g) return [];
    const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p: any) => p[0]) : [];
    return parts.map((ring: [number, number][]) => ring.map(([x, y]) => [y, x] as LatLon));
  });

const factory: LayerFactory = (ctx) => {
  let bbs: BillboardCollection | undefined;
  let lc: PolylineCollection | undefined;
  let fills: GroundPrimitive[] = [];
  let poller: Poller | undefined;
  let storms: Storm[] = [];
  let sig = '';

  const clear = () => {
    bbs?.removeAll();
    lc?.removeAll();
    for (const f of fills) ctx.viewer.scene.primitives.remove(f);
    fills = [];
  };

  const draw = () => {
    clear();
    const scale = new NearFarScalar(2e5, 1.2, 2e7, 0.6);
    for (const s of storms) {
      const cur = s.pts.find((p) => p.tau === 0) ?? s.pts[0];
      const col = Color.fromCssColorString(color(cur?.maxwind ?? 0));
      for (const ring of s.cone) {
        lc!.add({ positions: densify(ring, 40).map(([la, lo]) => Cartesian3.fromDegrees(lo, la, 500)), width: 1.5, material: Material.fromType('Color', { color: Color.WHITE.withAlpha(0.75) }) });
        try {
          const f = new GroundPrimitive({
            geometryInstances: new GeometryInstance({
              geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(ring.map(([la, lo]) => Cartesian3.fromDegrees(lo, la))) }),
              attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.WHITE.withAlpha(0.13)) },
            }),
            appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          });
          ctx.viewer.scene.primitives.add(f);
          fills.push(f);
        } catch (e) {
          console.warn('[storms] cone', e);
        }
      }
      for (const l of s.past) lc!.add({ positions: densify(l, 40).map(([la, lo]) => Cartesian3.fromDegrees(lo, la, 800)), width: 2.5, material: Material.fromType('Color', { color: col.withAlpha(0.9) }) });
      for (const l of s.track) lc!.add({ positions: densify(l, 40).map(([la, lo]) => Cartesian3.fromDegrees(lo, la, 800)), width: 2, material: Material.fromType('PolylineDash', { color: col, dashLength: 12 }) });
      for (const p of s.pts) {
        const now = p.tau === 0;
        bbs!.add({
          position: Cartesian3.fromDegrees(p.lon, p.lat, 1000),
          image: icon(now ? 'cross' : 'ring', color(p.maxwind), 32),
          width: now ? 30 : 14,
          height: now ? 30 : 14,
          scaleByDistance: scale,
          verticalOrigin: VerticalOrigin.CENTER,
          id: pid(ctx.id, `${s.slot}|${p.tau}`),
        });
      }
    }
    ctx.requestRender();
  };

  const refresh = async () => {
    try {
      // which storm slots are active: one cheap count query per slot
      const counts = await Promise.all(
        SLOTS.map((_, i) => getData<any>(q(lid(i, OFF.points), '&returnCountOnly=true').replace('f=geojson', 'f=json'), { ttl: 25 * 60_000, persist: true }).then((r) => [i, r.data.count ?? 0] as const)),
      );
      const active = counts.filter(([, n]) => n > 0).map(([i]) => i);
      const next: Storm[] = [];
      for (const i of active) {
        const [pts, track, cone, past] = await Promise.all(
          [OFF.points, OFF.track, OFF.cone, OFF.past].map((o) => getData<any>(q(lid(i, o)), { ttl: 25 * 60_000, persist: true }).then((r) => r.data).catch(() => null)),
        );
        const list: Pt[] = (pts?.features ?? []).map((f: any) => ({ ...f.properties, lat: f.geometry?.coordinates?.[1] ?? f.properties.lat, lon: f.geometry?.coordinates?.[0] ?? f.properties.lon }));
        list.sort((a, b) => a.tau - b.tau);
        if (list.length) next.push({ slot: SLOTS[i], pts: list, track: lines(track), cone: lines(cone), past: lines(past) });
      }
      const nsig = JSON.stringify(next.map((s) => [s.slot, s.pts[0]?.advisnum, s.pts.length]));
      if (nsig !== sig) {
        // new advisory → redraw (and announce storms we haven't seen this session)
        const before = new Set(storms.map((s) => s.slot + s.pts[0]?.stormname));
        storms = next;
        sig = nsig;
        draw();
        for (const s of storms) {
          const c = s.pts[0];
          if (!before.has(s.slot + c.stormname)) ctx.log(`${fullName(c)}: ${c.maxwind} kt, ${c.mslp} mb · advisory ${c.advisnum}`, c.maxwind >= 64 ? 'alert' : 'warn', c);
        }
      }
      const items: FeedItem[] = storms.map((s) => ({ key: s.slot, lat: s.pts[0].lat, lon: s.pts[0].lon, label: fullName(s.pts[0]) }));
      bus.emit('feed', { layer: ctx.id, items });
      ctx.status('live', storms.length ? `NHC/CPHC · ${storms.map((s) => s.pts[0].stormname).join(', ')}` : 'NHC/CPHC · no active cyclones (Atlantic / E+C Pacific)', storms.length);
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail, storms.length);
      throw e;
    }
  };

  const dossier = (key: string): Dossier | undefined => {
    const [slot, tauS] = key.split('|');
    const s = storms.find((x) => x.slot === slot);
    const p = s?.pts.find((x) => String(x.tau) === tauS);
    if (!s || !p) return;
    const c = s.pts[0];
    const cat = SS(p.maxwind);
    return {
      layer: ctx.id,
      key,
      kind: 'TROPICAL CYCLONE',
      title: fullName(c).toUpperCase(),
      subtitle: `${p.tau === 0 ? 'current position' : `forecast +${p.tau} h (${p.datelbl})`} · ${slot} basin slot`,
      classification: cat >= 3 ? 'PRIORITY // MAJOR HURRICANE' : undefined,
      fields: [
        ['ADVISORY', `#${c.advisnum} · ${c.advdate}`],
        ['VALID', p.fldatelbl ?? p.datelbl],
        ['POSITION', fmtLL(p.lat, p.lon)],
        ['MAX WIND', `${p.maxwind} kt (gust ${p.gust} kt)${cat ? ` · Cat ${cat}` : ''}`],
        ['PRESSURE', p.mslp && p.mslp < 9000 ? `${p.mslp} mb` : '—'],
        ['MOTION', c.tcspd != null ? `${c.tcdir}° at ${c.tcspd} kt` : '—'],
        ['FORECAST POINTS', String(s.pts.length)],
        ['CONE', 'NHC 5-day track uncertainty (2/3 probability)'],
      ],
      position: () => Cartesian3.fromDegrees(p.lon, p.lat),
      range: 3e6,
      actions: [{ label: 'NHC ↗', run: () => window.open('https://www.nhc.noaa.gov/', '_blank', 'noopener') }],
    };
  };

  return {
    enable() {
      bbs = ctx.viewer.scene.primitives.add(new BillboardCollection());
      lc = ctx.viewer.scene.primitives.add(new PolylineCollection());
      sig = '';
      poller = new Poller(refresh, 30 * 60_000);
      poller.start();
    },
    disable() {
      poller?.stop();
      clear();
      if (bbs) ctx.viewer.scene.primitives.remove(bbs);
      if (lc) ctx.viewer.scene.primitives.remove(lc);
      bbs = lc = undefined;
      storms = [];
      bus.emit('feed', { layer: ctx.id, items: [] });
    },
    pick: dossier,
    locate(key) {
      const s = storms.find((x) => x.slot === key.split('|')[0]);
      return s ? { lat: s.pts[0].lat, lon: s.pts[0].lon } : undefined;
    },
    find(qs) {
      const ql = qs.trim().toLowerCase();
      const s = ql.length > 2 ? storms.find((x) => x.pts[0].stormname.toLowerCase().split(' ').pop() === ql || x.pts[0].stormname.toLowerCase() === ql) : undefined;
      return s ? dossier(`${s.slot}|${s.pts[0].tau}`) : undefined;
    },
  };
};
export default factory;
