// NOAA OVATION aurora probability grid rendered to a canvas and draped on the globe.
import { ImageryLayer, Rectangle, SingleTileImageryProvider } from 'cesium';
import { getData, Poller, describeError } from '../../data/fetcher';
import type { LayerFactory } from '../Layer';

const factory: LayerFactory = (ctx) => {
  let layer: ImageryLayer | undefined;
  let poller: Poller | undefined;

  const refresh = async () => {
    try {
      const r = await getData<{ 'Observation Time': string; coordinates: [number, number, number][] }>(
        'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
        { ttl: 9 * 60_000 },
      );
      const c = document.createElement('canvas');
      c.width = 360;
      c.height = 181;
      const g = c.getContext('2d')!;
      const img = g.createImageData(360, 181);
      let max = 0;
      for (const [lon, lat, v] of r.data.coordinates) {
        if (v < 3) continue;
        max = Math.max(max, v);
        const x = (lon + 180) % 360;
        const y = 90 - lat;
        const i = (y * 360 + x) * 4;
        const a = Math.min(1, v / 50);
        img.data[i] = 40 + v * 2;
        img.data[i + 1] = 255;
        img.data[i + 2] = 160 + v;
        img.data[i + 3] = Math.round(a * 230);
      }
      g.putImageData(img, 0, 0);
      // light blur for a glowy oval
      const c2 = document.createElement('canvas');
      c2.width = 720;
      c2.height = 362;
      const g2 = c2.getContext('2d')!;
      g2.filter = 'blur(2px)';
      g2.drawImage(c, 0, 0, 720, 362);
      const provider = await SingleTileImageryProvider.fromUrl(c2.toDataURL(), { rectangle: Rectangle.fromDegrees(-180, -90.5, 180, 90.5) });
      const next = new ImageryLayer(provider, { alpha: 0.85 });
      ctx.viewer.imageryLayers.add(next);
      if (layer) ctx.viewer.imageryLayers.remove(layer, true);
      layer = next;
      ctx.status(r.fromCache ? 'cached' : 'live', `obs ${r.data['Observation Time'].slice(11, 16)}Z · peak ${max}%`);
      if (max >= 60) ctx.log(`aurora probability peaking at ${max}% — oval expanded`, 'warn');
      ctx.requestRender();
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail);
      throw e;
    }
  };

  return {
    enable() {
      poller = new Poller(refresh, 10 * 60_000);
      poller.start();
    },
    disable() {
      poller?.stop();
      if (layer) ctx.viewer.imageryLayers.remove(layer, true);
      layer = undefined;
    },
  };
};
export default factory;
