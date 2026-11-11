import { getData } from '../../data/fetcher';
import { ago, fmtLL, utc } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface Q {
  id: string;
  properties: { mag: number; place: string; time: number; url: string; tsunami: number; alert: string | null; sig: number; felt: number | null; type: string };
  geometry: { coordinates: [number, number, number] };
}

const color = (m: number) => (m >= 6 ? '#ff2d55' : m >= 5 ? '#ff7a3d' : m >= 4 ? '#ffd166' : '#4fc3ff');

export default pointLayer<Q>({
  interval: 60_000,
  detail: 'USGS M2.5+ past 24h, 1-min refresh',
  load: async () => {
    const r = await getData<{ features: Q[] }>('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', { ttl: 55_000 });
    return { ...r, data: r.data.features };
  },
  toItem: (q) => ({
    key: q.id,
    lon: q.geometry.coordinates[0],
    lat: q.geometry.coordinates[1],
    color: color(q.properties.mag),
    icon: 'ring',
    size: 10 + q.properties.mag * 4,
  }),
  onNew: (q, ctx) => {
    const p = q.properties;
    ctx.log(`M${p.mag.toFixed(1)} ${p.place}${p.tsunami ? ' — TSUNAMI FLAG' : ''}`, p.mag >= 5 ? 'alert' : 'warn', { lon: q.geometry.coordinates[0], lat: q.geometry.coordinates[1] });
  },
  match: (q, s) => q.properties.place.toLowerCase().includes(s.toLowerCase()),
  dossier: (q) => {
    const p = q.properties;
    const [lon, lat, depth] = q.geometry.coordinates;
    return {
      kind: 'SEISMIC EVENT',
      title: `M${p.mag.toFixed(1)} ${p.type.toUpperCase()}`,
      subtitle: p.place,
      fields: [
        ['ORIGIN TIME', utc(p.time)],
        ['AGE', ago(p.time)],
        ['EPICENTER', fmtLL(lat, lon)],
        ['DEPTH', `${depth.toFixed(1)} km`],
        ['SIGNIFICANCE', String(p.sig)],
        ['PAGER ALERT', (p.alert ?? 'none').toUpperCase()],
        ['TSUNAMI', p.tsunami ? 'YES' : 'no'],
        ['FELT REPORTS', String(p.felt ?? 0)],
      ],
      actions: [{ label: 'USGS ↗', run: () => window.open(p.url, '_blank', 'noopener') }],
      range: 4e5,
    };
  },
});
