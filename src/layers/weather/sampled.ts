// Generic "sample a point API on an N×N grid over the current view" layer (Open-Meteo style
// multi-location requests). Re-samples after the camera settles; values are pickable.
import { Math as CMath, type Viewer } from 'cesium';
import { getData, describeError, Poller } from '../../data/fetcher';
import type { Dossier, LayerCtx, LayerFactory } from '../Layer';

export interface Sample<T> {
  key: string;
  lat: number;
  lon: number;
  v: T;
}

export function viewGrid(viewer: Viewer, n: number) {
  const rect = viewer.camera.computeViewRectangle();
  if (!rect) return null;
  const w = CMath.toDegrees(rect.west);
  let e = CMath.toDegrees(rect.east);
  const s = Math.max(-80, CMath.toDegrees(rect.south));
  const no = Math.min(80, CMath.toDegrees(rect.north));
  if (e < w) e += 360;
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      lats.push(+(s + ((i + 0.5) / n) * (no - s)).toFixed(2));
      let lo = w + ((j + 0.5) / n) * (e - w);
      if (lo > 180) lo -= 360;
      lons.push(+lo.toFixed(2));
    }
  return { lats, lons, cellDeg: Math.min(no - s, e - w) / n };
}

export interface SampledOpts<T> {
  n: number;
  ttl: number;
  url: (lats: number[], lons: number[]) => string;
  /** map one location's JSON to a value (undefined = no data, e.g. marine over land) */
  parse: (json: any) => T | undefined;
  detail: (samples: Sample<T>[]) => string;
  /** (re)draw everything; called with the full sample list */
  draw: (ctx: LayerCtx, samples: Sample<T>[], cellDeg: number) => void;
  clear: (ctx: LayerCtx) => void;
  init: (ctx: LayerCtx) => void;
  dossier: (s: Sample<T>) => Omit<Dossier, 'layer' | 'key'>;
}

export function sampledLayer<T>(o: SampledOpts<T>): LayerFactory {
  return (ctx) => {
    let samples: Sample<T>[] = [];
    let moveOff: (() => void) | undefined;
    let timer: number | undefined;
    let poller: Poller | undefined;

    const refresh = async () => {
      const g = viewGrid(ctx.viewer, o.n);
      if (!g) return;
      const url = o.url(g.lats, g.lons);
      try {
        const r = await getData<any>(url, { ttl: o.ttl, timeout: 20000 });
        const arr = Array.isArray(r.data) ? r.data : [r.data];
        samples = [];
        arr.forEach((json: any, k: number) => {
          const v = o.parse(json);
          if (v !== undefined) samples.push({ key: `${g.lats[k]},${g.lons[k]}`, lat: g.lats[k], lon: g.lons[k], v });
        });
        o.draw(ctx, samples, g.cellDeg);
        ctx.status(r.stale ? 'cached' : 'live', o.detail(samples), samples.length);
        ctx.requestRender();
      } catch (e) {
        const d = describeError(e);
        ctx.status(d.status, d.detail, samples.length);
        throw e;
      }
    };

    return {
      enable() {
        o.init(ctx);
        poller = new Poller(refresh, Math.max(o.ttl, 10 * 60_000));
        poller.start();
        moveOff = ctx.viewer.camera.moveEnd.addEventListener(() => {
          clearTimeout(timer);
          timer = window.setTimeout(() => void refresh().catch(() => {}), 1200);
        });
      },
      disable() {
        moveOff?.();
        clearTimeout(timer);
        poller?.stop();
        o.clear(ctx);
        samples = [];
      },
      pick(key) {
        const s = samples.find((x) => x.key === key);
        return s ? { layer: ctx.id, key, ...o.dossier(s) } : undefined;
      },
    };
  };
}
