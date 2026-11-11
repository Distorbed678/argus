// Day/night terminator line + city lights on the night side (Black Marble, nightAlpha).
import { Cartesian3, Color, ImageryLayer, Material, PolylineCollection, UrlTemplateImageryProvider, Credit, type Polyline } from 'cesium';
import { terminatorRing } from '../../core/astro';
import { simNow } from '../../core/clock';
import { raiseLabels } from '../../core/viewer';
import type { LayerFactory } from '../Layer';

const factory: LayerFactory = (ctx) => {
  let lights: ImageryLayer | undefined;
  let lines: PolylineCollection | undefined;
  let line: Polyline | undefined;
  let last = 0;
  let off: (() => void) | undefined;

  const draw = () => {
    const t = simNow();
    if (Math.abs(t - last) < 60_000) return;
    last = t;
    const pts = terminatorRing(t).map((p) => Cartesian3.fromDegrees(p.lon, p.lat, 5000));
    line!.positions = pts;
    ctx.requestRender();
  };

  return {
    enable() {
      const v = ctx.viewer;
      v.scene.globe.enableLighting = true;
      lights = new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
          maximumLevel: 8,
          credit: new Credit('NASA Black Marble'),
        }),
        { dayAlpha: 0, nightAlpha: 0.95 },
      );
      v.imageryLayers.add(lights, 1);
      lines = v.scene.primitives.add(new PolylineCollection());
      line = lines!.add({
        width: 3,
        material: Material.fromType('PolylineGlow', { color: Color.fromCssColorString('#ffb347').withAlpha(0.7), glowPower: 0.2 }),
      });
      last = 0;
      draw();
      off = v.scene.preUpdate.addEventListener(draw);
      raiseLabels();
      ctx.status('live', 'computed locally');
    },
    disable() {
      off?.();
      if (lights) ctx.viewer.imageryLayers.remove(lights, true);
      if (lines) ctx.viewer.scene.primitives.remove(lines);
      lights = undefined;
      lines = undefined;
    },
  };
};
export default factory;
