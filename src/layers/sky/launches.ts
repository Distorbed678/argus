import { getData } from '../../data/fetcher';
import { ago, fmtLL, utc, dur } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface L {
  id: string;
  name: string;
  net: string;
  status: { abbrev: string; name: string };
  launch_service_provider?: { name: string };
  rocket?: { configuration?: { full_name?: string } };
  mission?: { description?: string; orbit?: { abbrev?: string }; type?: string };
  pad: { name: string; latitude: string; longitude: string; location?: { name: string } };
  webcast_live?: boolean;
  vidURLs?: { url: string }[];
}

const warned = new Set<string>();

export default pointLayer<L>({
  interval: 30 * 60_000,
  detail: 'next 15 launches · cached 1h (API rate limit)',
  load: async (ctx) => {
    const r = await getData<{ results: L[] }>('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=15&hide_recent_previous=true', {
      ttl: 60 * 60_000,
      persist: true,
      cacheKey: 'll2:upcoming',
    });
    for (const l of r.data.results) {
      const t = Date.parse(l.net) - Date.now();
      if (t > 0 && t < 2 * 3600_000 && !warned.has(l.id)) {
        warned.add(l.id);
        ctx.log(`T-${dur(t / 1000)} ${l.name} from ${l.pad.location?.name ?? l.pad.name}`, 'alert', { lon: +l.pad.longitude, lat: +l.pad.latitude });
      }
    }
    return { ...r, data: r.data.results };
  },
  toItem: (l) => ({
    key: l.id,
    lon: Number(l.pad.longitude),
    lat: Number(l.pad.latitude),
    color: l.status.abbrev === 'Go' ? '#7cffb2' : '#ffd166',
    icon: 'tri',
    size: 22,
  }),
  match: (l, q) => l.name.toLowerCase().includes(q.toLowerCase()),
  dossier: (l) => {
    const t = Date.parse(l.net);
    return {
      kind: 'LAUNCH',
      title: l.name,
      subtitle: `${l.launch_service_provider?.name ?? ''} · ${l.status.name}`,
      fields: [
        ['NET', utc(t)],
        ['ROCKET', l.rocket?.configuration?.full_name ?? '—'],
        ['ORBIT', l.mission?.orbit?.abbrev ?? '—'],
        ['MISSION', l.mission?.type ?? '—'],
        ['PAD', `${l.pad.name}`],
        ['SITE', `${l.pad.location?.name ?? ''} ${fmtLL(+l.pad.latitude, +l.pad.longitude)}`],
      ],
      live: () => [['COUNTDOWN', t > Date.now() ? `T-${dur((t - Date.now()) / 1000)}` : `T+${ago(t)}`]],
      actions: l.vidURLs?.[0] ? [{ label: 'WEBCAST ↗', run: () => window.open(l.vidURLs![0].url, '_blank', 'noopener') }] : [],
      range: 5e5,
    };
  },
});
