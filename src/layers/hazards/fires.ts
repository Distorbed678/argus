// NASA FIRMS MODIS global 24h hotspots (keyless CSV, needs the CORS proxy).
import { NearFarScalar } from 'cesium';
import { getData } from '../../data/fetcher';
import { fmtLL } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface Fire {
  lat: number;
  lon: number;
  bright: number;
  frp: number;
  conf: number;
  date: string;
  time: string;
  sat: string;
  dn: string;
}

function parse(csv: string): Fire[] {
  const lines = csv.trim().split('\n');
  const h = lines.shift()!.split(',');
  const ix = (k: string) => h.indexOf(k);
  const [la, lo, br, fr, co, da, ti, sa, dn] = ['latitude', 'longitude', 'brightness', 'frp', 'confidence', 'acq_date', 'acq_time', 'satellite', 'daynight'].map(ix);
  const out: Fire[] = [];
  for (const l of lines) {
    const c = l.split(',');
    out.push({ lat: +c[la], lon: +c[lo], bright: +c[br], frp: +c[fr], conf: +c[co], date: c[da], time: c[ti], sat: c[sa], dn: c[dn] });
  }
  return out;
}

export default pointLayer<Fire>({
  interval: 30 * 60_000,
  points: true,
  detail: 'MODIS C6.1 global 24h',
  scale: new NearFarScalar(1e5, 2, 2e7, 0.7),
  load: async () => {
    const r = await getData<string>('https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv', {
      via: 'proxy',
      as: 'text',
      ttl: 29 * 60_000,
      persist: true,
      timeout: 60000,
    });
    return { ...r, data: parse(r.data) };
  },
  toItem: (f) => ({
    key: `${f.lat.toFixed(3)},${f.lon.toFixed(3)},${f.time}`,
    lon: f.lon,
    lat: f.lat,
    color: f.frp > 100 ? '#ff2d55' : f.frp > 20 ? '#ff7a3d' : '#ffc23d',
    size: f.frp > 100 ? 5 : 3,
  }),
  dossier: (f) => ({
    kind: 'THERMAL ANOMALY',
    title: `HOTSPOT ${f.frp.toFixed(1)} MW`,
    subtitle: `MODIS ${f.sat === 'T' ? 'Terra' : 'Aqua'} · ${f.dn === 'D' ? 'day' : 'night'} pass`,
    fields: [
      ['DETECTED', `${f.date} ${f.time.slice(0, 2)}:${f.time.slice(2)}Z`],
      ['POSITION', fmtLL(f.lat, f.lon)],
      ['BRIGHTNESS', `${f.bright.toFixed(1)} K`],
      ['RADIATIVE POWER', `${f.frp.toFixed(1)} MW`],
      ['CONFIDENCE', `${f.conf}%`],
    ],
    range: 1e5,
  }),
});
