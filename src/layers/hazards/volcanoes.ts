// World volcanoes (Smithsonian GVP Holocene list, bundled snapshot refreshed by `npm run data`).
import { NearFarScalar } from 'cesium';
import { getData } from '../../data/fetcher';
import { fmtLL } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

type Row = [number, string, number, number, string, number | null, string, number | null];

const year = (y: number | null) => (y == null ? 'unknown' : y < 0 ? `${-y} BCE` : String(y));
const color = (y: number | null) => (y != null && y >= new Date().getUTCFullYear() - 1 ? '#ff2d55' : y != null && y >= 1900 ? '#ff9f1c' : y != null && y >= 1500 ? '#ffd166' : '#8a6a5a');

export default pointLayer<Row>({
  interval: 0,
  detail: 'Smithsonian GVP · Holocene volcanoes (snapshot)',
  scale: new NearFarScalar(2e5, 1.1, 2e7, 0.5),
  load: async () => {
    const r = await getData<{ v: Row[]; generated: string }>('./data/volcanoes.json', { ttl: 86400_000 });
    return { ...r, data: r.data.v };
  },
  toItem: (v) => ({ key: String(v[0]), lat: v[2], lon: v[3], color: color(v[5]), icon: 'tri', size: v[5] != null && v[5] >= 1900 ? 15 : 11 }),
  label: (v) => `volcano ${v[1]}`,
  match: (v, q) => v[1].toLowerCase() === q.trim().toLowerCase(),
  dossier: (v) => ({
    kind: 'VOLCANO',
    title: v[1],
    subtitle: `${v[4] || 'volcano'} · ${v[6]}`,
    fields: [
      ['GVP NUMBER', String(v[0])],
      ['LAST ERUPTION', year(v[5])],
      ['SUMMIT', v[7] != null ? `${v[7].toLocaleString()} m` : '—'],
      ['POSITION', fmtLL(v[2], v[3])],
    ],
    actions: [{ label: 'GVP ↗', run: () => window.open(`https://volcano.si.edu/volcano.cfm?vn=${v[0]}`, '_blank', 'noopener') }],
    range: 6e4,
  }),
});
