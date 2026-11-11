import { getData } from '../../data/fetcher';
import { ago, fmtLL, utc } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface Ev {
  id: string;
  title: string;
  categories: { id: string; title: string }[];
  sources: { id: string; url: string }[];
  geometry: { date: string; type: string; coordinates: any; magnitudeValue?: number; magnitudeUnit?: string }[];
}

const COLORS: Record<string, string> = {
  wildfires: '#ff6b35',
  severeStorms: '#b388ff',
  volcanoes: '#ff2d55',
  seaLakeIce: '#9be7ff',
  floods: '#2f80ff',
  earthquakes: '#ffd166',
  drought: '#d4a373',
  dustHaze: '#c2b280',
  landslides: '#a1887f',
  snow: '#ffffff',
  tempExtremes: '#ff9f1c',
  manmade: '#ff4081',
  waterColor: '#26c6da',
};

function lastPoint(e: Ev): [number, number] | null {
  const g = e.geometry[e.geometry.length - 1];
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  if (g.type === 'Polygon') {
    const ring = g.coordinates[0] as [number, number][];
    const s = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return [s[0] / ring.length, s[1] / ring.length];
  }
  return null;
}

export default pointLayer<Ev>({
  interval: 15 * 60_000,
  detail: 'open events, 15-min refresh',
  load: async () => {
    const r = await getData<{ events: Ev[] }>('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30', { ttl: 14 * 60_000, persist: true });
    return { ...r, data: r.data.events };
  },
  label: (e) => `${e.categories[0]?.title ?? 'event'}: ${e.title}`,
  toItem: (e) => {
    const p = lastPoint(e);
    if (!p) return null;
    const cat = e.categories[0]?.id ?? 'other';
    return { key: e.id, lon: p[0], lat: p[1], color: COLORS[cat] ?? '#4fc3ff', icon: cat === 'wildfires' || cat === 'volcanoes' ? 'tri' : 'diamond', size: 16 };
  },
  onNew: (e, ctx) => {
    const p = lastPoint(e);
    ctx.log(`${e.categories[0]?.title}: ${e.title}`, 'warn', p ? { lon: p[0], lat: p[1] } : undefined);
  },
  match: (e, q) => e.title.toLowerCase().includes(q.toLowerCase()),
  dossier: (e) => {
    const g = e.geometry[e.geometry.length - 1];
    const p = lastPoint(e)!;
    const t = Date.parse(g.date);
    return {
      kind: 'NATURAL EVENT',
      title: e.title,
      subtitle: e.categories.map((c) => c.title).join(', '),
      fields: [
        ['LAST FIX', `${utc(t)} (${ago(t)})`],
        ['POSITION', fmtLL(p[1], p[0])],
        ['TRACK POINTS', String(e.geometry.length)],
        ...(g.magnitudeValue ? ([['MAGNITUDE', `${g.magnitudeValue} ${g.magnitudeUnit ?? ''}`]] as [string, string][]) : []),
        ['SOURCES', e.sources.map((s) => s.id).join(', ')],
      ],
      actions: e.sources[0] ? [{ label: 'SOURCE ↗', run: () => window.open(e.sources[0].url, '_blank', 'noopener') }] : [],
      range: 8e5,
    };
  },
});
