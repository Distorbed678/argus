// AOI alerting: watches the live feeds (military aircraft, quakes, fires, GDACS, EONET) and the
// earth-obs / military satellite catalog, and raises de-duplicated alerts in the intercept log
// (+ optional browser notifications).
import { bus, log, type LogLevel } from '../core/bus';
import { settings } from '../core/store';
import { isLive } from '../core/clock';
import { inShape } from '../core/geo';
import { isOn } from '../layers/manager';
import type { FeedItem } from '../layers/Layer';
import { aois, type Aoi } from './aoi';

export interface AoiAlert {
  t: number;
  aoi: string;
  msg: string;
  level: LogLevel;
  lat?: number;
  lon?: number;
}

const SEEN_KEY = 'argus.alertseen.v1';
const MIN = 60_000;
/** how long a given (aoi, object) pair stays silenced */
const TTL: Record<string, number> = {
  'mil-air': 30 * MIN,
  sat: 25 * MIN,
  quakes: 3 * 24 * 60 * MIN,
  gdacs: 3 * 24 * 60 * MIN,
  eonet: 3 * 24 * 60 * MIN,
  fires: 2 * 24 * 60 * MIN,
};
const EVENT_LAYERS = new Set(['quakes', 'gdacs', 'eonet', 'fires']);
const WATCHED = new Set(['mil-air', ...EVENT_LAYERS]);

const seen = new Map<string, number>(loadSeen());
const lastFeed = new Map<string, FeedItem[]>();
/** aircraft currently inside each AOI (for "entering" edges) */
const inside = new Map<string, Set<string>>();
const recent: AoiAlert[] = [];

function loadSeen(): [string, number][] {
  try {
    const now = Date.now();
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as [string, number][]).filter((e) => e[1] > now);
  } catch {
    return [];
  }
}
let saveTimer: number | undefined;
function saveSeen() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const now = Date.now();
    for (const [k, exp] of seen) if (exp < now) seen.delete(k);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-3000)));
    } catch {
      /* ignore */
    }
  }, 2000);
}

/** true when this key has not alerted within its TTL (and marks it). */
export function fresh(key: string, ttl: number): boolean {
  const now = Date.now();
  const exp = seen.get(key);
  if (exp && exp > now) return false;
  seen.set(key, now + ttl);
  saveSeen();
  return true;
}

export const recentAoiAlerts = () => recent;

function raise(a: Aoi, msg: string, level: LogLevel, pos?: { lat: number; lon: number }) {
  const e: AoiAlert = { t: Date.now(), aoi: a.name, msg, level, lat: pos?.lat, lon: pos?.lon };
  recent.push(e);
  if (recent.length > 60) recent.shift();
  log('AOI', `[${a.name}] ${msg}`, level, pos);
  notify(`ARGUS · ${a.name}`, msg);
}

export function notify(title: string, body: string) {
  if (!settings.notify || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: './icons/icon-192.png', tag: `${title}|${body}`.slice(0, 120) });
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
    navigator.serviceWorker?.getRegistration().then((r) => r?.showNotification(title, { body, icon: './icons/icon-192.png' })).catch(() => {});
  }
}

function checkFeed(layer: string, items: FeedItem[]) {
  const list = aois();
  if (!list.length) return;
  if (layer === 'mil-air') {
    for (const a of list) {
      const prev = inside.get(a.id) ?? new Set<string>();
      const now = new Set<string>();
      for (const it of items) {
        if (!inShape(it.lat, it.lon, a.shape)) continue;
        now.add(it.key);
        if (!prev.has(it.key) && fresh(`${a.id}|mil|${it.key}`, TTL['mil-air'])) raise(a, `military aircraft ${it.label} entered watch area`, 'alert', it);
      }
      inside.set(a.id, now);
    }
    return;
  }
  if (!EVENT_LAYERS.has(layer)) return;
  for (const a of list) {
    const hits = items.filter((it) => inShape(it.lat, it.lon, a.shape) && fresh(`${a.id}|${layer}|${it.key}`, TTL[layer]));
    if (!hits.length) continue;
    if (layer === 'fires') {
      // hotspots come in clusters: one aggregated alert per refresh
      raise(a, hits.length === 1 ? hits[0].label : `${hits.length} new fire hotspots detected`, 'warn', hits[0]);
    } else for (const h of hits.slice(0, 5)) raise(a, h.label, layer === 'quakes' || layer === 'gdacs' ? 'alert' : 'warn', h);
  }
}

// ---------- satellites overhead ----------
let satIdx: Int32Array | null = null;
let satIdxN = -1;
let satBusy = false;

async function checkSats() {
  const list = aois();
  if (!list.length || satBusy || document.hidden || !isLive()) return;
  if (!isOn('sat-earthobs') && !isOn('sat-military')) return;
  satBusy = true;
  try {
    const { satEngine } = await import('../layers/satellites/engine');
    if (!satEngine.ready) return;
    if (satEngine.meta.length !== satIdxN) {
      satIdx = satEngine.indicesOf(['earthobs', 'military']);
      satIdxN = satEngine.meta.length;
    }
    const hits = await satEngine.aoiSats(satIdx!, list.map((a) => a.shape));
    for (const h of hits) {
      const a = list[h.aoi];
      const m = satEngine.meta[h.idx];
      if (!a || !m) continue;
      if (!fresh(`${a.id}|sat|${m.norad}`, TTL.sat)) continue;
      const mil = m.cat === 'military';
      raise(a, `${mil ? 'military/recon' : 'earth-obs'} satellite ${m.name} (NORAD ${m.norad}) overhead · alt ${h.alt.toFixed(0)} km`, mil ? 'alert' : 'warn', { lat: h.lat, lon: h.lon });
    }
  } catch (e) {
    console.warn('[alerts] sats', e);
  } finally {
    satBusy = false;
  }
}

export function initAlerts() {
  bus.on('feed', ({ layer, items }) => {
    if (!WATCHED.has(layer)) return;
    lastFeed.set(layer, items);
    checkFeed(layer, items);
  });
  // a newly drawn AOI is checked against what is already on screen
  bus.on('aoi', () => {
    const ids = new Set(aois().map((a) => a.id));
    for (const k of inside.keys()) if (!ids.has(k)) inside.delete(k);
    for (const [layer, items] of lastFeed) checkFeed(layer, items);
    void checkSats();
  });
  window.setInterval(checkSats, 30_000);
  setTimeout(checkSats, 8000);
}

/** For the AOI panel: what's currently inside an AOI from the active feeds. */
export function aoiContents(a: Aoi): { layer: string; n: number }[] {
  const out: { layer: string; n: number }[] = [];
  for (const [layer, items] of lastFeed) {
    const n = items.reduce((s, it) => s + (inShape(it.lat, it.lon, a.shape) ? 1 : 0), 0);
    if (n) out.push({ layer, n });
  }
  return out;
}

