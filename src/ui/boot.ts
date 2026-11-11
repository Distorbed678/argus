// Boot sequence: blue glyph rain + real uplink log (driven by actual bus log events).
import { bus } from '../core/bus';
import { settings, saveSettings } from '../core/store';
import { esc } from '../core/fmt';

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF<>/\\|=+*';

export function rain(canvas: HTMLCanvasElement, dense = 1) {
  const g = canvas.getContext('2d')!;
  let w = 0;
  let h = 0;
  let cols: number[] = [];
  const size = 15;
  const resize = () => {
    w = canvas.width = Math.floor(innerWidth / 1.5);
    h = canvas.height = Math.floor(innerHeight / 1.5);
    cols = Array.from({ length: Math.ceil(w / size) }, () => Math.random() * -h);
  };
  resize();
  addEventListener('resize', resize);
  let raf = 0;
  let last = 0;
  const draw = (t: number) => {
    raf = requestAnimationFrame(draw);
    if (t - last < 45) return;
    last = t;
    g.fillStyle = 'rgba(1, 5, 12, 0.16)';
    g.fillRect(0, 0, w, h);
    g.font = `${size}px "Share Tech Mono", monospace`;
    for (let i = 0; i < cols.length; i++) {
      if (Math.random() > dense) continue;
      const y = cols[i];
      const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      g.fillStyle = Math.random() > 0.96 ? '#e0f4ff' : i % 7 === 0 ? '#2f80ff' : '#4fc3ff';
      g.fillText(ch, i * size, y);
      cols[i] = y > h + Math.random() * 400 ? 0 : y + size;
    }
  };
  raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
  };
}

const FLAVOR = [
  'ESTABLISHING UPLINK :: KU-BAND 14.25 GHz',
  'HANDSHAKE AES-256-GCM // KEY ROTATION OK',
  'LOADING WGS-84 ELLIPSOID',
  'SPINNING UP SGP4 PROPAGATOR (WORKER THREAD)',
  'MOUNTING OPEN-SOURCE FEEDS',
];

export function runBoot(ready: Promise<unknown>): Promise<void> {
  const root = document.getElementById('boot')!;
  if (settings.reduceFx && settings.bootSeen) {
    root.remove();
    return Promise.resolve();
  }
  root.innerHTML = `<canvas></canvas>
    <div class="boot-core">
      <div class="boot-title">ARGUS</div>
      <div class="boot-sub">ORBITAL SURVEILLANCE CONSOLE // REAL-TIME OSINT</div>
      <div class="bar"><i></i></div>
      <div class="boot-log"></div>
      <div class="skip">TAP TO SKIP</div>
    </div>`;
  const stop = settings.reduceFx ? () => {} : rain(root.querySelector('canvas')!, 0.9);
  const logEl = root.querySelector('.boot-log')!;
  const bar = root.querySelector<HTMLElement>('.bar i')!;
  const add = (msg: string, cls = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = `&gt; ${esc(msg)}`;
    logEl.appendChild(d);
    while (logEl.children.length > 10) logEl.firstElementChild!.remove();
  };
  let progress = 0;
  const bump = (n: number) => {
    progress = Math.min(100, progress + n);
    bar.style.width = `${progress}%`;
  };
  FLAVOR.forEach((m, i) => setTimeout(() => (add(m), bump(12)), 120 + i * 220));
  const off = bus.on('log', (e) => {
    add(`[${e.src}] ${e.msg}`, e.level);
    bump(8);
  });
  const offStatus = bus.on('status', (s) => {
    if (s.status === 'live' || s.status === 'cached') add(`FEED ${s.id.toUpperCase()} :: ${s.status.toUpperCase()}${s.count ? ` (${s.count.toLocaleString()})` : ''}`, 'ok');
    else if (s.status === 'proxy' || s.status === 'offline' || s.status === 'error') add(`FEED ${s.id.toUpperCase()} :: ${s.status.toUpperCase()}`, 'warn');
  });

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      off();
      offStatus();
      bar.style.width = '100%';
      add('ALL SYSTEMS NOMINAL — HANDING OFF TO OPERATOR', 'ok');
      setTimeout(() => {
        root.classList.add('done');
        saveSettings({ bootSeen: true });
        resolve();
        setTimeout(() => {
          stop();
          root.remove();
        }, 900);
      }, 350);
    };
    root.addEventListener('click', finish);
    const minTime = new Promise((r) => setTimeout(r, settings.bootSeen ? 1600 : 3200));
    Promise.all([minTime, ready.catch(() => {})]).then(finish);
    setTimeout(finish, 9000);
  });
}
