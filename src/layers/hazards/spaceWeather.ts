// Space weather HUD widget: planetary Kp, X-ray flare class, NOAA R/S/G scales.
import { getData, Poller, describeError } from '../../data/fetcher';
import { esc } from '../../core/fmt';
import type { LayerFactory } from '../Layer';

const factory: LayerFactory = (ctx) => {
  let poller: Poller | undefined;
  let box: HTMLElement | null = null;
  let lastClass = '';

  const refresh = async () => {
    try {
      const [kp, fl, sc] = await Promise.all([
        getData<any[]>('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', { ttl: 9 * 60_000 }),
        getData<any[]>('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', { ttl: 4 * 60_000 }),
        getData<any>('https://services.swpc.noaa.gov/products/noaa-scales.json', { ttl: 9 * 60_000 }),
      ]);
      const lastKp = kp.data[kp.data.length - 1];
      const kpVal = Array.isArray(lastKp) ? Number(lastKp[1]) : Number(lastKp.Kp);
      const f = fl.data[0] ?? {};
      const now = sc.data['0'] ?? {};
      const cls: string = f.max_class ?? '—';
      if (cls !== lastClass && /^[MX]/.test(cls)) ctx.log(`solar flare ${cls} peaked ${String(f.max_time).slice(11, 16)}Z — HF radio blackout risk`, 'alert');
      lastClass = cls;
      const kpColor = kpVal >= 7 ? 'var(--red)' : kpVal >= 5 ? 'var(--amber)' : 'var(--cyan)';
      if (box)
        box.innerHTML = `<div class="hud-title">SPACE WX</div>
          <div class="kv"><span>Kp</span><b style="color:${kpColor}">${kpVal.toFixed(2)}</b></div>
          <div class="kv"><span>X-RAY</span><b>${esc(f.current_class ?? '—')}</b></div>
          <div class="kv"><span>LAST FLARE</span><b>${esc(cls)}</b></div>
          <div class="kv"><span>R/S/G</span><b>R${esc(now.R?.Scale ?? 0)} S${esc(now.S?.Scale ?? 0)} G${esc(now.G?.Scale ?? 0)}</b></div>`;
      ctx.status('live', `Kp ${kpVal.toFixed(1)} · flare ${cls}`);
      if (kpVal >= 5) ctx.log(`geomagnetic storm conditions: Kp ${kpVal.toFixed(1)}`, 'alert');
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail);
      throw e;
    }
  };

  return {
    enable() {
      box = document.getElementById('hud-wx');
      if (box) box.hidden = false;
      document.body.classList.add('has-wx');
      poller = new Poller(refresh, 5 * 60_000);
      poller.start();
    },
    disable() {
      poller?.stop();
      if (box) box.hidden = true;
      document.body.classList.remove('has-wx');
    },
  };
};
export default factory;
