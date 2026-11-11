// Persistent settings (per-viewer conveniences only; wrapped for private mode).
import { bus } from './bus';

export interface Settings {
  reduceFx: boolean;
  highQuality: boolean;
  base: 'sat' | 'dark' | 'truecolor' | 'osm';
  mode: string;
  layers: string[];
  proxyUrl: string;
  keys: { ion: string; aisstream: string; windy: string };
  labels: boolean;
  bootSeen: boolean;
  gdeltQuery: string;
}

const KEY = 'argus.settings.v1';
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const defaults: Settings = {
  reduceFx: reduceMotion,
  highQuality: false,
  base: 'sat',
  mode: 'normal',
  layers: ['sat-stations', 'sat-military', 'sat-starlink', 'sat-comms', 'sat-gnss', 'sat-earthobs', 'sat-other', 'terminator', 'sun-moon', 'quakes', 'flights', 'space-wx', 'eonet', 'launches'],
  proxyUrl: '',
  keys: { ion: '', aisstream: '', windy: '' },
  labels: true,
  bootSeen: false,
  gdeltQuery: 'ARMEDCONFLICT,PROTEST,TERROR,CYBER_ATTACK',
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...defaults, ...p, keys: { ...defaults.keys, ...(p.keys ?? {}) } };
    }
  } catch {
    /* storage unavailable */
  }
  return structuredClone(defaults);
}

export const settings: Settings = load();

export function saveSettings(patch?: Partial<Settings>) {
  if (patch) Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  bus.emit('settings', undefined);
}

export function setLayerPersisted(id: string, on: boolean) {
  const s = new Set(settings.layers);
  if (on) s.add(id);
  else s.delete(id);
  saveSettings({ layers: [...s] });
}
