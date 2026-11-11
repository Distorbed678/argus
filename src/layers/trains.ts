// Finnish railway GPS positions (Digitraffic, keyless, CORS-enabled).
import { getData } from '../data/fetcher';
import { fmtLL, ago } from '../core/fmt';
import { pointLayer } from './pointLayer';

interface T {
  trainNumber: number;
  departureDate: string;
  location: { coordinates: [number, number] };
  speed: number;
  timestamp: string;
}

export default pointLayer<T>({
  interval: 15_000,
  detail: 'Digitraffic rail GPS, 15s',
  load: async () => {
    const r = await getData<T[]>('https://rata.digitraffic.fi/api/v1/train-locations/latest', { ttl: 12_000 });
    return r;
  },
  toItem: (t) => ({
    key: `${t.departureDate}-${t.trainNumber}`,
    lon: t.location.coordinates[0],
    lat: t.location.coordinates[1],
    color: t.speed > 100 ? '#9be7ff' : t.speed > 0 ? '#4fc3ff' : '#6b7d99',
    icon: 'train',
    size: 16,
  }),
  match: (t, q) => String(t.trainNumber) === q.trim(),
  dossier: (t) => ({
    kind: 'RAIL',
    title: `TRAIN ${t.trainNumber}`,
    subtitle: `VR / Finland · departed ${t.departureDate}`,
    fields: [
      ['POSITION', fmtLL(t.location.coordinates[1], t.location.coordinates[0])],
      ['SPEED', `${t.speed} km/h`],
      ['FIX', ago(Date.parse(t.timestamp))],
    ],
    actions: [{ label: 'TIMETABLE ↗', run: () => window.open(`https://www.junat.net/en/train/${t.trainNumber}`, '_blank', 'noopener') }],
    range: 8000,
  }),
});
