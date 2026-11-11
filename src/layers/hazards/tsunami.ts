// Tsunami bulletins from NOAA's two warning centres (NTWC Palmer AK, PTWC Honolulu) Atom feeds.
// tsunami.gov sends no CORS headers → relay.
import { getData } from '../../data/fetcher';
import { ago, fmtLL, utc } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface Bulletin {
  id: string;
  center: string;
  title: string;
  updated: number;
  lat: number;
  lon: number;
  category: string;
  magnitude?: string;
  link?: string;
}

const FEEDS: [string, string][] = [
  ['NTWC', 'https://www.tsunami.gov/events/xml/PAAQAtom.xml'],
  ['PTWC', 'https://www.tsunami.gov/events/xml/PHEBAtom.xml'],
];

/** Parses one Atom feed (exported for tests). */
export function parseAtom(xml: string, center: string): Bulletin[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: Bulletin[] = [];
  for (const e of Array.from(doc.getElementsByTagName('entry'))) {
    const txt = (tag: string) => e.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
    const lat = Number(txt('geo:lat'));
    const lon = Number(txt('geo:long'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const summary = e.getElementsByTagName('summary')[0]?.textContent ?? '';
    const cat = summary.match(/Category:\s*([A-Za-z ]+?)\s*(?:Bulletin|$|\n)/)?.[1]?.trim() ?? 'Information';
    const mag = summary.match(/Magnitude:\s*([\d.]+\s*\(\w+\))/)?.[1];
    const link = Array.from(e.getElementsByTagName('link')).find((l) => l.getAttribute('rel') === 'alternate')?.getAttribute('href') ?? undefined;
    out.push({ id: txt('id') || `${center}-${txt('updated')}`, center, title: txt('title'), updated: Date.parse(txt('updated')), lat, lon, category: cat, magnitude: mag, link });
  }
  return out;
}

const color = (c: string) => (/warning/i.test(c) ? '#ff2d55' : /advisory|watch|threat/i.test(c) ? '#ff9f1c' : '#4fc3ff');

export default pointLayer<Bulletin>({
  interval: 5 * 60_000,
  detail: 'NOAA NTWC + PTWC bulletins',
  load: async () => {
    const res = await Promise.all(FEEDS.map(([c, u]) => getData<string>(u, { via: 'proxy', as: 'text', ttl: 4 * 60_000, timeout: 20000 }).then((r) => ({ c, r }))));
    const data = res.flatMap(({ c, r }) => parseAtom(r.data, c));
    return { data, stale: res.some((x) => x.r.stale), fromCache: res.every((x) => x.r.fromCache) };
  },
  toItem: (b) => ({ key: b.id, lat: b.lat, lon: b.lon, color: color(b.category), icon: 'tri', size: /warning/i.test(b.category) ? 26 : 18 }),
  label: (b) => `tsunami ${b.category.toLowerCase()}: ${b.title}`,
  onNew: (b, ctx) => ctx.log(`${b.center} tsunami ${b.category.toUpperCase()}: ${b.title}${b.magnitude ? ` (M${b.magnitude})` : ''}`, /warning|advisory|watch/i.test(b.category) ? 'alert' : 'info', b),
  match: (b, q) => b.title.toLowerCase().includes(q.toLowerCase()),
  dossier: (b) => ({
    kind: 'TSUNAMI BULLETIN',
    title: b.title,
    subtitle: `${b.center} · ${b.category}`,
    classification: /warning/i.test(b.category) ? 'FLASH // TSUNAMI WARNING' : undefined,
    fields: [
      ['ISSUED', `${utc(b.updated)} (${ago(b.updated)})`],
      ['CATEGORY', b.category],
      ['MAGNITUDE', b.magnitude ?? '—'],
      ['EPICENTRE', fmtLL(b.lat, b.lon)],
      ['CENTRE', b.center === 'PTWC' ? 'Pacific Tsunami Warning Center' : 'National Tsunami Warning Center'],
    ],
    actions: b.link ? [{ label: 'BULLETIN ↗', run: () => window.open(b.link, '_blank', 'noopener') }] : [],
    range: 2e6,
  }),
});
