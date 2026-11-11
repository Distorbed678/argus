// ARGUS CORS relay for static hosting. Deploy free on Cloudflare Workers:
//   npx wrangler deploy proxy/cloudflare-worker.js --name argus-proxy --compatibility-date 2025-01-01
// Then in ARGUS → Settings → Proxy URL:  https://argus-proxy.<you>.workers.dev/?url=
// Only allowlisted hosts are relayed (keep in sync with proxy-plugin.ts).
const ALLOW = new Set([
  'api.adsb.lol',
  'opendata.adsb.fi',
  'api.airplanes.live',
  'opensky-network.org',
  'overpass-api.de',
  'overpass.kumi.systems',
  'maps.mail.ru',
  'api.gdeltproject.org',
  'firms.modaps.eosdis.nasa.gov',
  'api.windy.com',
  'webcams.nyctmc.org',
  'www.submarinecablemap.com',
  'api.ioda.inetintel.cc.gatech.edu',
  'tfr.faa.gov',
  'www.tsunami.gov',
  'network.satnogs.org',
]);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'x-windy-api-key, accept',
};

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    let target;
    try {
      target = new URL(new URL(req.url).searchParams.get('url') ?? '');
    } catch {
      return new Response('bad url', { status: 400, headers: CORS });
    }
    if (target.protocol !== 'https:' || !ALLOW.has(target.hostname)) return new Response('host not allowed', { status: 403, headers: CORS });

    const cache = caches.default;
    const key = new Request(target.toString());
    const hit = await cache.match(key);
    if (hit) return hit;

    const headers = { 'User-Agent': 'ARGUS-globe/0.1 (+cf-worker relay)', Accept: '*/*' };
    const wk = req.headers.get('x-windy-api-key');
    if (wk) headers['x-windy-api-key'] = wk;
    const r = await fetch(target, { headers });
    const res = new Response(r.body, r);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    // short edge cache shares one upstream fetch across all viewers
    if (r.ok && !wk) {
      res.headers.set('cache-control', 'public, max-age=10');
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};
