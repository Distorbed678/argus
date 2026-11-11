// Draggable "intercepted feed" windows for public cameras (refreshing stills, HLS video, or embedded player).
import { esc, fmtLL } from '../core/fmt';
import { isMobile } from '../core/store';
import type { Cam } from '../layers/cameras';

const open = new Map<string, HTMLElement>();
let z = 21;

export function openFeed(c: Cam) {
  const existing = open.get(c.id);
  if (existing) {
    existing.style.zIndex = String(++z);
    return;
  }
  if (open.size >= (isMobile ? 1 : 4)) {
    const [k, el] = open.entries().next().value as [string, HTMLElement];
    (el as any)._close?.();
    open.delete(k);
  }
  const root = document.getElementById('feeds')!;
  const el = document.createElement('div');
  el.className = 'feed';
  el.style.left = `${Math.max(8, innerWidth / 2 - 200 + open.size * 24)}px`;
  el.style.top = `${Math.max(56, innerHeight / 2 - 160 + open.size * 24)}px`;
  el.style.zIndex = String(++z);
  el.innerHTML = `
    <div class="panel-head"><span class="hud-title">FEED // ${esc(c.name)}</span><button class="x" aria-label="Close">×</button></div>
    <div class="view"><div class="scan"></div><i class="corner a"></i><i class="corner b"></i>
      <div class="osd"><span class="rec">● REC</span><span class="ts"></span></div>
      <div class="osd" style="bottom:auto;top:8px;left:34px;justify-content:flex-start;gap:12px"><span>${esc(c.src)}</span><span>${fmtLL(c.lat, c.lon)}</span></div>
    </div>`;
  const view = el.querySelector<HTMLElement>('.view')!;
  const ts = el.querySelector<HTMLElement>('.ts')!;
  let timer: number | undefined;
  let hls: any;

  const still = () => {
    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = c.name;
    const load = () => {
      const u = new URL(c.img);
      u.searchParams.set('_t', String(Date.now()));
      img.src = u.toString();
      ts.textContent = new Date().toISOString().slice(11, 19) + 'Z';
    };
    img.onerror = () => view.classList.add('nofeed');
    img.onload = () => view.classList.remove('nofeed');
    view.prepend(img);
    load();
    timer = window.setInterval(load, Math.max(3, Math.min(120, c.refresh ?? 30)) * 1000);
  };

  if (c.player) {
    const f = document.createElement('iframe');
    f.src = c.player;
    f.allow = 'autoplay; fullscreen';
    f.referrerPolicy = 'no-referrer';
    view.prepend(f);
    ts.textContent = 'EMBED';
  } else if (c.stream) {
    const v = document.createElement('video');
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    view.prepend(v);
    ts.textContent = 'HLS';
    let fell = false;
    const fallback = () => {
      if (fell) return;
      fell = true;
      clearTimeout(watchdog);
      v.remove();
      hls?.destroy();
      still();
    };
    // many DOT streams are offline or block cross-origin playback: drop to stills if nothing plays
    const watchdog = window.setTimeout(fallback, 6000);
    v.addEventListener('playing', () => clearTimeout(watchdog), { once: true });
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = c.stream;
      v.onerror = fallback;
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (!Hls.isSupported()) return fallback();
        hls = new Hls({ maxBufferLength: 10 });
        hls.loadSource(c.stream!);
        hls.attachMedia(v);
        hls.on(Hls.Events.ERROR, (_: unknown, d: any) => d.fatal && fallback());
      }, fallback);
    }
  } else still();

  const close = () => {
    clearInterval(timer);
    el.querySelector('video')?.pause();
    hls?.destroy();
    el.remove();
    open.delete(c.id);
  };
  (el as any)._close = close;
  el.querySelector<HTMLElement>('.x')!.onclick = close;
  el.addEventListener('pointerdown', () => (el.style.zIndex = String(++z)));

  // drag by header
  const head = el.querySelector<HTMLElement>('.panel-head')!;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.x')) return;
    const sx = e.clientX - el.offsetLeft;
    const sy = e.clientY - el.offsetTop;
    head.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      el.style.left = `${Math.max(0, Math.min(innerWidth - 60, ev.clientX - sx))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - sy))}px`;
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  root.appendChild(el);
  open.set(c.id, el);
}
