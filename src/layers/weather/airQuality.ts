// Air quality over the view: Open-Meteo air-quality API (CAMS models), sampled on a 9×9 grid.
import { BillboardCollection, Cartesian2, Cartesian3, Color, LabelCollection, LabelStyle, NearFarScalar, VerticalOrigin } from 'cesium';
import { icon, fmtLL } from '../../core/fmt';
import { pid } from '../Layer';
import { sampledLayer } from './sampled';

interface AQ {
  aqi: number;
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  dust?: number;
  time?: string;
}

/** US EPA AQI bands */
export const aqiBand = (v: number) =>
  v <= 50 ? { c: '#7cffb2', t: 'Good' } : v <= 100 ? { c: '#ffd166', t: 'Moderate' } : v <= 150 ? { c: '#ff9f1c', t: 'Unhealthy for sensitive groups' } : v <= 200 ? { c: '#ff3b5c', t: 'Unhealthy' } : v <= 300 ? { c: '#b388ff', t: 'Very unhealthy' } : { c: '#c2185b', t: 'Hazardous' };

let bbs: BillboardCollection | undefined;
let labels: LabelCollection | undefined;
const SCALE = new NearFarScalar(1e5, 1.2, 1.5e7, 0.6);
const LSCALE = new NearFarScalar(1e5, 1, 1.5e7, 0.55);
const OUTLINE = Color.fromCssColorString('#000814');

export default sampledLayer<AQ>({
  n: 9,
  ttl: 30 * 60_000,
  url: (la, lo) =>
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la.join(',')}&longitude=${lo.join(',')}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,dust&timezone=GMT`,
  parse: (j) => {
    const c = j?.current;
    if (!c || c.us_aqi == null) return undefined;
    return { aqi: c.us_aqi, pm25: c.pm2_5, pm10: c.pm10, o3: c.ozone, no2: c.nitrogen_dioxide, dust: c.dust, time: c.time };
  },
  detail: (s) => `Open-Meteo / CAMS · ${s.length} samples · max AQI ${s.reduce((m, x) => Math.max(m, x.v.aqi), 0)}`,
  init: (ctx) => {
    bbs = ctx.viewer.scene.primitives.add(new BillboardCollection());
    labels = ctx.viewer.scene.primitives.add(new LabelCollection());
  },
  clear: (ctx) => {
    if (bbs) ctx.viewer.scene.primitives.remove(bbs);
    if (labels) ctx.viewer.scene.primitives.remove(labels);
    bbs = labels = undefined;
  },
  draw: (ctx, samples) => {
    bbs!.removeAll();
    labels!.removeAll();
    for (const s of samples) {
      const b = aqiBand(s.v.aqi);
      const pos = Cartesian3.fromDegrees(s.lon, s.lat, 500);
      bbs!.add({ position: pos, image: icon('ring', b.c, 32), width: 22, height: 22, scaleByDistance: SCALE, verticalOrigin: VerticalOrigin.CENTER, id: pid(ctx.id, s.key) });
      labels!.add({
        position: pos,
        text: String(Math.round(s.v.aqi)),
        font: '11px "Share Tech Mono", monospace',
        fillColor: Color.fromCssColorString(b.c),
        outlineColor: OUTLINE,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -16),
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: LSCALE,
      });
    }
  },
  dossier: (s) => {
    const b = aqiBand(s.v.aqi);
    const f = (v: number | undefined, u = 'µg/m³') => (v != null ? `${v.toFixed(1)} ${u}` : '—');
    return {
      kind: 'AIR QUALITY SAMPLE',
      title: `US AQI ${Math.round(s.v.aqi)}`,
      subtitle: `${b.t} · model analysis (CAMS), not a ground station`,
      fields: [
        ['POSITION', fmtLL(s.lat, s.lon)],
        ['PM2.5', f(s.v.pm25)],
        ['PM10', f(s.v.pm10)],
        ['OZONE', f(s.v.o3)],
        ['NO₂', f(s.v.no2)],
        ['DUST', f(s.v.dust)],
        ['VALID', s.v.time ? `${s.v.time.replace('T', ' ')}Z` : '—'],
      ],
      position: () => Cartesian3.fromDegrees(s.lon, s.lat),
      range: 8e5,
    };
  },
});
