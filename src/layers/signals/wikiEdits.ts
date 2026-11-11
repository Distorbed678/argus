// Live English Wikipedia edits to geotagged articles (EventStreams SSE + coordinates lookup).
import { BillboardCollection, Cartesian3, NearFarScalar, type Billboard } from 'cesium';
import { icon, fmtLL, ago, esc } from '../../core/fmt';
import { pid, type LayerFactory } from '../Layer';

interface Edit {
  title: string;
  user: string;
  comment: string;
  t: number;
  lat: number;
  lon: number;
  delta: number;
  url: string;
}

const TTL = 10 * 60_000;
const SCALE = new NearFarScalar(1e5, 1.2, 2e7, 0.6);

const factory: LayerFactory = (ctx) => {
  let es: EventSource | undefined;
  let coll: BillboardCollection | undefined;
  const edits = new Map<string, Edit>();
  const bbs = new Map<string, Billboard>();
  let queue: any[] = [];
  let timer: number | undefined;
  let total = 0;

  const flush = async () => {
    if (!queue.length || !coll) return;
    const batch = queue.splice(0, 50);
    const titles = [...new Set(batch.map((e) => e.title))];
    try {
      const r = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates&format=json&origin=*&colimit=max&titles=${encodeURIComponent(titles.join('|'))}`,
      );
      const j = await r.json();
      const coords = new Map<string, { lat: number; lon: number }>();
      for (const p of Object.values<any>(j.query?.pages ?? {})) if (p.coordinates?.[0]) coords.set(p.title, p.coordinates[0]);
      for (const e of batch) {
        const c = coords.get(e.title);
        if (!c) continue;
        const key = e.title;
        const ed: Edit = { title: e.title, user: e.user, comment: e.comment ?? '', t: e.timestamp * 1000, lat: c.lat, lon: c.lon, delta: (e.length?.new ?? 0) - (e.length?.old ?? 0), url: e.meta?.uri ?? '' };
        edits.set(key, ed);
        let b = bbs.get(key);
        if (!b) {
          b = coll.add({ position: Cartesian3.fromDegrees(c.lon, c.lat), image: icon('pin', '#e0f4ff', 32), width: 14, height: 14, scaleByDistance: SCALE, id: pid(ctx.id, key) });
          bbs.set(key, b);
        }
        total++;
        if (total % 5 === 1) ctx.log(`edit: "${e.title}" by ${e.user}`, 'info', c);
      }
      const now = Date.now();
      for (const [k, ed] of edits)
        if (now - ed.t > TTL) {
          coll.remove(bbs.get(k)!);
          bbs.delete(k);
          edits.delete(k);
        }
      ctx.status('live', `EventStreams · ${total} geo-edits seen`, edits.size);
      ctx.requestRender();
    } catch {
      /* transient */
    }
  };

  return {
    enable() {
      coll = ctx.viewer.scene.primitives.add(new BillboardCollection());
      es = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.wiki === 'enwiki' && e.namespace === 0 && e.type === 'edit' && !e.bot) queue.push(e);
          if (queue.length > 400) queue = queue.slice(-200);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => ctx.status('offline', 'stream reconnecting…', edits.size);
      timer = window.setInterval(flush, 4000);
      ctx.status('loading', 'listening…');
    },
    disable() {
      es?.close();
      clearInterval(timer);
      if (coll) ctx.viewer.scene.primitives.remove(coll);
      coll = undefined;
      edits.clear();
      bbs.clear();
      queue = [];
    },
    pick(key) {
      const e = edits.get(key);
      if (!e) return;
      return {
        layer: ctx.id,
        key,
        kind: 'OSINT · WIKI EDIT',
        title: e.title,
        subtitle: `edited by ${esc(e.user)}`,
        fields: [
          ['WHEN', ago(e.t)],
          ['LOCATION', fmtLL(e.lat, e.lon)],
          ['DELTA', `${e.delta > 0 ? '+' : ''}${e.delta} bytes`],
          ['SUMMARY', esc(e.comment.slice(0, 140)) || '—'],
        ],
        position: () => Cartesian3.fromDegrees(e.lon, e.lat),
        actions: [{ label: 'ARTICLE ↗', run: () => window.open(e.url, '_blank', 'noopener') }],
        range: 2e5,
      };
    },
  };
};
export default factory;
