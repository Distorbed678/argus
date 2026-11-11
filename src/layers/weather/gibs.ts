// NASA GIBS WMTS imagery overlays (keyless, CORS-enabled).
import { ImageryLayer, UrlTemplateImageryProvider, Credit, Rectangle } from 'cesium';
import { raiseLabels } from '../../core/viewer';
import type { LayerFactory } from '../Layer';

const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

function geoTime(lagMin = 30) {
  const t = new Date(Date.now() - lagMin * 60_000);
  t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 10) * 10, 0, 0);
  return t.toISOString().replace('.000', '');
}

const GEO_SATS = [
  { layer: 'GOES-East_ABI_Band13_Clean_Infrared', lon: -75.2 },
  { layer: 'GOES-West_ABI_Band13_Clean_Infrared', lon: -137.2 },
  { layer: 'Himawari_AHI_Band13_Clean_Infrared', lon: 140.7 },
];

export function gibsLayer(
  layer: string,
  tms: string,
  ext: string,
  opts: { alpha?: number; timeMode?: 'geo' | 'day' | 'default'; night?: boolean } = {},
): LayerFactory {
  return (ctx) => {
    const added: ImageryLayer[] = [];
    let timer: number | undefined;
    const maxLevel = Number(tms.match(/Level(\d+)/)?.[1] ?? 6);

    const make = (lyr: string, time: string, rect?: Rectangle) => {
      const p = new UrlTemplateImageryProvider({
        url: `${BASE}/${lyr}/default/${time}/${tms}/{z}/{y}/{x}.${ext}`,
        maximumLevel: maxLevel,
        rectangle: rect,
        credit: new Credit('NASA GIBS'),
      });
      p.errorEvent.addEventListener((err: any) => {
        err.retry = false;
      });
      const il = new ImageryLayer(p, { alpha: opts.alpha ?? 0.8 });
      ctx.viewer.imageryLayers.add(il);
      added.push(il);
    };

    const build = () => {
      for (const l of added.splice(0)) ctx.viewer.imageryLayers.remove(l, true);
      if (opts.timeMode === 'geo') {
        const t = geoTime();
        for (const g of GEO_SATS) make(g.layer, t, Rectangle.fromDegrees(Math.max(-180, g.lon - 81), -81, Math.min(180, g.lon + 81), 81));
        // Himawari disk wraps the antimeridian
        make(GEO_SATS[2].layer, t, Rectangle.fromDegrees(-180, -81, -138, 81));
        ctx.status('live', `GOES-E/W + Himawari Band 13 · ${t.slice(11, 16)}Z`);
      } else {
        const time = opts.timeMode === 'day' ? new Date(Date.now() - 86400_000).toISOString().slice(0, 10) : 'default';
        make(layer, time);
        ctx.status('live', `GIBS ${time}`);
      }
      raiseLabels();
      ctx.requestRender();
    };

    return {
      enable() {
        build();
        if (opts.timeMode === 'geo') timer = window.setInterval(build, 10 * 60_000);
      },
      disable() {
        clearInterval(timer);
        for (const l of added.splice(0)) ctx.viewer.imageryLayers.remove(l, true);
      },
    };
  };
}
