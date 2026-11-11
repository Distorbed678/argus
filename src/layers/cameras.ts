// Public traffic cameras (bundled Caltrans + NYC DOT list) + Windy webcams for the view (with key).
import { NearFarScalar } from 'cesium';
import { getData } from '../data/fetcher';
import { settings } from '../core/store';
import { viewCenter } from '../core/viewer';
import { fmtLL, esc } from '../core/fmt';
import { openFeed } from '../ui/feedViewer';
import { pointLayer } from './pointLayer';

export interface Cam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  img: string;
  stream?: string;
  src: string;
  refresh?: number; // seconds
  player?: string;
}

let bundled: Cam[] | null = null;

async function windy(): Promise<Cam[]> {
  const key = settings.keys.windy;
  if (!key) return [];
  const c = viewCenter();
  if (c.dist > 3e6) return [];
  const radius = Math.round(Math.min(250, Math.max(10, c.dist / 1000 / 2)));
  try {
    const r = await getData<any>(
      `https://api.windy.com/webcams/api/v3/webcams?nearby=${c.lat.toFixed(2)},${c.lon.toFixed(2)},${radius}&limit=50&include=images,location,player`,
      { via: 'auto', ttl: 10 * 60_000, headers: { 'x-windy-api-key': key } },
    );
    return (r.data.webcams ?? []).map((w: any) => ({
      id: `windy-${w.webcamId}`,
      name: w.title,
      lat: w.location.latitude,
      lon: w.location.longitude,
      img: w.images?.current?.preview ?? w.images?.current?.thumbnail,
      player: w.player?.day ?? w.player?.live,
      src: 'Windy Webcams',
      refresh: 600,
    }));
  } catch {
    return [];
  }
}

export default pointLayer<Cam>({
  interval: 5 * 60_000,
  detail: 'Caltrans CCTV + NYC DOT (bundled list)',
  scale: new NearFarScalar(2e3, 1.3, 8e6, 0.45),
  load: async () => {
    if (!bundled) bundled = (await getData<Cam[]>('./data/cameras.json', { ttl: 86400_000 })).data;
    const w = await windy();
    return { data: [...bundled, ...w], fromCache: false };
  },
  toItem: (c) => ({ key: c.id, lon: c.lon, lat: c.lat, color: c.src.startsWith('Windy') ? '#7cffb2' : '#4fc3ff', icon: 'cam', size: 15 }),
  match: (c, q) => c.name.toLowerCase().includes(q.toLowerCase()),
  dossier: (c) => {
    const extra = document.createElement('div');
    extra.className = 'cam-thumb';
    extra.innerHTML = `<img src="${esc(c.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div class="scan"></div><span class="rec">● LIVE</span>`;
    extra.onclick = () => openFeed(c);
    return {
      kind: 'OPTICAL FEED',
      title: c.name,
      subtitle: c.src,
      classification: 'INTERCEPTED // PUBLIC CCTV',
      fields: [
        ['POSITION', fmtLL(c.lat, c.lon)],
        ['FEED', c.stream ? 'HLS video + still' : c.player ? 'embedded player' : 'still frames'],
        ['REFRESH', c.refresh ? `${c.refresh}s` : '—'],
      ],
      extra,
      actions: [{ label: 'OPEN FEED', run: () => openFeed(c) }],
      range: 3000,
    };
  },
});
