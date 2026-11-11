// Ocean waves / swell over the view: Open-Meteo marine API sampled on a 10×10 grid (land cells
// return no data and are skipped). Arrows point where the waves travel.
import { Cartesian3, Color, Material, PolylineCollection, Math as CMath } from 'cesium';
import { fmtLL } from '../../core/fmt';
import { pid } from '../Layer';
import { sampledLayer } from './sampled';

interface Wave {
  h: number;
  dir?: number;
  per?: number;
  sh?: number;
  sdir?: number;
  sper?: number;
  time?: string;
}

export const waveColor = (h: number) => (h > 6 ? '#ff2d55' : h > 4 ? '#ff9f1c' : h > 2.5 ? '#ffd166' : h > 1 ? '#4fc3ff' : '#2f80ff');

let lines: PolylineCollection | undefined;

export default sampledLayer<Wave>({
  n: 10,
  ttl: 30 * 60_000,
  url: (la, lo) =>
    `https://marine-api.open-meteo.com/v1/marine?latitude=${la.join(',')}&longitude=${lo.join(',')}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period&timezone=GMT`,
  parse: (j) => {
    const c = j?.current;
    if (!c || c.wave_height == null) return undefined;
    return { h: c.wave_height, dir: c.wave_direction, per: c.wave_period, sh: c.swell_wave_height, sdir: c.swell_wave_direction, sper: c.swell_wave_period, time: c.time };
  },
  detail: (s) => `Open-Meteo marine · ${s.length} sea samples · max ${s.reduce((m, x) => Math.max(m, x.v.h), 0).toFixed(1)} m`,
  init: (ctx) => {
    lines = ctx.viewer.scene.primitives.add(new PolylineCollection());
  },
  clear: (ctx) => {
    if (lines) ctx.viewer.scene.primitives.remove(lines);
    lines = undefined;
  },
  draw: (ctx, samples, cell) => {
    lines!.removeAll(); // destroys the old arrows' materials
    for (const s of samples) {
      if (s.v.dir == null) continue;
      // direction is "coming from"; draw the propagation direction
      const to = CMath.toRadians((s.v.dir + 180) % 360);
      const len = cell * 0.42 * Math.min(1.6, 0.45 + s.v.h / 3);
      const la2 = s.lat + len * Math.cos(to);
      const lo2 = s.lon + (len * Math.sin(to)) / Math.cos(CMath.toRadians(s.lat));
      lines!.add({
        positions: Cartesian3.fromDegreesArray([s.lon, s.lat, lo2, la2]),
        width: 7,
        material: Material.fromType('PolylineArrow', { color: Color.fromCssColorString(waveColor(s.v.h)) }),
        id: pid(ctx.id, s.key),
      });
    }
  },
  dossier: (s) => {
    const d = (v?: number) => (v != null ? `${Math.round(v)}°` : '—');
    return {
      kind: 'SEA STATE SAMPLE',
      title: `WAVES ${s.v.h.toFixed(1)} m`,
      subtitle: 'Open-Meteo marine model (significant wave height)',
      fields: [
        ['POSITION', fmtLL(s.lat, s.lon)],
        ['WAVE HEIGHT', `${s.v.h.toFixed(2)} m from ${d(s.v.dir)}`],
        ['WAVE PERIOD', s.v.per != null ? `${s.v.per.toFixed(1)} s` : '—'],
        ['SWELL', s.v.sh != null ? `${s.v.sh.toFixed(2)} m from ${d(s.v.sdir)} · ${s.v.sper?.toFixed(1) ?? '—'} s` : '—'],
        ['VALID', s.v.time ? `${s.v.time.replace('T', ' ')}Z` : '—'],
      ],
      position: () => Cartesian3.fromDegrees(s.lon, s.lat),
      range: 8e5,
    };
  },
});
