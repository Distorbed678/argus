import { getData } from '../../data/fetcher';
import { fmtLL } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface F {
  geometry: { coordinates: [number, number] };
  properties: {
    eventtype: string;
    eventid: number;
    name: string;
    description: string;
    alertlevel: string;
    country: string;
    fromdate: string;
    todate: string;
    severitydata?: { severitytext?: string };
    url?: { report?: string };
    iscurrent?: string;
  };
}

const TYPES: Record<string, string> = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire', TS: 'Tsunami' };
const ALERT: Record<string, string> = { Red: '#ff2d55', Orange: '#ff9f1c', Green: '#5dd39e' };

export default pointLayer<F>({
  interval: 20 * 60_000,
  detail: 'GDACS events, 20-min refresh',
  load: async () => {
    const r = await getData<{ features: F[] }>('https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP', { ttl: 19 * 60_000, persist: true });
    return { ...r, data: r.data.features.filter((f) => Array.isArray(f.geometry?.coordinates) && typeof f.geometry.coordinates[0] === 'number') };
  },
  label: (f) => `${f.properties.alertlevel.toUpperCase()} ${f.properties.name}`,
  toItem: (f) => ({
    key: `${f.properties.eventtype}${f.properties.eventid}`,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    color: ALERT[f.properties.alertlevel] ?? '#4fc3ff',
    icon: 'tri',
    size: f.properties.alertlevel === 'Red' ? 26 : f.properties.alertlevel === 'Orange' ? 20 : 15,
  }),
  onNew: (f, ctx) => {
    if (f.properties.alertlevel !== 'Green')
      ctx.log(`${f.properties.alertlevel.toUpperCase()} ALERT ${f.properties.name}`, 'alert', { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
  },
  match: (f, q) => f.properties.name.toLowerCase().includes(q.toLowerCase()),
  dossier: (f) => {
    const p = f.properties;
    return {
      kind: 'DISASTER ALERT',
      title: p.name,
      subtitle: `${TYPES[p.eventtype] ?? p.eventtype} · ${p.alertlevel.toUpperCase()} alert`,
      classification: p.alertlevel === 'Red' ? 'PRIORITY // FLASH' : undefined,
      fields: [
        ['COUNTRY', p.country || '—'],
        ['FROM', p.fromdate?.replace('T', ' ').slice(0, 16)],
        ['TO', p.todate?.replace('T', ' ').slice(0, 16)],
        ['SEVERITY', p.severitydata?.severitytext ?? '—'],
        ['POSITION', fmtLL(f.geometry.coordinates[1], f.geometry.coordinates[0])],
      ],
      actions: p.url?.report ? [{ label: 'REPORT ↗', run: () => window.open(p.url!.report, '_blank', 'noopener') }] : [],
      range: 1.5e6,
    };
  },
});
