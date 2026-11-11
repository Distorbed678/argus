import { BillboardCollection, Cartesian3, LabelCollection, Cartesian2, Color, LabelStyle, type Billboard, type Label } from 'cesium';
import { subsolar, sublunar } from '../../core/astro';
import { simNow } from '../../core/clock';
import { icon, fmtLL } from '../../core/fmt';
import { pid, type LayerFactory } from '../Layer';

const factory: LayerFactory = (ctx) => {
  let bb: BillboardCollection | undefined;
  let lb: LabelCollection | undefined;
  let sun: Billboard, moon: Billboard, sunL: Label, moonL: Label;
  let off: (() => void) | undefined;
  let last = 0;
  const update = () => {
    const t = simNow();
    if (Math.abs(t - last) < 30_000) return;
    last = t;
    const s = subsolar(t);
    const m = sublunar(t);
    sun.position = sunL.position = Cartesian3.fromDegrees(s.lon, s.lat, 1000);
    moon.position = moonL.position = Cartesian3.fromDegrees(m.lon, m.lat, 1000);
    ctx.requestRender();
  };
  return {
    enable() {
      bb = ctx.viewer.scene.primitives.add(new BillboardCollection());
      lb = ctx.viewer.scene.primitives.add(new LabelCollection());
      sun = bb!.add({ position: Cartesian3.ZERO, image: icon('cross', '#ffc23d', 28), id: pid('sun-moon', 'sun') });
      moon = bb!.add({ position: Cartesian3.ZERO, image: icon('ring', '#cfe3ff', 22), id: pid('sun-moon', 'moon') });
      const lbl = { position: Cartesian3.ZERO, font: '11px "Share Tech Mono", monospace', style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, pixelOffset: new Cartesian2(14, 0) };
      sunL = lb!.add({ ...lbl, text: 'SUBSOLAR', fillColor: Color.fromCssColorString('#ffc23d') });
      moonL = lb!.add({ ...lbl, text: 'SUBLUNAR', fillColor: Color.fromCssColorString('#cfe3ff') });
      last = 0;
      update();
      off = ctx.viewer.scene.preUpdate.addEventListener(update);
      ctx.status('live', 'computed locally', 2);
    },
    disable() {
      off?.();
      if (bb) ctx.viewer.scene.primitives.remove(bb);
      if (lb) ctx.viewer.scene.primitives.remove(lb);
    },
    pick(key) {
      const isSun = key === 'sun';
      const get = () => (isSun ? subsolar(simNow()) : sublunar(simNow()));
      return {
        layer: 'sun-moon',
        key,
        kind: 'EPHEMERIS',
        title: isSun ? 'SUBSOLAR POINT' : 'SUBLUNAR POINT',
        subtitle: isSun ? 'Sun at zenith' : 'Moon at zenith',
        fields: [],
        live: () => {
          const p = get() as any;
          const f: [string, string][] = [['POSITION', fmtLL(p.lat, p.lon)]];
          if (p.distKm) f.push(['EARTH–MOON', `${Math.round(p.distKm).toLocaleString()} km`]);
          return f;
        },
        position: () => {
          const p = get();
          return Cartesian3.fromDegrees(p.lon, p.lat, 0);
        },
        range: 8e6,
      };
    },
  };
};
export default factory;
