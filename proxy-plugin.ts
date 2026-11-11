// Tiny allowlisted CORS relay that runs inside `vite dev` and `vite preview`.
// Same contract as proxy/cloudflare-worker.js:  GET /__proxy?url=<encoded>
import type { Plugin, Connect } from 'vite';

export const PROXY_ALLOW = [
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
];

const handler: Connect.NextHandleFunction = async (req, res, next) => {
  if (!req.url?.startsWith('/__proxy')) return next();
  const target = new URL(req.url, 'http://x').searchParams.get('url');
  let url: URL;
  try {
    url = new URL(target ?? '');
  } catch {
    res.statusCode = 400;
    return res.end('bad url');
  }
  if (url.protocol !== 'https:' || !PROXY_ALLOW.includes(url.hostname)) {
    res.statusCode = 403;
    return res.end('host not allowed');
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': 'ARGUS-globe/0.1 (+static viewer)', Accept: '*/*' };
    const fwd = req.headers['x-windy-api-key'];
    if (typeof fwd === 'string') headers['x-windy-api-key'] = fwd;
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    res.statusCode = r.status;
    res.setHeader('content-type', r.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('x-argus-proxy', '1');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.statusCode = 502;
    res.end(String(e));
  }
};

export function argusProxy(): Plugin {
  return {
    name: 'argus-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
