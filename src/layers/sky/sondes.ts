// Live weather balloons / radiosondes received by the amateur SondeHub network (CORS-enabled).
// The selected sonde's flight path is fetched on demand.
import { Cartesian3, NearFarScalar } from 'cesium';
import { getData } from '../../data/fetcher';
import { ago, fmtLL } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface Sonde {
  serial: string;
  type?: string;
  manufacturer?: string;
  lat: number;
  lon: number;
  alt: number;
  vel_v?: number;
  vel_h?: number;
  temp?: number;
  humidity?: number;
  frequency?: number;
  datetime: string;
  uploader_callsign?: string;
}

const paths = new Map<string, Cartesian3[]>();
const pathAt = new Map<string, number>();

/** Downsampled flight path (≤ 300 points) for one serial, cached 2 min. */
async function loadPath(serial: string) {
  if (Date.now() - (pathAt.get(serial) ?? 0) < 120_000) return;
  pathAt.set(serial, Date.now());
  try {
    const r = await getData<any>(`https://api.v2.sondehub.org/sondes/telemetry?duration=3h&serial=${encodeURIComponent(serial)}`, { ttl: 110_000, timeout: 30000 });
    const pts = Object.values<any>(r.data[serial] ?? {})
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
    const step = Math.max(1, Math.ceil(pts.length / 300));
    paths.set(
      serial,
      pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => Cartesian3.fromDegrees(p.lon, p.lat, p.alt ?? 0)),
    );
  } catch {
    /* keep whatever we had */
  }
}

const color = (s: Sonde) => ((s.vel_v ?? 0) < -2 ? '#ff9f1c' : s.alt > 15000 ? '#9be7ff' : '#7cffb2');

export default pointLayer<Sonde>({
  interval: 60_000,
  detail: 'SondeHub amateur receivers · last hour',
  scale: new NearFarScalar(1e5, 1.2, 2e7, 0.55),
  load: async () => {
    const r = await getData<Record<string, Sonde>>('https://api.v2.sondehub.org/sondes?last=3600', { ttl: 55_000, timeout: 30000 });
    return { ...r, data: Object.values(r.data).filter((s) => s && Number.isFinite(s.lat)) };
  },
  toItem: (s) => ({ key: s.serial, lat: s.lat, lon: s.lon, h: s.alt ?? 0, color: color(s), icon: 'ring', size: 13 }),
  label: (s) => `radiosonde ${s.serial} @ ${Math.round(s.alt)} m`,
  match: (s, q) => s.serial.toLowerCase() === q.trim().toLowerCase(),
  dossier: (s) => {
    void loadPath(s.serial);
    const t = Date.parse(s.datetime);
    return {
      kind: 'RADIOSONDE',
      title: `SONDE ${s.serial}`,
      subtitle: [s.manufacturer, s.type].filter(Boolean).join(' ') || 'weather balloon',
      fields: [
        ['LAST FIX', `${ago(t)}`],
        ['POSITION', fmtLL(s.lat, s.lon)],
        ['ALTITUDE', `${Math.round(s.alt).toLocaleString()} m`],
        ['ASCENT RATE', s.vel_v != null ? `${s.vel_v.toFixed(1)} m/s${s.vel_v < -2 ? ' (DESCENDING — burst)' : ''}` : '—'],
        ['DRIFT', s.vel_h != null ? `${(s.vel_h * 3.6).toFixed(0)} km/h` : '—'],
        ['TEMP / RH', `${s.temp != null ? s.temp.toFixed(1) + '°C' : '—'} / ${s.humidity != null ? s.humidity.toFixed(0) + '%' : '—'}`],
        ['FREQUENCY', s.frequency ? `${s.frequency.toFixed(3)} MHz` : '—'],
        ['RECEIVED BY', s.uploader_callsign ?? '—'],
      ],
      trail: () => {
        void loadPath(s.serial);
        return paths.get(s.serial);
      },
      actions: [{ label: 'SONDEHUB ↗', run: () => window.open(`https://sondehub.org/${encodeURIComponent(s.serial)}`, '_blank', 'noopener') }],
      range: 1.5e5,
    };
  },
});
