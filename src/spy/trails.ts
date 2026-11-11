// Recent tracks for aircraft / ships, accumulated client-side from each poll (the public trace
// files of adsb.lol / adsb.fi are bot-protected, so they can't be relayed). Memory is capped
// both per target and in the number of targets (least recently updated are evicted).
import { Cartesian3, Color, Material, PolylineCollection, type Polyline, type Viewer } from 'cesium';
import { bus } from '../core/bus';
import { distKm, interpolateGC } from '../core/geo';

export class TrailStore {
  /** flat [lat, lon, altM, t, …] per key, oldest first */
  private m = new Map<string, number[]>();
  private slack: number;
  constructor(
    private maxPts = 60,
    private maxTargets = 5000,
    private minMoveKm = 0.05,
  ) {
    this.slack = Math.max(1, Math.round(maxTargets * 0.1));
  }

  push(key: string, lat: number, lon: number, alt: number, t: number) {
    let a = this.m.get(key);
    if (a) {
      const n = a.length;
      if (t <= a[n - 1]) return; // same / older fix
      if (distKm(a[n - 4], a[n - 3], lat, lon) < this.minMoveKm) {
        a[n - 1] = t; // stationary: just refresh the timestamp
        return;
      }
      this.m.delete(key); // re-insert = most recently used
    } else a = [];
    a.push(lat, lon, alt, t);
    if (a.length > this.maxPts * 4) a.splice(0, a.length - this.maxPts * 4);
    this.m.set(key, a);
    // evict the least recently updated in batches: deleting one-at-a-time from the front of a Map
    // leaves holes that every later keys().next() has to walk over
    if (this.m.size > this.maxTargets + this.slack) {
      let n = this.m.size - this.maxTargets;
      for (const k of this.m.keys()) {
        this.m.delete(k);
        if (--n <= 0) break;
      }
    }
  }

  points(key: string): { lat: number; lon: number; alt: number; t: number }[] {
    const a = this.m.get(key) ?? [];
    const out = [];
    for (let i = 0; i < a.length; i += 4) out.push({ lat: a[i], lon: a[i + 1], alt: a[i + 2], t: a[i + 3] });
    return out;
  }

  delete(key: string) {
    this.m.delete(key);
  }
  clear() {
    this.m.clear();
  }
  get size() {
    return this.m.size;
  }

  /** Cartesian positions for drawing, densified along great circles, with an optional live head. */
  positions(key: string, head?: { lat: number; lon: number; alt: number }): Cartesian3[] {
    const pts = this.points(key);
    if (head) pts.push({ ...head, t: 0 });
    if (pts.length < 2) return [];
    const out: Cartesian3[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.min(100, Math.ceil(distKm(a.lat, a.lon, b.lat, b.lon) / 25)));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const f = k / n;
        const [la, lo] = interpolateGC([a.lat, a.lon], [b.lat, b.lon], f);
        out.push(Cartesian3.fromDegrees(lo, la, a.alt + (b.alt - a.alt) * f));
      }
    }
    return out;
  }
}

let line: Polyline | undefined;
let timer: number | undefined;

export function initTrails(viewer: Viewer) {
  const coll = viewer.scene.primitives.add(new PolylineCollection());
  line = coll.add({ width: 3, show: false, material: Material.fromType('PolylineGlow', { color: Color.fromCssColorString('#ffb347').withAlpha(0.9), glowPower: 0.2 }) });
  bus.on('select', (d) => {
    clearInterval(timer);
    if (!line) return;
    if (!d?.trail) {
      line.show = false;
      viewer.scene.requestRender();
      return;
    }
    const paint = () => {
      const pos = d.trail?.() ?? [];
      line!.show = pos.length >= 2;
      if (pos.length >= 2) line!.positions = pos;
      viewer.scene.requestRender();
    };
    paint();
    timer = window.setInterval(paint, 2000);
  });
}
