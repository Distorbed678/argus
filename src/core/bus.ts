// Tiny typed event bus.
import type { Dossier, FeedItem, LayerStatus } from '../layers/Layer';

export type LogLevel = 'info' | 'warn' | 'alert' | 'ok';
export interface LogEntry {
  t: number;
  level: LogLevel;
  src: string;
  msg: string;
  lon?: number;
  lat?: number;
}

export interface Events {
  log: LogEntry;
  status: { id: string; status: LayerStatus; detail?: string; count?: number; updated?: number };
  select: Dossier | null;
  'layer-toggle': { id: string; on: boolean };
  settings: void;
  mode: string;
  visibility: boolean;
  /** a layer finished a refresh: its full current item list */
  feed: { layer: string; items: FeedItem[] };
  aoi: void;
  watch: void;
}

type Handler<T> = (payload: T) => void;

class Bus {
  private map = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(k: K, fn: Handler<Events[K]>): () => void {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit<K extends keyof Events>(k: K, payload: Events[K]): void {
    this.map.get(k)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error('[bus]', k, e);
      }
    });
  }
}

export const bus = new Bus();

export function log(src: string, msg: string, level: LogLevel = 'info', pos?: { lon: number; lat: number }) {
  bus.emit('log', { t: Date.now(), level, src, msg, lon: pos?.lon, lat: pos?.lat });
}
