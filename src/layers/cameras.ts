// Public traffic cameras (bundled snapshot: Caltrans, NYC DOT and 13 keyless '511' road agencies)
// + Windy webcams for the view (with key).
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

/**
 * cameras.json v2 (written by scripts/fetch-static-data.mjs): { v: 2, s: [{ n: source, h: url prefix }],
 * c: [[id, name, lat, lon, sourceIdx, urlSuffix, refreshS, stream?]] }. Plain Cam[] is still accepted.
 */
export function expandCameras(raw: any): Cam[] {
  if (Array.isArray(raw)) return raw;
  if (raw?.v !== 2) return [];
  const src: { n: string; h: string }[] = raw.s;
  return (raw.c as any[]).map((r) => ({ id: r[0], name: r[1], lat: r[2], lon: r[3], src: src[r[4]].n, img: src[r[4]].h + r[5], refresh: r[6] || undefined, stream: r[7] || undefined }));
}

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
  detail: 'Caltrans · NYC DOT · 13 state/provincial 511 agencies (bundled list)',
  scale: new NearFarScalar(2e3, 1.3, 8e6, 0.45),
  load: async () => {
    if (!bundled) bundled = expandCameras((await getData<any>('./data/cameras.json', { ttl: 86400_000 })).data);
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
