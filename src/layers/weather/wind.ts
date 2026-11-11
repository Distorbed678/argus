// Wind field: samples Open-Meteo on a grid over the current view and draws arrows.
import { PolylineCollection, Cartesian3, Color, Material, Math as CMath } from 'cesium';
import { getData, describeError } from '../../data/fetcher';
import type { LayerFactory } from '../Layer';

const factory: LayerFactory = (ctx) => {
  let lines: PolylineCollection | undefined;
  let moveOff: (() => void) | undefined;
  let timer: number | undefined;

  const colorFor = (kmh: number) => (kmh > 90 ? '#ff2d55' : kmh > 60 ? '#ff9f1c' : kmh > 35 ? '#ffd166' : kmh > 15 ? '#4fc3ff' : '#2f80ff');

  const refresh = async () => {
    const rect = ctx.viewer.camera.computeViewRectangle();
    if (!rect || !lines) return;
    let w = CMath.toDegrees(rect.west);
    let e = CMath.toDegrees(rect.east);
    const s = Math.max(-80, CMath.toDegrees(rect.south));
    const n = Math.min(80, CMath.toDegrees(rect.north));
    if (e < w) e += 360;
    const N = 9;
    const lats: number[] = [];
    const lons: number[] = [];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        lats.push(+(s + ((i + 0.5) / N) * (n - s)).toFixed(2));
        let lo = w + ((j + 0.5) / N) * (e - w);
        if (lo > 180) lo -= 360;
        lons.push(+lo.toFixed(2));
      }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
      const r = await getData<any[]>(url, { ttl: 15 * 60_000 });
      const arr = Array.isArray(r.data) ? r.data : [r.data];
      lines.removeAll();
      const cell = Math.min(n - s, e - w) / N;
      arr.forEach((pt, k) => {
        const sp = pt.current?.wind_speed_10m;
        const dir = pt.current?.wind_direction_10m;
        if (sp == null || dir == null) return;
        // direction is "from"; arrow points where the wind goes
        const to = CMath.toRadians((dir + 180) % 360);
        const len = cell * 0.45 * Math.min(1.6, 0.4 + sp / 40);
        const la = lats[k];
        const lo = lons[k];
        const la2 = la + len * Math.cos(to);
        const lo2 = lo + (len * Math.sin(to)) / Math.cos(CMath.toRadians(la));
        const col = Color.fromCssColorString(colorFor(sp));
        lines!.add({
          positions: Cartesian3.fromDegreesArray([lo, la, lo2, la2]),
          width: 6,
          material: Material.fromType('PolylineArrow', { color: col }),
        });
      });
      ctx.status('live', `${arr.length} samples · Open-Meteo 10 m wind`, arr.length);
      ctx.requestRender();
    } catch (err) {
      const d = describeError(err);
      ctx.status(d.status, d.detail);
    }
  };

  return {
    enable() {
      lines = ctx.viewer.scene.primitives.add(new PolylineCollection());
      refresh();
      moveOff = ctx.viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(timer);
        timer = window.setTimeout(refresh, 1200);
      });
    },
    disable() {
      moveOff?.();
      clearTimeout(timer);
      if (lines) ctx.viewer.scene.primitives.remove(lines);
      lines = undefined;
    },
  };
};
export default factory;
