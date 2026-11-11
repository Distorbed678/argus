// Shared satellite engine: one catalog, one worker, one PointPrimitiveCollection.
// Category layers (stations, starlink, …) just toggle visibility on it.
import {
  Cartesian2,
  Cartesian3,
  Color,
  LabelCollection,
  LabelStyle,
  NearFarScalar,
  PointPrimitiveCollection,
  PolylineCollection,
  Material,
  VerticalOrigin,
  BlendOption,
  Primitive,
  GeometryInstance,
  CylinderGeometry,
  CorridorGeometry,
  PerInstanceColorAppearance,
  ColorGeometryInstanceAttribute,
  Transforms,
  Matrix4,
  type PointPrimitive,
  type Label,
  type Polyline,
  type Viewer,
} from 'cesium';
import { json2satrec, propagate, gstime, eciToEcf, eciToGeodetic, type SatRec, type OMMJsonObject } from 'satellite.js';
import { getData, describeError } from '../../data/fetcher';
import { simNow, getRate } from '../../core/clock';
import { fmtDist, fmtLat, fmtLon, utc, ago, dur } from '../../core/fmt';
import { log } from '../../core/bus';
import { locate, getObserverSync } from '../../core/observer';
import { lock, startPov, select } from '../../core/target';
import { registerFinder, registerPicker } from '../manager';
import type { Dossier } from '../Layer';
import { categorize, SAT_CATS, CAT_INDEX, type SatCat } from './categories';
import { pid } from '../Layer';
import { parseCsv } from './omm';
import { swathFor, type Swath } from './swath';
import type { Shape } from '../../core/geo';
import type { RevisitPass } from './sat.worker';

export interface SatMeta {
  name: string;
  norad: number;
  intl: string;
  cat: SatCat;
  omm: OMMJsonObject;
}

const RE = 6371.0;
const MU = 398600.4418;
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
const TTL = 2 * 3600_000; // CelesTrak asks for ≤ 1 fetch / 2h per group
const DEBRIS_GROUPS = ['cosmos-1408-debris', 'fengyun-1c-debris', 'iridium-33-debris', 'cosmos-2251-debris'];

// one shared distance scaler for every point (was one object per satellite)
const SCALE = new NearFarScalar(1e6, 2.2, 4e7, 0.8);

type Listener = (cat: SatCat, count: number) => void;

class SatEngine {
  viewer!: Viewer;
  meta: SatMeta[] = [];
  private points!: PointPrimitiveCollection;
  private prims: PointPrimitive[] = [];
  private labels!: LabelCollection;
  private labelMap = new Map<number, Label>();
  private lines!: PolylineCollection;
  private orbitLine?: Polyline;
  private trackLine?: Polyline;
  private footLine?: Polyline;
  private worker!: Worker;
  private busy = false;
  private lastTick = 0;
  private lastSimTick = 0;
  private tickId = 0;
  private pos: Float32Array | null = null;
  private visible = new Set<SatCat>();
  /** per-satellite visibility (1 = propagate & draw); mirrored to the worker so hidden categories cost nothing */
  private mask = new Uint8Array(0);
  /** raw CSV texts sent to the worker (a string clones far cheaper than 17k objects) */
  private csvParts: string[] = [];
  private loading: Promise<void> | null = null;
  private debrisLoaded = false;
  private selIdx = -1;
  private selRec: SatRec | null = null;
  private orbitAt = 0;
  private reqId = 0;
  private gen = 0;
  private pending = new Map<number, (v: any) => void>();
  private listeners = new Set<Listener>();
  private colors = SAT_CATS.map((c) => Color.fromCssColorString(c.color));
  private catCounts = new Map<SatCat, number>();
  private lastStatusErr: string | null = null;
  /** sensor view cone (unit cone scaled per frame) + approximate swath strip for the selection */
  private cone?: Primitive;
  private strip?: Primitive;
  private selSwath: Swath | null = null;
  private coneAt = 0;

  onCount(fn: Listener) {
    this.listeners.add(fn);
  }

  async init(viewer: Viewer): Promise<void> {
    if (this.loading) return this.loading;
    this.viewer = viewer;
    this.loading = (async () => {
      this.points = viewer.scene.primitives.add(new PointPrimitiveCollection({ blendOption: BlendOption.OPAQUE }));
      this.labels = viewer.scene.primitives.add(new LabelCollection());
      this.lines = viewer.scene.primitives.add(new PolylineCollection());
      this.worker = new Worker(new URL('./sat.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev) => this.onWorker(ev.data);
      viewer.scene.preUpdate.addEventListener(() => this.frame());
      viewer.scene.preUpdate.addEventListener(() => this.updateCone());
      registerPicker('sat', (k) => this.dossier(Number(k)));
      registerFinder('sat', (q) => this.find(q));

      const [active, mil] = await Promise.all([
        getData<string>(`${CELESTRAK}?GROUP=active&FORMAT=csv`, { ttl: TTL, persist: true, as: 'text', cacheKey: 'celestrak:active', timeout: 60000 }).catch(async (e) => {
          // CelesTrak answers 403 when the same client re-downloads within 2 h; fall back to the bundled snapshot
          log('CELESTRAK', `live catalog refused (${(e as Error).message}) — using bundled snapshot`, 'warn');
          return { ...(await getData<string>('./data/gp-active.csv', { as: 'text', ttl: TTL })), fromCache: true };
        }),
        getData<string>(`${CELESTRAK}?GROUP=military&FORMAT=csv`, { ttl: TTL, persist: true, as: 'text', cacheKey: 'celestrak:military' }).catch(() => null),
      ]);
      const milIds = new Set<number>(mil ? parseCsv(mil.data).map((o: any) => o.NORAD_CAT_ID) : []);
      const omms = parseCsv(active.data);
      this.meta = omms.map((o: any) => ({
        name: o.OBJECT_NAME,
        norad: o.NORAD_CAT_ID,
        intl: o.OBJECT_ID,
        omm: o,
        cat: categorize(o.OBJECT_NAME, milIds, o.NORAD_CAT_ID),
      }));
      const newest = this.meta.reduce((m, x) => Math.max(m, Date.parse((x.omm as any).EPOCH + 'Z') || 0), 0);
      log('CELESTRAK', `${this.meta.length.toLocaleString()} orbital elements ${active.fromCache ? 'restored from cache' : 'downlinked'} · newest epoch ${ago(newest)}`, 'ok');
      this.buildPrims(0);
      this.csvParts = [active.data];
      this.worker.postMessage({ type: 'load', csv: this.csvParts });
      this.syncMask();
      this.statusAll(active.fromCache ? 'cached' : 'live');
    })().catch((e) => {
      this.loading = null;
      const d = describeError(e);
      this.lastStatusErr = d.detail;
      throw e;
    });
    return this.loading;
  }

  private statusAll(_s: string) {
    this.catCounts.clear();
    for (const m of this.meta) this.catCounts.set(m.cat, (this.catCounts.get(m.cat) ?? 0) + 1);
    for (const c of SAT_CATS) this.listeners.forEach((fn) => fn(c.id, this.catCounts.get(c.id) ?? 0));
  }

  private buildPrims(from: number) {
    for (let i = from; i < this.meta.length; i++) {
      const m = this.meta[i];
      const big = m.cat === 'stations' || m.cat === 'military';
      const p = this.points.add({
        position: Cartesian3.ZERO,
        pixelSize: big ? 5 : 2.5,
        color: this.colors[CAT_INDEX[m.cat]],
        outlineWidth: 0,
        scaleByDistance: SCALE,
        show: false,
        id: pid('sat', String(i)),
      });
      this.prims[i] = p;
      if (m.cat === 'stations' && /^(ISS \(ZARYA\)|CSS \(TIANHE\))/.test(m.name)) {
        const l = this.labels.add({
          position: Cartesian3.ZERO,
          text: m.name.startsWith('ISS') ? 'ISS' : 'TIANGONG',
          font: '12px "Share Tech Mono", monospace',
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString('#003a66'),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(8, -8),
          verticalOrigin: VerticalOrigin.BOTTOM,
          show: false,
        });
        this.labelMap.set(i, l);
      }
    }
  }

  async setVisible(cat: SatCat, on: boolean) {
    if (on) this.visible.add(cat);
    else this.visible.delete(cat);
    if (cat === 'debris' && on && !this.debrisLoaded) await this.loadDebris();
    this.applyVisibility();
    this.lastTick = 0;
  }

  private async loadDebris() {
    this.debrisLoaded = true;
    const res = await Promise.all(
      DEBRIS_GROUPS.map((g) =>
        getData<string>(`${CELESTRAK}?GROUP=${g}&FORMAT=csv`, { ttl: TTL * 6, persist: true, as: 'text', cacheKey: `celestrak:${g}` }).catch(() => null),
      ),
    );
    const from = this.meta.length;
    for (const r of res) {
      if (!r) continue;
      for (const o of parseCsv(r.data) as any[]) this.meta.push({ name: o.OBJECT_NAME, norad: o.NORAD_CAT_ID, intl: o.OBJECT_ID, omm: o, cat: 'debris' });
      this.csvParts.push(r.data);
    }
    this.buildPrims(from);
    this.worker.postMessage({ type: 'load', csv: this.csvParts });
    this.syncMask();
    this.pos = null;
    this.statusAll('live');
    log('CELESTRAK', `${(this.meta.length - from).toLocaleString()} debris fragments tracked`, 'warn');
  }

  private syncMask() {
    const m = new Uint8Array(this.meta.length);
    for (let i = 0; i < m.length; i++) m[i] = this.visible.has(this.meta[i].cat) ? 1 : 0;
    this.mask = m;
    this.worker?.postMessage({ type: 'vis', mask: m.slice() });
  }

  private applyVisibility() {
    this.syncMask();
    for (let i = 0; i < this.meta.length; i++) {
      const vis = this.mask[i] === 1;
      const p = this.prims[i];
      if (!p) continue;
      p.show = vis && !!this.pos && i * 3 < this.pos.length && !Number.isNaN(this.pos[i * 3]);
      const l = this.labelMap.get(i);
      if (l) l.show = p.show;
    }
    this.viewer.scene.requestRender();
  }

  private frame() {
    if (!this.meta.length || !this.visible.size || this.busy || document.hidden) return;
    const now = performance.now();
    const rate = Math.abs(getRate());
    const interval = rate > 10 ? 150 : 1000;
    const t = simNow();
    if (now - this.lastTick < interval && Math.abs(t - this.lastSimTick) < 60_000) return;
    this.lastTick = now;
    this.lastSimTick = t;
    this.busy = true;
    this.worker.postMessage({ type: 'tick', t, id: ++this.tickId });
  }

  private onWorker(m: any) {
    if (m.type === 'pos') {
      this.busy = false;
      const buf: Float32Array = m.buf;
      const first = !this.pos;
      this.pos = buf;
      const scratch = new Cartesian3();
      const n = Math.min(this.prims.length, buf.length / 3);
      for (let i = 0; i < n; i++) {
        const p = this.prims[i];
        const x = buf[i * 3];
        const vis = this.mask[i] === 1 && !Number.isNaN(x);
        if (vis) {
          scratch.x = x;
          scratch.y = buf[i * 3 + 1];
          scratch.z = buf[i * 3 + 2];
          p.position = scratch;
        }
        if (p.show !== vis) p.show = vis;
        const l = this.labelMap.get(i);
        if (l) {
          l.show = vis;
          if (vis) l.position = scratch;
        }
      }
      if (first) this.applyVisibility();
      if (this.selIdx >= 0 && Math.abs(m.t - this.orbitAt) > 30_000) this.drawOrbit();
      this.viewer.scene.requestRender();
    } else if (m.type === 'loaded') {
      log('SGP4', `propagator armed: ${m.ok.toLocaleString()}/${m.n.toLocaleString()} orbits solved`, 'ok');
      this.lastTick = 0;
    } else if (m.type === 'passes' || m.type === 'overhead' || m.type === 'aoiSats' || m.type === 'revisit') {
      this.pending.get(m.reqId)?.(m.type === 'passes' ? m.passes : m.list);
      this.pending.delete(m.reqId);
    }
  }

  private ask<T>(msg: any): Promise<T> {
    const reqId = ++this.reqId;
    return new Promise((res) => {
      this.pending.set(reqId, res);
      this.worker.postMessage({ ...msg, reqId });
    });
  }

  passes(idx: number, lat: number, lon: number, h = 0, hours = 48) {
    return this.ask<{ aos: number; los: number; maxEl: number; maxAt: number }[]>({ type: 'passes', idx, lat, lon, h, t: simNow(), hours });
  }

  overhead(lat: number, lon: number, h = 0, minEl = 10) {
    return this.ask<{ idx: number; az: number; el: number; range: number; alt: number }[]>({ type: 'overhead', lat, lon, h, t: simNow(), minEl });
  }

  /** Catalog indices of the given categories (e.g. earth-obs + military for AOI watch / revisit). */
  indicesOf(cats: SatCat[]): Int32Array {
    const out: number[] = [];
    for (let i = 0; i < this.meta.length; i++) if (cats.includes(this.meta[i].cat)) out.push(i);
    return Int32Array.from(out);
  }

  /** Satellites whose sub-point is inside each shape at time t (worker). */
  aoiSats(idxs: Int32Array, shapes: Shape[], t = simNow()) {
    return this.ask<{ aoi: number; idx: number; lat: number; lon: number; alt: number }[]>({ type: 'aoiSats', idxs, shapes, t });
  }

  /** Next passes of the given satellites over one point (worker, chunked). */
  revisit(idxs: Int32Array, lat: number, lon: number, hours = 24, minEl = 30, t = simNow()) {
    return this.ask<RevisitPass[]>({ type: 'revisit', idxs, lat, lon, hours, minEl, t });
  }

  get ready() {
    return this.meta.length > 0 && !!this.worker;
  }

  /** Precise position for one sat (main thread) – used for lock/POV/dossier. */
  state(idx: number, t = simNow()) {
    const rec = idx === this.selIdx && this.selRec ? this.selRec : json2satrec(this.meta[idx].omm);
    const d = new Date(t);
    const pv = propagate(rec, d);
    if (!pv || typeof pv.position === 'boolean' || !pv.position) return null;
    const g = gstime(d);
    const ecf = eciToEcf(pv.position, g);
    const vel = pv.velocity as { x: number; y: number; z: number };
    // ECEF velocity (approx; ignore earth-rotation term for orientation use)
    const vecf = eciToEcf(vel, g);
    const geo = eciToGeodetic(pv.position, g);
    return {
      pos: new Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000),
      vel: new Cartesian3(vecf.x, vecf.y, vecf.z),
      speed: Math.hypot(vel.x, vel.y, vel.z),
      lat: (geo.latitude * 180) / Math.PI,
      lon: (geo.longitude * 180) / Math.PI,
      alt: geo.height,
      eci: pv.position,
      gmst: g,
    };
  }

  private drawOrbit() {
    const idx = this.selIdx;
    if (idx < 0) return;
    const m = this.meta[idx];
    const color = this.colors[CAT_INDEX[m.cat]];
    const t0 = simNow();
    this.orbitAt = t0;
    const periodMin = 1440 / (m.omm as any).MEAN_MOTION;
    const rec = this.selRec!;
    const g0 = gstime(new Date(t0));
    const ring: Cartesian3[] = [];
    const track: Cartesian3[] = [];
    const steps = 180;
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (k / steps) * periodMin * 60_000;
      const d = new Date(t);
      const pv = propagate(rec, d);
      if (!pv || typeof pv.position === 'boolean' || !pv.position) continue;
      const e = eciToEcf(pv.position, g0); // inertial ring frozen at "now"
      ring.push(new Cartesian3(e.x * 1000, e.y * 1000, e.z * 1000));
      const geo = eciToGeodetic(pv.position, gstime(d));
      track.push(Cartesian3.fromRadians(geo.longitude, geo.latitude, 2000));
    }
    if (!this.orbitLine) {
      this.orbitLine = this.lines.add({ width: 1.5 });
      this.trackLine = this.lines.add({ width: 1 });
      this.footLine = this.lines.add({ width: 1.5 });
    }
    this.orbitLine.positions = ring;
    this.orbitLine.material = Material.fromType('PolylineGlow', { color: color.withAlpha(0.9), glowPower: 0.25 });
    this.orbitLine.width = 4;
    this.trackLine!.positions = track;
    this.trackLine!.material = Material.fromType('PolylineDash', { color: color.withAlpha(0.55), dashLength: 12 });
    this.orbitLine.show = this.trackLine!.show = true;
    this.drawStrip(track);
    this.viewer.scene.requestRender();
  }

  private drawFootprint(lat: number, lon: number, altKm: number) {
    if (!this.footLine) return;
    const lam = Math.acos(RE / (RE + altKm)); // horizon half-angle (rad)
    const pts: Cartesian3[] = [];
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    for (let k = 0; k <= 72; k++) {
      const b = (k / 72) * Math.PI * 2;
      const lat2 = Math.asin(Math.sin(la) * Math.cos(lam) + Math.cos(la) * Math.sin(lam) * Math.cos(b));
      const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(lam) * Math.cos(la), Math.cos(lam) - Math.sin(la) * Math.sin(lat2));
      pts.push(Cartesian3.fromRadians(lon2, lat2, 1000));
    }
    this.footLine.positions = pts;
    this.footLine.material = Material.fromType('Color', { color: Color.fromCssColorString('#4fc3ff').withAlpha(0.6) });
    this.footLine.show = true;
  }

  private updateCone() {
    if (!this.cone) return;
    const t = simNow();
    if (this.selIdx < 0 || !this.selSwath) {
      if (this.cone.show) this.cone.show = false;
      return;
    }
    if (t === this.coneAt) return;
    this.coneAt = t;
    const s = this.state(this.selIdx, t);
    if (!s || s.alt > 3000) {
      this.cone.show = false;
      return;
    }
    const alt = s.alt * 1000;
    const r = Math.min(this.selSwath.km / 2, Math.acos(RE / (RE + s.alt)) * RE) * 1000;
    const m = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(s.lon, s.lat, 0), undefined, new Matrix4());
    Matrix4.multiplyByTranslation(m, new Cartesian3(0, 0, alt / 2), m);
    Matrix4.multiplyByScale(m, new Cartesian3(r, r, alt), m);
    this.cone.modelMatrix = m;
    this.cone.show = true;
  }

  private ensureCone() {
    if (this.cone) return;
    // apex (radius 0) at +z = the satellite, unit base at -z = the ground; scaled by modelMatrix
    this.cone = this.viewer.scene.primitives.add(
      new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new CylinderGeometry({ length: 1, topRadius: 0, bottomRadius: 1, slices: 40, vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#9be7ff').withAlpha(0.22)) },
        }),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false,
        show: false,
      }),
    ) as Primitive;
  }

  /** Approximate imaging strip: next half orbit of ground track, buffered by the class swath. */
  private drawStrip(track: Cartesian3[]) {
    if (this.strip) {
      this.viewer.scene.primitives.remove(this.strip);
      this.strip = undefined;
    }
    const sw = this.selSwath;
    if (!sw || track.length < 4) return;
    const half = track.slice(0, Math.ceil(track.length / 2));
    try {
      this.strip = this.viewer.scene.primitives.add(
        new Primitive({
          geometryInstances: new GeometryInstance({
            geometry: new CorridorGeometry({ positions: half, width: sw.km * 1000, height: 1500, vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }),
            attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#ffd166').withAlpha(0.16)) },
          }),
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: true,
        }),
      ) as Primitive;
    } catch (e) {
      console.warn('[sat] swath strip', e);
    }
  }

  private clearSel() {
    this.selSwath = null;
    if (this.strip) {
      this.viewer.scene.primitives.remove(this.strip);
      this.strip = undefined;
    }
    if (this.cone) this.cone.show = false;
    this.selIdx = -1;
    this.selRec = null;
    if (this.orbitLine) this.orbitLine.show = this.trackLine!.show = this.footLine!.show = false;
    // restore the highlighted point to its category's normal size (stations/military are larger)
    for (let i = 0; i < this.prims.length; i++) {
      const p = this.prims[i];
      if (p && p.pixelSize > 6) p.pixelSize = this.meta[i].cat === 'stations' || this.meta[i].cat === 'military' ? 5 : 2.5;
    }
    this.viewer.scene.requestRender();
  }

  dossier(idx: number): Dossier | undefined {
    const m = this.meta[idx];
    if (!m) return;
    this.clearSel();
    const gen = ++this.gen;
    this.selIdx = idx;
    this.selRec = json2satrec(m.omm);
    this.prims[idx].pixelSize = 9;
    this.selSwath = swathFor(m.name, m.cat);
    if (this.selSwath) this.ensureCone();
    this.coneAt = 0;
    this.drawOrbit();
    const o = m.omm as any;
    const n = (o.MEAN_MOTION * 2 * Math.PI) / 86400;
    const a = Math.cbrt(MU / (n * n));
    const apo = a * (1 + o.ECCENTRICITY) - RE;
    const peri = a * (1 - o.ECCENTRICITY) - RE;
    const period = 1440 / o.MEAN_MOTION;
    const regime = peri > 30000 ? 'GEO' : apo > 30000 ? 'HEO / Molniya' : peri > 2000 ? 'MEO' : 'LEO';
    const catLabel = SAT_CATS[CAT_INDEX[m.cat]].label;
    let nextPass = 'computing…';
    const extra = document.createElement('div');
    extra.className = 'passes';
    const obs = getObserverSync();
    this.passes(idx, obs.lat, obs.lon, obs.h, 48).then((ps) => {
      nextPass = ps.length ? `${ago(ps[0].aos)} · max ${ps[0].maxEl.toFixed(0)}°` : 'none in 48h';
      extra.innerHTML =
        `<div class="sub">PASSES OVER ${obs.source === 'gps' ? 'YOUR POSITION' : 'CAMERA NADIR'} (48H)</div>` +
        (ps.length
          ? `<table>${ps
              .slice(0, 6)
              .map((p) => `<tr><td>${utc(p.aos).slice(5, 16)}</td><td>${dur((p.los - p.aos) / 1000)}</td><td>${p.maxEl.toFixed(0)}°</td></tr>`)
              .join('')}</table>`
          : '<div class="dim">no visible passes ≥5°</div>');
    });
    const self = this;
    return {
      layer: 'sat',
      key: String(idx),
      ref: String(m.norad),
      kind: 'SATELLITE',
      title: m.name,
      subtitle: `${catLabel} · ${regime}`,
      classification: m.cat === 'military' ? 'TOP SECRET // NOFORN (PUBLIC TLE)' : 'UNCLASSIFIED // OSINT',
      fields: [
        ['NORAD ID', String(m.norad)],
        ['INTL DESIG', m.intl],
        ['EPOCH', `${o.EPOCH.replace('T', ' ').slice(0, 19)}Z`],
        ['INCLINATION', `${o.INCLINATION.toFixed(2)}°`],
        ['PERIOD', `${period.toFixed(1)} min`],
        ['APOGEE / PERIGEE', `${apo.toFixed(0)} / ${peri.toFixed(0)} km`],
        ['ECCENTRICITY', o.ECCENTRICITY.toFixed(5)],
        ...((this.selSwath ? [['IMAGING SWATH', `≈ ${this.selSwath.km.toLocaleString()} km · ${this.selSwath.label} (approx.)`]] : []) as [string, string][]),
      ],
      live() {
        const s = self.state(idx);
        if (!s) return [['STATUS', 'DECAYED / NO SOLUTION']];
        self.drawFootprint(s.lat, s.lon, s.alt);
        return [
          ['SUB-POINT', `${fmtLat(s.lat)} ${fmtLon(s.lon)}`],
          ['ALTITUDE', `${s.alt.toFixed(1)} km`],
          ['VELOCITY', `${s.speed.toFixed(3)} km/s`],
          ['FOOTPRINT R', fmtDist(Math.acos(RE / (RE + s.alt)) * RE * 1000)],
          ['NEXT PASS', nextPass],
        ];
      },
      position: () => self.state(idx)?.pos,
      range: 2.5e6,
      extra,
      actions: [
        { label: 'LOCK', run: () => lock() },
        { label: 'POV', run: () => self.pov(idx) },
        {
          label: 'MY PASSES',
          run: async () => {
            await locate();
            const d = self.dossier(idx);
            if (d) select(d);
          },
        },
        { label: 'N2YO ↗', run: () => window.open(`https://www.n2yo.com/satellite/?s=${m.norad}`, '_blank', 'noopener') },
      ],
      onClose: () => {
        if (self.gen === gen) self.clearSel();
      },
    };
  }

  pov(idx: number) {
    startPov(() => {
      const s = this.state(idx);
      if (!s) return null;
      const down = Cartesian3.negate(Cartesian3.normalize(s.pos, new Cartesian3()), new Cartesian3());
      const fwd = Cartesian3.normalize(s.vel, new Cartesian3());
      // tilt forward 25° so the horizon shows a bit
      const dir = Cartesian3.normalize(
        Cartesian3.add(Cartesian3.multiplyByScalar(down, Math.cos(0.45), new Cartesian3()), Cartesian3.multiplyByScalar(fwd, Math.sin(0.45), new Cartesian3()), new Cartesian3()),
        new Cartesian3(),
      );
      const right = Cartesian3.cross(dir, fwd, new Cartesian3());
      const up = Cartesian3.normalize(Cartesian3.cross(right, dir, new Cartesian3()), new Cartesian3());
      return { pos: s.pos, dir, up };
    });
    log('POV', `optical feed slaved to ${this.meta[idx].name}`, 'ok');
  }

  /** Side-effect-free lookup (no selection / orbit drawing). */
  findIndex(q: string): number {
    if (!this.meta.length) return -1;
    const s = q.trim().toUpperCase();
    const num = Number(s);
    let idx = -1;
    if (Number.isInteger(num) && num > 0) idx = this.meta.findIndex((m) => m.norad === num);
    if (idx < 0 && (s === 'ISS' || s === 'SPACE STATION')) idx = this.meta.findIndex((m) => m.name.startsWith('ISS (ZARYA)'));
    if (idx < 0 && (s === 'TIANGONG' || s === 'CSS')) idx = this.meta.findIndex((m) => m.name.startsWith('CSS (TIANHE)'));
    if (idx < 0) idx = this.meta.findIndex((m) => m.name === s);
    if (idx < 0) idx = this.meta.findIndex((m) => m.name.startsWith(s));
    if (idx < 0) idx = this.meta.findIndex((m) => m.name.includes(s));
    return idx;
  }

  find(q: string): Dossier | undefined {
    const idx = this.findIndex(q);
    if (idx < 0) return;
    // make sure its category is visible
    if (!this.visible.has(this.meta[idx].cat)) void this.setVisible(this.meta[idx].cat, true);
    return this.dossier(idx);
  }

  get error() {
    return this.lastStatusErr;
  }
}

export const satEngine = new SatEngine();
