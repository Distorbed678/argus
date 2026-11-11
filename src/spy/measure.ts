// Measure tool: click points for great-circle distances, initial bearings, total path length and
// (closed) polygon area. Esc or CLEAR wipes it; EXIT leaves the tool.
import {
  Cartesian2,
  Cartesian3,
  Color,
  LabelCollection,
  LabelStyle,
  Material,
  PolylineCollection,
  VerticalOrigin,
  type Polyline,
  type Viewer,
} from 'cesium';
import { setTool, clearTool, activeTool, toolbar, type GlobeTool } from '../core/tools';
import { distKm, bearingDeg, densify, interpolateGC, pathKm, polygonAreaKm2, fmtKm, fmtArea, compass16, type LatLon } from '../core/geo';
import { esc } from '../core/fmt';

let viewer: Viewer;
let lines: PolylineCollection | undefined;
let labels: LabelCollection | undefined;

const CYAN = Color.fromCssColorString('#9be7ff');

export interface MeasureResult {
  segments: { km: number; brg: number }[];
  totalKm: number;
  areaKm2: number | null;
}

/** Pure: everything the readout shows for a list of points. */
export function measure(pts: LatLon[], closed: boolean): MeasureResult {
  const segments = [];
  for (let i = 1; i < pts.length; i++) segments.push({ km: distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]), brg: bearingDeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) });
  if (closed && pts.length >= 3) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    segments.push({ km: distKm(a[0], a[1], b[0], b[1]), brg: bearingDeg(a[0], a[1], b[0], b[1]) });
  }
  return { segments, totalKm: pathKm(closed && pts.length >= 3 ? [...pts, pts[0]] : pts), areaKm2: closed && pts.length >= 3 ? polygonAreaKm2(pts) : null };
}

export function initMeasure(v: Viewer) {
  viewer = v;
}

function ensure() {
  if (lines) return;
  lines = viewer.scene.primitives.add(new PolylineCollection());
  labels = viewer.scene.primitives.add(new LabelCollection());
}

export function isMeasuring() {
  return activeTool()?.id === 'measure';
}

export function startMeasure() {
  if (isMeasuring()) return;
  ensure();
  const pts: LatLon[] = [];
  let closed = false;
  let hover: LatLon | null = null;
  let path: Polyline | undefined;
  let rubber: Polyline | undefined;
  let raf = 0;

  const wipe = () => {
    lines!.removeAll();
    labels!.removeAll();
    path = rubber = undefined;
    viewer.scene.requestRender();
  };

  const draw = () => {
    wipe();
    const ring = closed && pts.length >= 3 ? [...pts, pts[0]] : pts;
    if (ring.length >= 2) path = lines!.add({ positions: densify(ring, 25).map(([la, lo]) => Cartesian3.fromDegrees(lo, la, 200)), width: 3, material: Material.fromType('Color', { color: CYAN }) });
    if (hover && pts.length && !closed) rubber = lines!.add({ positions: densify([pts[pts.length - 1], hover], 25).map(([la, lo]) => Cartesian3.fromDegrees(lo, la, 200)), width: 2, material: Material.fromType('PolylineDash', { color: CYAN, dashLength: 10 }) });
    const r = measure(pts, closed);
    r.segments.forEach((s, i) => {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const [la, lo] = interpolateGC(a, b, 0.5);
      labels!.add({
        position: Cartesian3.fromDegrees(lo, la, 400),
        text: `${fmtKm(s.km)} · ${s.brg.toFixed(0)}°`,
        font: '12px "Share Tech Mono", monospace',
        fillColor: CYAN,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -4),
        disableDepthTestDistance: 5e6,
      });
    });
    pts.forEach(([la, lo], i) =>
      labels!.add({
        position: Cartesian3.fromDegrees(lo, la, 400),
        text: i === 0 ? '◉' : '●',
        font: '12px sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: 5e6,
      }),
    );
    readout(r);
    void path;
    void rubber;
    viewer.scene.requestRender();
  };

  const readout = (r: MeasureResult) => {
    if (!pts.length) return tb.set('Click points on the globe. <b>Esc</b> clears.');
    const live = hover && pts.length && !closed ? { km: distKm(pts[pts.length - 1][0], pts[pts.length - 1][1], hover[0], hover[1]), brg: bearingDeg(pts[pts.length - 1][0], pts[pts.length - 1][1], hover[0], hover[1]) } : null;
    tb.set(`
      <table>${r.segments
        .map((s, i) => `<tr><td>${i + 1}</td><td>${esc(fmtKm(s.km))}</td><td>${s.brg.toFixed(1)}° ${compass16(s.brg)}</td></tr>`)
        .join('')}${live ? `<tr class="dim"><td>→</td><td>${esc(fmtKm(live.km))}</td><td>${live.brg.toFixed(1)}° ${compass16(live.brg)}</td></tr>` : ''}</table>
      <div>TOTAL <b>${esc(fmtKm(r.totalKm))}</b> · ${pts.length} pts${r.areaKm2 != null ? ` · AREA <b>${esc(fmtArea(r.areaKm2))}</b>` : pts.length >= 3 ? ' · CLOSE for area' : ''}</div>`);
  };

  const tb = toolbar('MEASURE · GREAT CIRCLE', [
    { label: 'UNDO', run: () => (pts.pop(), (closed = closed && pts.length >= 3), draw()) },
    { label: 'CLOSE', run: () => ((closed = !closed), draw()) },
    { label: 'CLEAR', run: () => ((pts.length = 0), (closed = false), draw()) },
    { label: 'EXIT', cls: 'danger', run: () => (clearTool(tool), tool.cancel()) },
  ]);

  const tool: GlobeTool = {
    id: 'measure',
    click(lat, lon) {
      if (closed) {
        pts.length = 0;
        closed = false;
      }
      pts.push([lat, lon]);
      draw();
    },
    move(lat, lon) {
      hover = [lat, lon];
      if (!pts.length || closed || raf) return;
      // at most one rebuild per frame while the rubber band follows the pointer
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    },
    dblclick() {
      if (pts.length >= 3) {
        pts.pop(); // the double-click's second click added a duplicate
        closed = true;
        draw();
      }
    },
    cancel() {
      wipe();
      tb.close();
      document.getElementById('btn-measure')?.classList.remove('on');
    },
  };
  setTool(tool);
  document.getElementById('btn-measure')?.classList.add('on');
  draw();
}

export function toggleMeasure() {
  const t = activeTool();
  if (t?.id === 'measure') {
    clearTool(t);
    t.cancel();
  } else startMeasure();
}
