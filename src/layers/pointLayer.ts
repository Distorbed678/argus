// Generic "poll a feed → diffed billboards/points → pick → dossier" layer.
import {
  BillboardCollection,
  PointPrimitiveCollection,
  Cartesian3,
  Color,
  NearFarScalar,
  VerticalOrigin,
  type Billboard,
  type PointPrimitive,
} from 'cesium';
import { Poller, describeError } from '../data/fetcher';
import { icon as mkIcon } from '../core/fmt';
import { pid, type Dossier, type LayerFactory, type LayerCtx } from './Layer';

export interface Item {
  key: string;
  lon: number;
  lat: number;
  h?: number;
  color: string;
  icon?: Parameters<typeof mkIcon>[0];
  size?: number; // px
  rotation?: number; // radians, clockwise from north
}

export interface PointLayerOpts<T> {
  interval: number; // ms; 0 = load once
  load: (ctx: LayerCtx) => Promise<{ data: T[]; fromCache?: boolean; stale?: boolean }>;
  toItem: (t: T) => Item | null;
  dossier: (t: T, ctx: LayerCtx) => Omit<Dossier, 'layer' | 'key' | 'position'> & { position?: Dossier['position'] };
  detail: string;
  points?: boolean; // use PointPrimitives (huge counts) instead of billboards
  onNew?: (t: T, ctx: LayerCtx) => void;
  match?: (t: T, q: string) => boolean;
  scale?: NearFarScalar;
  onEnable?: (ctx: LayerCtx) => void;
  onDisable?: (ctx: LayerCtx) => void;
}

export function pointLayer<T>(o: PointLayerOpts<T>): LayerFactory {
  return (ctx) => {
    let coll: BillboardCollection | PointPrimitiveCollection | undefined;
    const prims = new Map<string, Billboard | PointPrimitive>();
    const items = new Map<string, T>();
    const itemPos = new Map<string, Item>();
    let first = true;
    let poller: Poller | undefined;
    const scale = o.scale ?? new NearFarScalar(2e5, 1.1, 2e7, 0.55);

    const refresh = async () => {
      try {
        const r = await o.load(ctx);
        const seen = new Set<string>();
        for (const t of r.data) {
          const it = o.toItem(t);
          if (!it || !Number.isFinite(it.lat) || !Number.isFinite(it.lon)) continue;
          seen.add(it.key);
          const pos = Cartesian3.fromDegrees(it.lon, it.lat, it.h ?? 0);
          let p = prims.get(it.key);
          if (!p) {
            if (!first) o.onNew?.(t, ctx);
            if (o.points) {
              p = (coll as PointPrimitiveCollection).add({
                position: pos,
                color: Color.fromCssColorString(it.color),
                pixelSize: it.size ?? 4,
                scaleByDistance: scale,
                id: pid(ctx.id, it.key),
              });
            } else {
              p = (coll as BillboardCollection).add({
                position: pos,
                image: mkIcon(it.icon ?? 'diamond', it.color, 32),
                width: it.size ?? 18,
                height: it.size ?? 18,
                rotation: it.rotation ? -it.rotation : 0,
                alignedAxis: it.rotation ? Cartesian3.UNIT_Z : Cartesian3.ZERO,
                scaleByDistance: scale,
                verticalOrigin: VerticalOrigin.CENTER,
                id: pid(ctx.id, it.key),
              });
            }
            prims.set(it.key, p);
          } else {
            p.position = pos;
          }
          items.set(it.key, t);
          itemPos.set(it.key, it);
        }
        for (const [k, p] of prims) {
          if (!seen.has(k)) {
            (coll as any).remove(p);
            prims.delete(k);
            items.delete(k);
            itemPos.delete(k);
          }
        }
        first = false;
        ctx.status(r.stale ? 'cached' : r.fromCache ? 'cached' : 'live', o.detail, prims.size);
        ctx.requestRender();
      } catch (e) {
        const d = describeError(e);
        ctx.status(d.status, d.detail, prims.size);
        throw e;
      }
    };

    const build = (key: string): Dossier | undefined => {
      const t = items.get(key);
      const it = itemPos.get(key);
      if (!t || !it) return;
      const d = o.dossier(t, ctx);
      return {
        layer: ctx.id,
        key,
        position: () => Cartesian3.fromDegrees(it.lon, it.lat, it.h ?? 0),
        ...d,
      };
    };

    return {
      async enable() {
        coll = ctx.viewer.scene.primitives.add(o.points ? new PointPrimitiveCollection() : new BillboardCollection());
        first = true;
        o.onEnable?.(ctx);
        if (o.interval > 0) {
          poller = new Poller(refresh, o.interval);
          poller.start();
        } else await refresh().catch(() => {});
      },
      disable() {
        poller?.stop();
        if (coll) ctx.viewer.scene.primitives.remove(coll);
        coll = undefined;
        prims.clear();
        items.clear();
        itemPos.clear();
        o.onDisable?.(ctx);
      },
      pick: build,
      find(q) {
        if (!o.match) return;
        for (const [k, t] of items) if (o.match(t, q)) return build(k);
        return;
      },
    };
  };
}
