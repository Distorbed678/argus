// AR sky view: rear camera + device orientation; overlays satellites above the horizon.
// Falls back to a polar "sky radar" plot when no orientation sensor is available (desktop).
import { locate, type Observer } from '../core/observer';
import { getViewer } from '../core/viewer';
import { log } from '../core/bus';

interface Sky {
  idx: number;
  az: number;
  el: number;
  range: number;
  alt: number;
}

export async function openAR() {
  const root = document.getElementById('ar')!;
  root.hidden = false;
  root.innerHTML = `<video playsinline muted autoplay></video><canvas></canvas>
    <div class="ar-hud"><button class="btn" id="ar-close">✕ EXIT</button><button class="btn" id="ar-start">ENABLE SENSORS</button><div class="info">AR SKY VIEW<br><span id="ar-info">tap ENABLE SENSORS</span></div></div>`;
  const video = root.querySelector('video')!;
  const canvas = root.querySelector('canvas')!;
  const g = canvas.getContext('2d')!;
  const info = root.querySelector('#ar-info')!;
  let stream: MediaStream | undefined;
  let raf = 0;
  let poll: number | undefined;
  let heading: number | null = null;
  let pitch = 0; // elevation of view center (deg)
  let sky: Sky[] = [];
  let obs: Observer | undefined;
  let names: string[] = [];
  let cats: string[] = [];
  let gotOrientation = false;

  const { satEngine } = await import('../layers/satellites/engine');

  const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
    if (e.webkitCompassHeading != null) heading = e.webkitCompassHeading;
    else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) heading = (360 - e.alpha) % 360;
    else if (e.alpha != null && heading == null) heading = (360 - e.alpha) % 360;
    if (e.beta != null) pitch = e.beta - 90;
    gotOrientation = true;
  };

  const close = () => {
    cancelAnimationFrame(raf);
    clearInterval(poll);
    stream?.getTracks().forEach((t) => t.stop());
    removeEventListener('deviceorientation', onOrient as any);
    removeEventListener('deviceorientationabsolute', onOrient as any);
    root.hidden = true;
    root.innerHTML = '';
  };
  root.querySelector<HTMLElement>('#ar-close')!.onclick = close;

  const start = async () => {
    root.querySelector<HTMLElement>('#ar-start')!.hidden = true;
    try {
      const DOE = (window as any).DeviceOrientationEvent;
      if (DOE?.requestPermission) await DOE.requestPermission();
    } catch {
      /* denied */
    }
    addEventListener('deviceorientationabsolute', onOrient as any);
    addEventListener('deviceorientation', onOrient as any);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
    } catch {
      video.remove();
    }
    obs = await locate();
    if (!satEngine.meta.length) {
      info.textContent = 'loading satellite catalog…';
      await satEngine.init(getViewer());
    }
    names = satEngine.meta.map((m) => m.name);
    cats = satEngine.meta.map((m) => m.cat);
    const refresh = async () => {
      if (!obs) return;
      sky = await satEngine.overhead(obs.lat, obs.lon, obs.h, 0);
    };
    await refresh();
    poll = window.setInterval(refresh, 2000);
    log('AR', `sky view active: ${sky.length} objects above horizon`, 'ok');
    loop();
  };
  root.querySelector<HTMLElement>('#ar-start')!.onclick = start;

  const color = (c: string) => (c === 'stations' ? '#ffffff' : c === 'military' ? '#ff3b5c' : c === 'starlink' ? '#3fa9ff' : c === 'gnss' ? '#7cffb2' : '#9be7ff');

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const dpr = Math.min(2, devicePixelRatio);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '11px "Share Tech Mono", monospace';
    const ar = gotOrientation && heading != null;
    info.innerHTML = `${sky.length} OBJECTS ABOVE HORIZON<br>${ar ? `HDG ${heading!.toFixed(0)}° · EL ${pitch.toFixed(0)}°` : 'NO COMPASS — SKY RADAR MODE'}`;
    if (ar) {
      const hFov = w < h ? 55 : 75;
      const vFov = (hFov * h) / w;
      // horizon + compass ticks
      const yH = h / 2 + (pitch / vFov) * h;
      g.strokeStyle = 'rgba(79,195,255,0.5)';
      g.beginPath();
      g.moveTo(0, yH);
      g.lineTo(w, yH);
      g.stroke();
      g.fillStyle = '#4fc3ff';
      for (let a = 0; a < 360; a += 15) {
        let d = ((a - heading! + 540) % 360) - 180;
        if (Math.abs(d) > hFov / 2 + 5) continue;
        const x = w / 2 + (d / hFov) * w;
        g.fillRect(x, yH - 4, 1, 8);
        if (a % 45 === 0) g.fillText(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][a / 45], x - 5, yH + 18);
      }
      for (const s of sky) {
        const d = ((s.az - heading! + 540) % 360) - 180;
        const x = w / 2 + (d / hFov) * w;
        const y = h / 2 - ((s.el - pitch) / vFov) * h;
        const c = cats[s.idx];
        const important = c === 'stations' || c === 'military';
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) {
          if (important) {
            // edge arrow
            const ang = Math.atan2(y - h / 2, x - w / 2);
            const ex = w / 2 + Math.cos(ang) * (Math.min(w, h) / 2 - 30);
            const ey = h / 2 + Math.sin(ang) * (Math.min(w, h) / 2 - 30);
            g.fillStyle = color(c);
            g.save();
            g.translate(ex, ey);
            g.rotate(ang);
            g.beginPath();
            g.moveTo(10, 0);
            g.lineTo(-6, -6);
            g.lineTo(-6, 6);
            g.fill();
            g.restore();
            g.fillText(names[s.idx].slice(0, 16), ex + 10, ey - 8);
          }
          continue;
        }
        g.fillStyle = g.strokeStyle = color(c);
        g.beginPath();
        g.arc(x, y, important ? 6 : 2.5, 0, Math.PI * 2);
        important ? g.stroke() : g.fill();
        if (important || sky.length < 60) g.fillText(`${names[s.idx].slice(0, 18)} ${s.el.toFixed(0)}°`, x + 8, y - 6);
      }
      // center reticle
      g.strokeStyle = 'rgba(255,179,71,0.8)';
      g.strokeRect(w / 2 - 20, h / 2 - 20, 40, 40);
    } else {
      // polar sky plot: center = zenith, edge = horizon, north up
      const R = Math.min(w, h) / 2 - 50;
      const cx = w / 2;
      const cy = h / 2 + 20;
      g.fillStyle = 'rgba(1,5,12,0.92)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(79,195,255,0.35)';
      for (const e of [0, 30, 60]) {
        g.beginPath();
        g.arc(cx, cy, R * (1 - e / 90), 0, Math.PI * 2);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(cx - R, cy);
      g.lineTo(cx + R, cy);
      g.moveTo(cx, cy - R);
      g.lineTo(cx, cy + R);
      g.stroke();
      g.fillStyle = '#4fc3ff';
      g.fillText('N', cx - 3, cy - R - 6);
      g.fillText('S', cx - 3, cy + R + 14);
      g.fillText('E', cx + R + 6, cy + 4);
      g.fillText('W', cx - R - 14, cy + 4);
      for (const s of sky) {
        const r = R * (1 - s.el / 90);
        const a = ((s.az - 90) * Math.PI) / 180;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        const c = cats[s.idx];
        g.fillStyle = color(c);
        const important = c === 'stations' || c === 'military';
        g.beginPath();
        g.arc(x, y, important ? 4 : 1.6, 0, Math.PI * 2);
        g.fill();
        if (important) g.fillText(names[s.idx].slice(0, 16), x + 6, y - 4);
      }
      // sweep
      const t = (performance.now() / 4000) % 1;
      g.strokeStyle = 'rgba(155,231,255,0.5)';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(t * Math.PI * 2) * R, cy + Math.sin(t * Math.PI * 2) * R);
      g.stroke();
    }
  };
}
