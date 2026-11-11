// RainViewer composite radar, looping through the last ~2h of frames.
import { ImageryLayer, UrlTemplateImageryProvider, Credit } from 'cesium';
import { getData, Poller, describeError } from '../../data/fetcher';
import { raiseLabels } from '../../core/viewer';
import type { LayerFactory } from '../Layer';

interface Maps {
  host: string;
  radar: { past: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] };
}

const factory: LayerFactory = (ctx) => {
  let frames: { time: number; layer: ImageryLayer }[] = [];
  let idx = 0;
  let anim: number | undefined;
  let poller: Poller | undefined;

  const clear = () => {
    for (const f of frames) ctx.viewer.imageryLayers.remove(f.layer, true);
    frames = [];
  };

  const refresh = async () => {
    try {
      const r = await getData<Maps>('https://api.rainviewer.com/public/weather-maps.json', { ttl: 5 * 60_000 });
      clear();
      const past = r.data.radar.past.slice(-6);
      for (const p of past) {
        const prov = new UrlTemplateImageryProvider({
          url: `${r.data.host}${p.path}/256/{z}/{x}/{y}/2/1_1.png`,
          maximumLevel: 7,
          credit: new Credit('RainViewer'),
        });
        const layer = new ImageryLayer(prov, { alpha: 0 });
        ctx.viewer.imageryLayers.add(layer);
        frames.push({ time: p.time, layer });
      }
      idx = frames.length - 1;
      show();
      raiseLabels();
      const last = past[past.length - 1];
      ctx.status('live', `frame ${new Date(last.time * 1000).toISOString().slice(11, 16)}Z · ${past.length}-frame loop`);
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail);
      throw e;
    }
  };

  const show = () => {
    frames.forEach((f, i) => (f.layer.alpha = i === idx ? 0.75 : 0));
    ctx.requestRender();
  };

  return {
    enable() {
      poller = new Poller(refresh, 10 * 60_000);
      poller.start();
      anim = window.setInterval(() => {
        if (!frames.length || document.hidden) return;
        idx = (idx + 1) % frames.length;
        show();
      }, 900);
    },
    disable() {
      clearInterval(anim);
      poller?.stop();
      clear();
    },
  };
};
export default factory;
