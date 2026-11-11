// Geotagged live radio streams from radio-browser.info, playable in the dossier.
import { getData } from '../../data/fetcher';
import { fmtLL, esc } from '../../core/fmt';
import { pointLayer } from '../pointLayer';

interface S {
  stationuuid: string;
  name: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  state: string;
  language: string;
  codec: string;
  bitrate: number;
  geo_lat: number;
  geo_long: number;
  votes: number;
}

let audio: HTMLAudioElement | null = null;

export default pointLayer<S>({
  interval: 0,
  detail: 'top 2,500 geotagged HTTPS streams',
  load: async () => {
    const r = await getData<S[]>(
      'https://de1.api.radio-browser.info/json/stations/search?has_geo_info=true&order=clickcount&reverse=true&hidebroken=true&limit=4000',
      { ttl: 12 * 3600_000, persist: true },
    );
    return { ...r, data: r.data.filter((s) => s.url_resolved?.startsWith('https://')).slice(0, 2500) };
  },
  toItem: (s) => ({ key: s.stationuuid, lon: s.geo_long, lat: s.geo_lat, color: '#b388ff', icon: 'radio', size: 14 }),
  match: (s, q) => s.name.toLowerCase().includes(q.toLowerCase()),
  onDisable: () => {
    audio?.pause();
    audio = null;
  },
  dossier: (s) => {
    const extra = document.createElement('div');
    extra.className = 'radio-player';
    extra.innerHTML = `<div class="sub">INTERCEPT AUDIO</div><div class="eq"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '▶ MONITOR';
    btn.onclick = () => {
      if (audio && !audio.paused && audio.dataset.id === s.stationuuid) {
        audio.pause();
        btn.textContent = '▶ MONITOR';
        extra.classList.remove('playing');
        return;
      }
      audio?.pause();
      audio = new Audio(s.url_resolved);
      audio.dataset.id = s.stationuuid;
      audio.play().then(
        () => {
          btn.textContent = '■ STOP';
          extra.classList.add('playing');
        },
        () => (btn.textContent = 'STREAM BLOCKED'),
      );
    };
    extra.appendChild(btn);
    return {
      kind: 'RADIO',
      title: s.name.trim(),
      subtitle: `${esc(s.state ? s.state + ', ' : '')}${esc(s.country)}`,
      fields: [
        ['POSITION', fmtLL(s.geo_lat, s.geo_long)],
        ['CODEC', `${s.codec} ${s.bitrate ? s.bitrate + ' kbps' : ''}`],
        ['LANGUAGE', s.language || '—'],
        ['TAGS', s.tags.split(',').slice(0, 5).join(', ') || '—'],
      ],
      extra,
      onClose: () => {
        audio?.pause();
      },
      actions: s.homepage ? [{ label: 'HOMEPAGE ↗', run: () => window.open(s.homepage, '_blank', 'noopener') }] : [],
      range: 2e5,
    };
  },
});
