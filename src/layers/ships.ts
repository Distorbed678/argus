// AIS vessels. Keyless: Finnish Digitraffic (Baltic). With an aisstream.io key: live WebSocket for the current view.
import { BillboardCollection, Cartesian3, NearFarScalar, Math as CMath, type Billboard } from 'cesium';
import { getData, Poller, describeError } from '../data/fetcher';
import { settings } from '../core/store';
import { icon, fmtLL, ago } from '../core/fmt';
import { pid, type LayerFactory, type Dossier } from './Layer';

interface Ship {
  mmsi: number;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  heading?: number;
  nav?: number;
  name?: string;
  t: number;
  src: string;
}

const NAV = ['Under way (engine)', 'At anchor', 'Not under command', 'Restricted manoeuvrability', 'Constrained by draught', 'Moored', 'Aground', 'Fishing', 'Under way (sail)'];
const color = (s: Ship) => (s.nav === 1 || s.nav === 5 ? '#6b7d99' : s.nav === 7 ? '#7cffb2' : (s.sog ?? 0) > 15 ? '#9be7ff' : '#00e5ff');

const factory: LayerFactory = (ctx) => {
  let coll: BillboardCollection | undefined;
  const bbs = new Map<number, Billboard>();
  const ships = new Map<number, Ship>();
  let poller: Poller | undefined;
  let ws: WebSocket | undefined;
  let wsCount = 0;
  let moveOff: (() => void) | undefined;
  const scale = new NearFarScalar(2e4, 1.2, 6e6, 0.4);

  const upsert = (s: Ship) => {
    if (!coll || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;
    const prev = ships.get(s.mmsi);
    ships.set(s.mmsi, { ...prev, ...s, name: s.name ?? prev?.name });
    let b = bbs.get(s.mmsi);
    const pos = Cartesian3.fromDegrees(s.lon, s.lat, 0);
    if (!b) {
      b = coll.add({ position: pos, image: icon('ship', color(s), 24), width: 12, height: 12, alignedAxis: Cartesian3.UNIT_Z, scaleByDistance: scale, id: pid(ctx.id, String(s.mmsi)) });
      bbs.set(s.mmsi, b);
    } else b.position = pos;
    const hdg = s.heading != null && s.heading < 360 ? s.heading : s.cog ?? 0;
    b.rotation = -CMath.toRadians(hdg);
  };

  const pollBaltic = async () => {
    try {
      const r = await getData<any>('https://meri.digitraffic.fi/api/ais/v1/locations', { ttl: 55_000, timeout: 40000 });
      const t = Date.now();
      for (const f of r.data.features) {
        const p = f.properties;
        upsert({ mmsi: f.mmsi, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], sog: p.sog, cog: p.cog, heading: p.heading, nav: p.navStat, t: p.timestampExternal ?? t, src: 'Digitraffic' });
      }
      // expire stale
      for (const [k, s] of ships) if (Date.now() - s.t > 30 * 60_000) {
        coll?.remove(bbs.get(k)!);
        bbs.delete(k);
        ships.delete(k);
      }
      ctx.status('live', `Digitraffic Baltic${ws ? ` + aisstream (${wsCount})` : settings.keys.aisstream ? '' : ' · add aisstream key for global'}`, ships.size);
      ctx.requestRender();
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail, ships.size);
      throw e;
    }
  };

  const connectStream = () => {
    const key = settings.keys.aisstream;
    if (!key) return;
    ws?.close();
    const rect = ctx.viewer.camera.computeViewRectangle();
    if (!rect) return;
    const box = [
      [CMath.toDegrees(rect.south), CMath.toDegrees(rect.west)],
      [CMath.toDegrees(rect.north), CMath.toDegrees(rect.east)],
    ];
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch {
      return;
    }
    ws.onopen = () => ws!.send(JSON.stringify({ APIKey: key, BoundingBoxes: [box], FilterMessageTypes: ['PositionReport'] }));
    ws.onmessage = async (ev) => {
      const txt = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
      try {
        const m = JSON.parse(txt);
        const pr = m.Message?.PositionReport;
        if (!pr) return;
        wsCount++;
        upsert({ mmsi: m.MetaData.MMSI, lat: m.MetaData.latitude, lon: m.MetaData.longitude, sog: pr.Sog, cog: pr.Cog, heading: pr.TrueHeading, nav: pr.NavigationalStatus, name: m.MetaData.ShipName?.trim(), t: Date.now(), src: 'aisstream.io' });
        if (wsCount % 50 === 0) {
          ctx.status('live', `aisstream live (${wsCount} msgs) + Digitraffic`, ships.size);
          ctx.requestRender();
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => ctx.log('aisstream socket rejected (browser connections may be blocked) — using Digitraffic only', 'warn');
  };

  return {
    enable() {
      coll = ctx.viewer.scene.primitives.add(new BillboardCollection());
      poller = new Poller(pollBaltic, 60_000);
      poller.start();
      connectStream();
      let deb: number | undefined;
      moveOff = ctx.viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(deb);
        deb = window.setTimeout(connectStream, 1500);
      });
    },
    disable() {
      moveOff?.();
      poller?.stop();
      ws?.close();
      ws = undefined;
      if (coll) ctx.viewer.scene.primitives.remove(coll);
      coll = undefined;
      bbs.clear();
      ships.clear();
    },
    async pick(key) {
      const s = ships.get(Number(key));
      if (!s) return;
      let meta: any = {};
      if (s.src === 'Digitraffic') {
        try {
          meta = (await getData<any>(`https://meri.digitraffic.fi/api/ais/v1/vessels/${s.mmsi}`, { ttl: 3600_000 })).data;
        } catch {
          /* ignore */
        }
      }
      const d: Dossier = {
        layer: ctx.id,
        key,
        kind: 'VESSEL',
        title: meta.name || s.name || `MMSI ${s.mmsi}`,
        subtitle: [meta.destination && `→ ${meta.destination}`, meta.callSign].filter(Boolean).join(' · ') || 'AIS target',
        fields: [
          ['MMSI', String(s.mmsi)],
          ['IMO', meta.imo ? String(meta.imo) : '—'],
          ['SHIP TYPE', meta.shipType != null ? String(meta.shipType) : '—'],
          ['DRAUGHT', meta.draught ? `${meta.draught / 10} m` : '—'],
          ['SOURCE', s.src],
        ],
        live: () => {
          const c = ships.get(s.mmsi) ?? s;
          return [
            ['POSITION', fmtLL(c.lat, c.lon)],
            ['SPEED', c.sog != null ? `${c.sog.toFixed(1)} kn` : '—'],
            ['COURSE', c.cog != null ? `${c.cog.toFixed(0)}°` : '—'],
            ['STATUS', NAV[c.nav ?? -1] ?? '—'],
            ['LAST FIX', ago(c.t)],
          ];
        },
        position: () => {
          const c = ships.get(s.mmsi) ?? s;
          return Cartesian3.fromDegrees(c.lon, c.lat, 0);
        },
        range: 20000,
        actions: [{ label: 'MARINETRAFFIC ↗', run: () => window.open(`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${s.mmsi}`, '_blank', 'noopener') }],
      };
      return d;
    },
  };
};
export default factory;
