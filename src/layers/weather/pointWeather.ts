// "Ground intel" dossier for any clicked spot: Open-Meteo current conditions + Nominatim reverse geocode.
import { Cartesian3 } from 'cesium';
import { getData } from '../../data/fetcher';
import { fmtLL, esc } from '../../core/fmt';
import { setObserver } from '../../core/observer';
import { select, selected } from '../../core/target';
import type { Dossier } from '../Layer';

const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Heavy freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Severe thunderstorm + hail',
};
const compass = (d: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

export function groundDossier(lat: number, lon: number): Dossier {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const d: Dossier = {
    layer: 'ground',
    key,
    kind: 'GROUND INTEL',
    title: fmtLL(lat, lon),
    subtitle: 'resolving location…',
    fields: [],
    live: () => rows,
    position: () => Cartesian3.fromDegrees(lon, lat),
    range: 20000,
    actions: [
      { label: 'SET OBSERVER', run: () => setObserver(lat, lon) },
      { label: 'MAPS ↗', run: () => window.open(`https://www.google.com/maps/@${lat},${lon},16z/data=!3m1!1e3`, '_blank', 'noopener') },
    ],
  };
  let rows: [string, string][] = [['STATUS', 'acquiring…']];

  getData<any>(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&timezone=auto`,
    { ttl: 10 * 60_000 },
  )
    .then(({ data }) => {
      const c = data.current;
      const local = new Date(Date.now() + data.utc_offset_seconds * 1000).toISOString().slice(11, 16);
      rows = [
        ['CONDITIONS', `${WMO[c.weather_code] ?? c.weather_code} · ${c.is_day ? 'DAY' : 'NIGHT'}`],
        ['TEMPERATURE', `${c.temperature_2m}°C (feels ${c.apparent_temperature}°C)`],
        ['WIND', `${c.wind_speed_10m} km/h ${compass(c.wind_direction_10m)} · gust ${c.wind_gusts_10m}`],
        ['CLOUD / HUMIDITY', `${c.cloud_cover}% / ${c.relative_humidity_2m}%`],
        ['PRESSURE', `${c.pressure_msl} hPa`],
        ['VISIBILITY', c.visibility != null ? `${(c.visibility / 1000).toFixed(1)} km` : '—'],
        ['ELEVATION', `${data.elevation} m`],
        ['LOCAL TIME', `${local} (${data.timezone_abbreviation})`],
      ];
    })
    .catch(() => (rows = [['WEATHER', 'unavailable']]));

  getData<any>(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`, { ttl: 3600_000 })
    .then(({ data }) => {
      d.subtitle = data.display_name ?? (data.error ? 'open water / unclaimed' : '—');
      if (selected() !== d) return; // user moved on; don't write into another dossier
      const sub = document.querySelector('#dossier .d-sub');
      if (sub) sub.innerHTML = esc(d.subtitle);
      else {
        const t = document.querySelector('#dossier .d-title');
        t?.insertAdjacentHTML('afterend', `<div class="d-sub">${esc(d.subtitle)}</div>`);
      }
    })
    .catch(() => {});
  return d;
}

export function selectGround(lat: number, lon: number) {
  select(groundDossier(lat, lon));
}
