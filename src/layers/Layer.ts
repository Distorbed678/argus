import type { Cartesian3, Viewer } from 'cesium';
import type { LogLevel } from '../core/bus';
import type { Settings } from '../core/store';

export type LayerStatus = 'off' | 'loading' | 'live' | 'cached' | 'offline' | 'key' | 'proxy' | 'error' | 'standby';
export type Category = 'SPACE' | 'AIR' | 'SEA/LAND' | 'WEATHER' | 'HAZARDS' | 'INTEL' | 'SIGNALS' | 'HUMAN';

export interface DossierAction {
  label: string;
  run: () => void;
}

export interface Dossier {
  layer: string;
  key: string;
  kind: string; // e.g. SATELLITE, AIRCRAFT
  title: string;
  subtitle?: string;
  classification?: string;
  fields: [string, string][];
  /** Called ~1/s while the dossier is open to refresh telemetry. */
  live?: () => [string, string][] | undefined;
  position?: () => Cartesian3 | undefined;
  actions?: DossierAction[];
  extra?: HTMLElement;
  onClose?: () => void;
  /** Preferred camera range when locking on (meters). */
  range?: number;
}

export interface LayerCtx {
  viewer: Viewer;
  id: string;
  status(s: LayerStatus, detail?: string, count?: number): void;
  log(msg: string, level?: LogLevel, pos?: { lon: number; lat: number }): void;
  requestRender(): void;
}

export interface LayerInstance {
  enable(): Promise<void> | void;
  disable(): void;
  pick?(key: string): Dossier | undefined | Promise<Dossier | undefined>;
  /** Command-line search: return a dossier if this layer owns a matching object. */
  find?(q: string): Dossier | undefined | Promise<Dossier | undefined>;
}

export type LayerFactory = (ctx: LayerCtx) => LayerInstance;

export interface LayerMeta {
  id: string;
  name: string;
  category: Category;
  source: string;
  needsKey?: keyof Settings['keys'];
  keyOptional?: boolean;
  note?: string;
  load: () => Promise<{ default: LayerFactory }>;
}

/** Pick id attached to every primitive so the global picker can route clicks. */
export interface PickId {
  layer: string;
  key: string;
}
export const pid = (layer: string, key: string): PickId => ({ layer, key });
