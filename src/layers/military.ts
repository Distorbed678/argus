// Global military aircraft broadcasting ADS-B (adsb.lol /v2/mil → adsb.fi /v2/mil).
import { getData, describeError, Poller } from '../data/fetcher';
import { acRenderer, acDossier, fromAdsb, type Ac } from './flights';
import type { LayerFactory } from './Layer';

const factory: LayerFactory = (ctx) => {
  const r = acRenderer(ctx);
  let poller: Poller | undefined;
  let first = true;

  const tick = async () => {
    const now = Date.now();
    let lastErr: unknown;
    for (const [name, url] of [
      ['adsb.lol', 'https://api.adsb.lol/v2/mil'],
      ['adsb.fi', 'https://opendata.adsb.fi/api/v2/mil'],
    ]) {
      try {
        const res = await getData<any>(url, { via: 'proxy', ttl: 25_000 });
        const list = ((res.data.ac ?? res.data.aircraft ?? []) as any[]).map((a) => fromAdsb(a, now, name)).filter(Boolean) as Ac[];
        for (const a of list) a.mil = true;
        r.update(list, true, (a) => {
          if (!first) ctx.log(`MIL contact ${a.flight || a.hex.toUpperCase()} ${a.t ?? ''} @ ${a.alt === 'ground' ? 'GND' : Math.round(a.alt) + 'ft'}`, 'warn', { lon: a.lon, lat: a.lat });
        });
        if (first) ctx.log(`${list.length} military aircraft broadcasting ADS-B worldwide`, 'warn');
        first = false;
        ctx.status(res.stale ? 'cached' : 'live', `${name} global mil feed`, r.acs.size);
        return;
      } catch (e) {
        lastErr = e;
        if (describeError(e).status === 'proxy') break;
      }
    }
    const d = describeError(lastErr);
    ctx.status(d.status, d.detail, r.acs.size);
    throw lastErr;
  };

  return {
    enable() {
      first = true;
      r.start();
      poller = new Poller(tick, 30_000);
      poller.start();
    },
    disable() {
      poller?.stop();
      r.stop();
    },
    locate: (k) => r.locate(k),
    pick(key) {
      const a = r.acs.get(key);
      return a ? acDossier(ctx.id, a, () => r.acs.get(key)) : undefined;
    },
    find(q) {
      const s = q.trim().toUpperCase();
      for (const a of r.acs.values()) if (a.flight?.toUpperCase() === s || a.hex.toUpperCase() === s) return acDossier(ctx.id, a, () => r.acs.get(a.hex));
      return;
    },
  };
};
export default factory;
