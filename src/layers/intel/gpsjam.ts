// GPS-interference heat layer (ESTIMATE). Aggregates ADS-B navigation-accuracy reports from every
// aircraft feed this session sees (live flights, military) plus its own samples: the global
// military feed and a regional sweep around the view centre.
import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  Primitive,
  Rectangle,
  RectangleGeometry,
} from 'cesium';
import { bus } from '../../core/bus';
import { getData, describeError, Poller } from '../../data/fetcher';
import { viewCenter } from '../../core/viewer';
import { ago, fmtLL } from '../../core/fmt';
import { pid, type LayerFactory } from '../Layer';
import { NavGrid, cellBounds, type CellStat } from './gpsjamGrid';

const COL = {
  low: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#7cffb2').withAlpha(0.12)),
  medium: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#ffb347').withAlpha(0.35)),
  high: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#ff3b5c').withAlpha(0.45)),
};

const factory: LayerFactory = (ctx) => {
  const grid = new NavGrid();
  let prim: Primitive | undefined;
  let stats = new Map<string, CellStat>();
  let off: (() => void) | undefined;
  let poller: Poller | undefined;
  let dirty = false;
  let paintTimer: number | undefined;
  let sig = '';

  const ingest = (items: { hex: string; lat: number; lon: number; nacp: number; nic?: number; t: number }[]) => {
    for (const a of items) grid.add(a.hex, a.lat, a.lon, a.nacp, a.nic, a.t);
    dirty = true;
  };

  const sample = async () => {
    const now = Date.now();
    const take = (data: any) => {
      const list = (data.ac ?? data.aircraft ?? []) as any[];
      ingest(
        list
          .filter((a) => a.lat != null && typeof a.nac_p === 'number' && a.alt_baro !== 'ground')
          .map((a) => ({ hex: a.hex, lat: a.lat, lon: a.lon, nacp: a.nac_p, nic: a.nic, t: now - (a.seen_pos ?? a.seen ?? 0) * 1000 })),
      );
    };
    try {
      const mil = await getData<any>('https://api.adsb.lol/v2/mil', { via: 'proxy', ttl: 25_000 });
      take(mil.data);
      const c = viewCenter();
      if (c.dist < 6e6) {
        const r = await getData<any>(`https://api.adsb.lol/v2/point/${c.lat.toFixed(1)}/${c.lon.toFixed(1)}/250`, { via: 'proxy', ttl: 30_000, timeout: 15000 });
        take(r.data);
      }
    } catch (e) {
      const d = describeError(e);
      if (!grid.reports) {
        ctx.status(d.status, d.detail);
        throw e;
      }
    }
    paint();
  };

  const paint = () => {
    if (!dirty) return;
    dirty = false;
    grid.prune(Date.now());
    const list = grid.stats();
    stats = new Map(list.map((s) => [s.key, s]));
    const nsig = list.map((s) => `${s.key}:${s.level}`).join('|');
    const flagged = list.filter((s) => s.level !== 'low').length;
    ctx.status('live', `ESTIMATE · ${list.length} cells ≥3 aircraft · ${flagged} degraded · ${grid.reports.toLocaleString()} reports`, flagged);
    if (nsig === sig) return; // same picture: don't rebuild geometry
    sig = nsig;
    const instances = list.map((s) => {
      const b = cellBounds(s.key);
      return new GeometryInstance({
        geometry: new RectangleGeometry({ rectangle: Rectangle.fromDegrees(b.west, b.south, b.east, b.north), height: 2000, vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
        attributes: { color: COL[s.level] },
        id: pid(ctx.id, s.key),
      });
    });
    const next = instances.length
      ? (ctx.viewer.scene.primitives.add(new Primitive({ geometryInstances: instances, appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: true })) as Primitive)
      : undefined;
    if (prim) ctx.viewer.scene.primitives.remove(prim);
    prim = next;
    ctx.requestRender();
  };

  return {
    enable() {
      sig = '';
      off = bus.on('nav', (e) => ingest(e.items));
      poller = new Poller(sample, 60_000);
      poller.start();
      paintTimer = window.setInterval(paint, 15_000);
    },
    disable() {
      off?.();
      poller?.stop();
      clearInterval(paintTimer);
      if (prim) ctx.viewer.scene.primitives.remove(prim);
      prim = undefined;
      stats.clear();
    },
    pick(key) {
      const s = stats.get(key);
      if (!s) return;
      const b = cellBounds(key);
      const lat = (b.south + b.north) / 2;
      const lon = (b.west + b.east) / 2;
      return {
        layer: ctx.id,
        key,
        kind: 'GNSS INTERFERENCE (ESTIMATE)',
        title: `CELL ${fmtLL(lat, lon).replace(/\.\d+/g, '')}`,
        subtitle: `${s.level.toUpperCase()} · ${(s.share * 100).toFixed(0)}% of aircraft degraded`,
        classification: s.level === 'high' ? 'ESTIMATE // POSSIBLE GNSS JAMMING OR SPOOFING' : 'ESTIMATE // OSINT',
        fields: [
          ['AIRCRAFT (30 MIN)', String(s.total)],
          ['DEGRADED (NACp < 8)', String(s.bad)],
          ['SHARE', `${(s.share * 100).toFixed(1)}%`],
          ['LAST REPORT', ago(s.last)],
          ['CELL', `${b.south}…${b.north}° lat · ${b.west}…${b.east}° lon`],
          ['CAVEAT', 'derived from ADS-B accuracy fields; avionics faults also degrade NACp'],
        ],
        position: () => Cartesian3.fromDegrees(lon, lat),
        range: 6e5,
      };
    },
  };
};
export default factory;
