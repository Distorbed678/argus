// fetch + memory/IndexedDB cache + CORS-proxy fallback + backoff.
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { settings } from '../core/store';

export type Via = 'direct' | 'proxy' | 'auto';

export class ProxyMissingError extends Error {
  constructor() {
    super('CORS proxy unavailable — set one in Settings');
  }
}

export interface FetchOpts {
  via?: Via;
  ttl?: number; // ms; serve from cache if younger than this
  cacheKey?: string;
  persist?: boolean; // store in IndexedDB
  as?: 'json' | 'text';
  timeout?: number;
  headers?: Record<string, string>;
}

export interface FetchResult<T> {
  data: T;
  fromCache: boolean;
  stale: boolean;
  at: number;
}

interface Entry {
  at: number;
  data: unknown;
}

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<FetchResult<any>>>();
const corsBlocked = new Set<string>();

export function proxyBase(): string {
  return settings.proxyUrl.trim() || './__proxy?url=';
}

export function proxied(url: string): string {
  const base = proxyBase();
  return base.includes('{url}') ? base.replace('{url}', encodeURIComponent(url)) : base + encodeURIComponent(url);
}

async function raw(url: string, opts: FetchOpts, viaProxy: boolean): Promise<unknown> {
  const target = viaProxy ? proxied(url) : url;
  const r = await fetch(target, {
    headers: opts.headers,
    signal: AbortSignal.timeout(opts.timeout ?? 30000),
  });
  const ct = r.headers.get('content-type') ?? '';
  if (viaProxy && (r.status === 404 || (ct.includes('text/html') && !url.includes('.html')))) throw new ProxyMissingError();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return opts.as === 'text' ? r.text() : r.json();
}

export async function getData<T = any>(url: string, opts: FetchOpts = {}): Promise<FetchResult<T>> {
  const key = opts.cacheKey ?? url;
  const ttl = opts.ttl ?? 0;
  const now = Date.now();
  let cached = mem.get(key);
  if (!cached && opts.persist) {
    try {
      cached = (await idbGet(key)) as Entry | undefined;
      if (cached) mem.set(key, cached);
    } catch {
      /* idb unavailable */
    }
  }
  if (cached && now - cached.at < ttl) return { data: cached.data as T, fromCache: true, stale: false, at: cached.at };

  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<FetchResult<T>> => {
    const host = new URL(url, location.href).hostname;
    const via = opts.via ?? 'direct';
    try {
      let data: unknown;
      if (via === 'proxy' || (via === 'auto' && corsBlocked.has(host))) data = await raw(url, opts, true);
      else if (via === 'auto') {
        try {
          data = await raw(url, opts, false);
        } catch (e) {
          if (e instanceof TypeError) {
            corsBlocked.add(host);
            data = await raw(url, opts, true);
          } else throw e;
        }
      } else data = await raw(url, opts, false);
      const entry = { at: Date.now(), data };
      mem.set(key, entry);
      if (opts.persist) idbSet(key, entry).catch(() => {});
      return { data: data as T, fromCache: false, stale: false, at: entry.at };
    } catch (e) {
      if (cached) return { data: cached.data as T, fromCache: true, stale: true, at: cached.at };
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Polling helper with exponential backoff that pauses while the tab is hidden. */
export class Poller {
  private timer: number | undefined;
  private fails = 0;
  private stopped = true;
  constructor(
    private fn: () => Promise<void>,
    private interval: number,
  ) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    document.addEventListener('visibilitychange', this.onVis);
    this.run();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVis);
  }
  kick() {
    clearTimeout(this.timer);
    this.run();
  }
  private onVis = () => {
    if (!document.hidden && !this.stopped) this.kick();
  };
  private run = async () => {
    if (this.stopped) return;
    if (document.hidden) return; // resumes on visibilitychange
    try {
      await this.fn();
      this.fails = 0;
    } catch (e) {
      this.fails++;
      console.warn('[poller]', e);
    }
    if (this.stopped) return;
    const delay = this.interval * Math.min(16, 2 ** this.fails);
    this.timer = window.setTimeout(this.run, delay);
  };
}

export function describeError(e: unknown): { status: 'proxy' | 'offline' | 'error'; detail: string } {
  if (e instanceof ProxyMissingError) return { status: 'proxy', detail: e.message };
  if (e instanceof TypeError) return { status: 'offline', detail: 'network/CORS blocked' };
  return { status: 'error', detail: String((e as Error)?.message ?? e) };
}
