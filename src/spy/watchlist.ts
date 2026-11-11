// Watchlist: pinned targets with live status, persisted by stable reference
// (satellites by NORAD id, aircraft by ICAO hex, ships by MMSI, everything else by layer key).
import { Cartesian3, type Viewer } from 'cesium';
import { bus, log } from '../core/bus';
import { toLL } from '../core/fmt';
import { simNow } from '../core/clock';
import { select, release } from '../core/target';
import { getData } from '../data/fetcher';
import { locateById, pickById } from '../layers/manager';
import type { Dossier, Fix } from '../layers/Layer';

export interface Pin {
  id: string;
  layer: string;
  key: string;
  ref: string;
  kind: string;
  title: string;
  added: number;
  last?: Fix & { t: number };
}

export type PinState = 'live' | 'stale' | 'lost' | 'static' | 'pending';
export interface PinStatus {
  state: PinState;
  fix?: Fix & { t: number };
  note?: string;
}

const KEY = 'argus.watch.v1';
const AIR = new Set(['flights', 'mil-air']);
let viewer: Viewer;
let pins: Pin[] = load();
const status = new Map<string, PinStatus>();
const remoteAt = new Map<string, number>();
const remote = new Map<string, any>();

function load(): Pin[] {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(r) ? r.filter((p) => p?.id && p.layer) : [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    /* ignore */
  }
}

export const watchPins = () => pins;
export const pinStatus = (id: string) => status.get(id);

const pinId = (layer: string, ref: string) => `${AIR.has(layer) ? 'air' : layer}:${ref}`;
const refOf = (d: Dossier) => d.ref ?? d.key;

export function isPinned(d: Dossier) {
  return pins.some((p) => p.id === pinId(d.layer, refOf(d)));
}

export function togglePin(d: Dossier): boolean {
  const id = pinId(d.layer, refOf(d));
  if (pins.some((p) => p.id === id)) {
    unpin(id);
    return false;
  }
  const pos = d.position?.();
  const ll = pos ? toLL(pos) : undefined;
  pins = [...pins, { id, layer: d.layer, key: d.key, ref: refOf(d), kind: d.kind, title: d.title, added: Date.now(), last: ll ? { lat: ll.lat, lon: ll.lon, alt: ll.h, t: Date.now() } : undefined }];
  save();
  log('WATCH', `${d.title} pinned to watchlist`, 'ok');
  bus.emit('watch', undefined);
  void refresh();
  return true;
}

export function unpin(id: string) {
  pins = pins.filter((p) => p.id !== id);
  status.delete(id);
  save();
  bus.emit('watch', undefined);
}

async function satFix(p: Pin): Promise<PinStatus> {
  const { satEngine } = await import('../layers/satellites/engine');
  if (!satEngine.ready) return { state: 'pending', note: 'satellite catalog not loaded' };
  let idx = Number(p.key);
  if (satEngine.meta[idx]?.norad !== Number(p.ref)) {
    idx = satEngine.findIndex(p.ref);
    if (idx < 0) return { state: 'lost', fix: p.last, note: 'not in current catalog (decayed?)' };
    p.key = String(idx);
  }
  const s = satEngine.state(idx);
  if (!s) return { state: 'lost', fix: p.last, note: 'no SGP4 solution' };
  return { state: 'live', fix: { lat: s.lat, lon: s.lon, alt: s.alt * 1000, t: simNow() } };
}

async function airFix(p: Pin): Promise<PinStatus> {
  for (const l of [p.layer, ...AIR]) {
    const f = locateById(l, p.ref);
    if (f) {
      p.layer = l;
      return classify({ ...f, t: f.t ?? Date.now() });
    }
  }
  // not on screen: ask adsb.lol directly for this hex (relay), at most every 30 s
  const now = Date.now();
  if (now - (remoteAt.get(p.id) ?? 0) > 30_000) {
    remoteAt.set(p.id, now);
    try {
      const r = await getData<any>(`https://api.adsb.lol/v2/hex/${p.ref}`, { via: 'proxy', ttl: 25_000, timeout: 12000 });
      const a = (r.data.ac ?? [])[0];
      if (a?.lat != null) remote.set(p.id, { ...a, _at: now - (a.seen_pos ?? a.seen ?? 0) * 1000 });
    } catch {
      /* relay missing / offline */
    }
  }
  const a = remote.get(p.id);
  if (a) return classify({ lat: a.lat, lon: a.lon, alt: typeof a.alt_baro === 'number' ? a.alt_baro * 0.3048 : 0, t: a._at }, 'via adsb.lol hex lookup');
  return { state: 'lost', fix: p.last, note: 'no ADS-B fix' };
}

function classify(fix: Fix & { t: number }, note?: string): PinStatus {
  const age = Date.now() - fix.t;
  return { state: age < 90_000 ? 'live' : age < 5 * 60_000 ? 'stale' : 'lost', fix, note };
}

async function resolve(p: Pin): Promise<PinStatus> {
  if (p.layer === 'sat') return satFix(p);
  if (AIR.has(p.layer)) return airFix(p);
  if (p.layer === 'ground') return { state: 'static', fix: p.last };
  const f = locateById(p.layer, p.key);
  if (f) return f.t ? classify({ ...f, t: f.t }) : { state: 'live', fix: { ...f, t: Date.now() } };
  return { state: 'lost', fix: p.last, note: 'layer off or object gone' };
}

let busy = false;
async function refresh() {
  if (busy || !pins.length) return;
  busy = true;
  let dirty = false;
  try {
    for (const p of pins) {
      const prev = status.get(p.id)?.state;
      const st = await resolve(p);
      status.set(p.id, st);
      if (st.fix && st.state !== 'lost') {
        p.last = st.fix;
        dirty = true;
      }
      if (prev && prev !== st.state) {
        if (st.state === 'lost') log('WATCH', `${p.title}: LOST CONTACT${st.note ? ` (${st.note})` : ''}`, 'warn', p.last);
        else if (prev === 'lost' && st.state === 'live') log('WATCH', `${p.title}: contact re-acquired`, 'ok', st.fix);
      }
    }
    if (dirty) save();
  } finally {
    busy = false;
  }
  bus.emit('watch', undefined);
}

export async function selectPin(p: Pin) {
  const st = status.get(p.id) ?? (await resolve(p));
  if (st.state !== 'lost' && st.state !== 'pending') {
    const d = p.layer === 'ground' ? undefined : await pickById(p.layer, p.layer === 'sat' ? p.key : p.ref);
    if (d) {
      select(d);
      return;
    }
  }
  const f = st.fix ?? p.last;
  if (!f) return;
  release();
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(f.lon, f.lat, Math.max(2e4, (f.alt ?? 0) + 3e5)), duration: 2 });
}

export function initWatchlist(v: Viewer) {
  viewer = v;
  window.setInterval(() => !document.hidden && void refresh(), 3000);
  setTimeout(refresh, 4000);
}
