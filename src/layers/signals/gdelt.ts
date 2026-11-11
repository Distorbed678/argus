// GDELT GKG GeoJSON: geolocated news coverage by theme over the last 24h (best effort, via proxy).
import { getData } from '../../data/fetcher';
import { settings } from '../../core/store';
import { fmtLL, utc, esc } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface G {
  theme: string;
  geometry: { coordinates: [number, number] };
  properties: { name: string; url: string; urltone: number; urlpubtimedate: string };
}

const COL: Record<string, string> = { ARMEDCONFLICT: '#ff3b5c', PROTEST: '#ffd166', TERROR: '#ff2d55', CYBER_ATTACK: '#b388ff' };

export default pointLayer<G>({
  interval: 15 * 60_000,
  detail: 'GDELT GKG themes, 24h',
  load: async () => {
    const themes = settings.gdeltQuery.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
    const all: G[] = [];
    let fromCache = true;
    let ok = 0;
    for (const th of themes) {
      try {
        const r = await getData<any>(`https://api.gdeltproject.org/api/v1/gkg_geojson?QUERY=${encodeURIComponent(th)}&TIMESPAN=1440&MAXROWS=250`, {
          via: 'proxy',
          ttl: 14 * 60_000,
          persist: true,
          timeout: 45000,
        });
        fromCache &&= r.fromCache;
        ok++;
        for (const f of r.data.features ?? []) all.push({ ...f, theme: th });
      } catch (e) {
        if (!ok && th === themes[themes.length - 1]) throw e;
      }
    }
    return { data: all, fromCache };
  },
  toItem: (g) => {
    // many articles share a location; jitter slightly so they're individually pickable
    const h = [...g.properties.url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
    return {
      key: `${g.theme}|${g.properties.url}`,
      lon: g.geometry.coordinates[0] + ((h % 100) / 100) * 0.3,
      lat: g.geometry.coordinates[1] + (((h >> 8) % 100) / 100) * 0.3,
      color: COL[g.theme] ?? '#4fc3ff',
      icon: 'pin',
      size: 13,
    };
  },
  match: (g, q) => g.properties.name.toLowerCase().includes(q.toLowerCase()),
  dossier: (g) => {
    const p = g.properties;
    let host = '';
    try {
      host = new URL(p.url).hostname;
    } catch {
      /* ignore */
    }
    return {
      kind: 'SIGINT · NEWS',
      title: `${g.theme.replace('_', ' ')} — ${p.name}`,
      subtitle: esc(host),
      fields: [
        ['PUBLISHED', utc(Date.parse(p.urlpubtimedate))],
        ['LOCATION', `${p.name} ${fmtLL(g.geometry.coordinates[1], g.geometry.coordinates[0])}`],
        ['TONE', p.urltone?.toFixed(2) ?? '—'],
      ],
      actions: [{ label: 'ARTICLE ↗', run: () => window.open(p.url, '_blank', 'noopener') }],
      range: 1e6,
    };
  },
});
