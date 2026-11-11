// Time scrubber: ±24h offset slider + playback rates. Drives the Cesium clock (orbits, sun, terminator).
import { goLive, setRate, setSimTime, simNow, isLive, getRate } from '../core/clock';
import { log } from '../core/bus';

const RATES = [-600, -60, 0, 1, 10, 60, 600, 3600];

export function initTimeline() {
  const slider = document.getElementById('tl-slider') as HTMLInputElement;
  const time = document.getElementById('tl-time')!;
  const live = document.getElementById('tl-live')!;
  const ratesEl = document.getElementById('tl-rates')!;
  let dragging = false;

  for (const r of RATES) {
    const b = document.createElement('button');
    b.dataset.r = String(r);
    b.textContent = r === 0 ? '❚❚' : r === 1 ? '1×' : `${r > 0 ? '' : '−'}${Math.abs(r) >= 3600 ? Math.abs(r) / 3600 + 'h' : Math.abs(r) >= 60 ? Math.abs(r) / 60 + 'm' : Math.abs(r)}${r === 1 ? '' : '/s'}`;
    b.title = r === 0 ? 'Pause' : `${r}× real time`;
    b.onclick = () => {
      setRate(r);
      log('CHRONO', r === 0 ? 'simulation paused' : `time compression ${r}×`, 'info');
      paint();
    };
    ratesEl.appendChild(b);
  }

  live.onclick = () => {
    goLive();
    log('CHRONO', 'resynced to real time', 'ok');
    paint();
  };

  slider.addEventListener('input', () => {
    dragging = true;
    setSimTime(Date.now() + Number(slider.value) * 60_000);
    paint();
  });
  slider.addEventListener('change', () => {
    dragging = false;
  });

  const paint = () => {
    const t = simNow();
    const off = (t - Date.now()) / 60_000;
    if (!dragging) slider.value = String(Math.max(-1440, Math.min(1440, Math.round(off))));
    const l = isLive();
    live.classList.toggle('is-live', l);
    time.textContent = new Date(t).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
    const r = getRate();
    ratesEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.r) === r));
  };
  setInterval(paint, 500);
  paint();
}
