import type { Viewer } from 'cesium';
import { bus, log } from '../core/bus';
import { settings, setLayerPersisted } from '../core/store';
import { selected, select } from '../core/target';
import type { Dossier, LayerInstance, LayerMeta, LayerStatus } from './Layer';
import { LAYERS } from './registry';

interface State {
  meta: LayerMeta;
  inst?: LayerInstance;
  on: boolean;
  status: LayerStatus;
  detail?: string;
  count?: number;
  updated?: number;
}

const states = new Map<string, State>();
const pickers = new Map<string, (key: string) => Dossier | undefined | Promise<Dossier | undefined>>();
const finders = new Map<string, (q: string) => Dossier | undefined | Promise<Dossier | undefined>>();
let viewer: Viewer;

export function initLayers(v: Viewer) {
  viewer = v;
  for (const m of LAYERS) states.set(m.id, { meta: m, on: false, status: 'off' });
}

export function registerPicker(ns: string, fn: (key: string) => Dossier | undefined | Promise<Dossier | undefined>) {
  pickers.set(ns, fn);
}
export function registerFinder(ns: string, fn: (q: string) => Dossier | undefined | Promise<Dossier | undefined>) {
  finders.set(ns, fn);
}

export function layerStates() {
  return [...states.values()];
}
export function layerState(id: string) {
  return states.get(id);
}

let proxyHinted = false;
function setStatus(id: string, status: LayerStatus, detail?: string, count?: number) {
  const s = states.get(id);
  if (!s) return;
  if (status === 'proxy' && !proxyHinted) {
    proxyHinted = true;
    log('RELAY', `${s.meta.name} needs a CORS relay on static hosting — deploy proxy/cloudflare-worker.js and set it in ⚙ Settings`, 'warn');
  }
  s.status = status;
  s.detail = detail;
  if (count !== undefined) s.count = count;
  if (status === 'live' || status === 'cached') s.updated = Date.now();
  bus.emit('status', { id, status, detail, count: s.count, updated: s.updated });
}

export async function toggle(id: string, on: boolean, persist = true) {
  const s = states.get(id);
  if (!s || s.on === on) return;
  s.on = on;
  if (persist) setLayerPersisted(id, on);
  bus.emit('layer-toggle', { id, on });
  if (!on) {
    if (selected()?.layer === id) select(null);
    try {
      s.inst?.disable();
    } catch (e) {
      console.error(e);
    }
    s.count = 0;
    setStatus(id, 'off');
    viewer.scene.requestRender();
    return;
  }
  if (s.meta.needsKey && !s.meta.keyOptional && !settings.keys[s.meta.needsKey]) {
    setStatus(id, 'key', `needs ${s.meta.needsKey} key (Settings)`);
    return;
  }
  setStatus(id, 'loading');
  try {
    if (!s.inst) {
      const mod = await s.meta.load();
      s.inst = mod.default({
        viewer,
        id,
        status: (st, d, c) => setStatus(id, st, d, c),
        log: (msg, level, pos) => log(s.meta.name.toUpperCase(), msg, level, pos),
        requestRender: () => viewer.scene.requestRender(),
      });
      if (s.inst.pick) registerPicker(id, s.inst.pick.bind(s.inst));
      if (s.inst.find) registerFinder(id, s.inst.find.bind(s.inst));
    }
    if (!s.on) return; // toggled off while loading
    await s.inst.enable();
  } catch (e) {
    console.error(`[layer ${id}]`, e);
    setStatus(id, 'error', String((e as Error).message ?? e));
  }
  viewer.scene.requestRender();
}

export function isOn(id: string) {
  return !!states.get(id)?.on;
}

export async function pickById(ns: string, key: string): Promise<Dossier | undefined> {
  const fn = pickers.get(ns);
  return fn ? await fn(key) : undefined;
}

const FIND_ORDER = ['sat', 'flights', 'mil-air', 'ships', 'launches', 'cables'];
export async function findAny(q: string): Promise<Dossier | undefined> {
  const ordered = [...finders.entries()].sort((a, b) => {
    const ia = FIND_ORDER.indexOf(a[0]);
    const ib = FIND_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const [, fn] of ordered) {
    const d = await fn(q);
    if (d) return d;
  }
  return undefined;
}

export function findLayer(q: string): LayerMeta | undefined {
  const s = q.toLowerCase();
  return (
    LAYERS.find((l) => l.id === s) ??
    LAYERS.find((l) => l.name.toLowerCase() === s) ??
    LAYERS.find((l) => l.id.includes(s) || l.name.toLowerCase().includes(s))
  );
}

export async function restoreLayers() {
  for (const id of settings.layers) if (states.has(id)) toggle(id, true, false);
}
