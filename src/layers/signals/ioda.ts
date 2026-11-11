// IODA country-level internet outage events (last 24h), placed at country centroids (bundled).
import { getData } from '../../data/fetcher';
import { utc, dur } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface Ev {
  location: string;
  location_name: string;
  start: number;
  duration: number;
  method: string;
  datasource: string;
  score: number;
  lon: number;
  lat: number;
}

let centroids: Record<string, [number, number]> | null = null;

export default pointLayer<Ev>({
  interval: 10 * 60_000,
  detail: 'IODA country outages, 24h',
  load: async () => {
    if (!centroids) centroids = (await getData<Record<string, [number, number]>>('./data/country-centroids.json', { ttl: 86400_000 })).data;
    const until = Math.floor(Date.now() / 1000);
    const r = await getData<any>(
      `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${until - 86400}&until=${until}&entityType=country&limit=200`,
      { via: 'auto', ttl: 9 * 60_000 },
    );
    const best = new Map<string, Ev>();
    for (const e of r.data.data ?? []) {
      const cc = String(e.location).split('/')[1];
      const c = centroids![cc];
      if (!c) continue;
      const prev = best.get(cc);
      if (!prev || e.score > prev.score) best.set(cc, { ...e, lon: c[0], lat: c[1] });
    }
    return { data: [...best.values()], fromCache: r.fromCache };
  },
  toItem: (e) => ({
    key: e.location,
    lon: e.lon,
    lat: e.lat,
    color: e.score > 1e5 ? '#ff2d55' : e.score > 1e3 ? '#ff9f1c' : '#ffd166',
    icon: 'radio',
    size: 22,
  }),
  onNew: (e, ctx) => ctx.log(`internet disruption detected: ${e.location_name} (${e.datasource})`, 'warn', { lon: e.lon, lat: e.lat }),
  match: (e, q) => e.location_name.toLowerCase().includes(q.toLowerCase()),
  dossier: (e) => ({
    kind: 'NETWORK OUTAGE',
    title: e.location_name.toUpperCase(),
    subtitle: `signal: ${e.datasource.toUpperCase()} · detector ${e.method}`,
    fields: [
      ['STARTED', utc(e.start * 1000)],
      ['DURATION', dur(e.duration)],
      ['SCORE', Math.round(e.score).toLocaleString()],
    ],
    actions: [{ label: 'IODA ↗', run: () => window.open(`https://ioda.inetintel.cc.gatech.edu/country/${e.location.split('/')[1]}`, '_blank', 'noopener') }],
    range: 3e6,
  }),
});
