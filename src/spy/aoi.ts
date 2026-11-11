// Watch areas (AOIs): persisted circles/polygons drawn on the globe, with draw tools.
import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPrimitive,
  LabelCollection,
  LabelStyle,
  Material,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  VerticalOrigin,
  type Polyline,
  type Viewer,
} from 'cesium';
import { bus, log } from '../core/bus';
import { release } from '../core/target';
import { setTool, clearTool, toolbar, type GlobeTool } from '../core/tools';
import { shapeRing, shapeCenter, shapeRadiusKm, shapeAreaKm2, distKm, circleRing, fmtKm, fmtArea, type Shape, type LatLon } from '../core/geo';

export interface Aoi {
  id: string;
  name: string;
  shape: Shape;
  created: number;
}

const KEY = 'argus.aoi.v1';
const AMBER = Color.fromCssColorString('#ffb347');
// a Polyline destroys its material when removed, so each line gets its own (only a handful exist)
const outline = () => Material.fromType('Color', { color: AMBER.withAlpha(0.9) });
const dashed = () => Material.fromType('PolylineDash', { color: AMBER, dashLength: 10 });
const FILL = ColorGeometryInstanceAttribute.fromColor(AMBER.withAlpha(0.1));
const LIFT = 300; // m above the ellipsoid so outlines don't z-fight imagery

let viewer: Viewer;
let list: Aoi[] = load();
let lines: PolylineCollection;
let labels: LabelCollection;
let fills: GroundPrimitive[] = [];
let preview: Polyline | undefined;

function load(): Aoi[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((a) => a?.shape && a.name) : [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export const aois = () => list;

const toCart = (ring: LatLon[], h = LIFT) => ring.map(([la, lo]) => Cartesian3.fromDegrees(lo, la, h));

function render() {
  if (!viewer) return;
  lines.removeAll();
  labels.removeAll();
  for (const f of fills) viewer.scene.primitives.remove(f);
  fills = [];
  for (const a of list) {
    const ring = shapeRing(a.shape);
    lines.add({ positions: toCart(ring), width: 2, material: outline() });
    const c = shapeCenter(a.shape);
    labels.add({
      position: Cartesian3.fromDegrees(c.lon, c.lat, LIFT),
      text: `◇ ${a.name}`,
      font: '12px "Share Tech Mono", monospace',
      fillColor: AMBER,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -4),
      disableDepthTestDistance: 5e6,
    });
    try {
      const fill = new GroundPrimitive({
        geometryInstances: new GeometryInstance({
          geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(toCart(ring.slice(0, -1), 0)) }),
          attributes: { color: FILL },
        }),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: true,
      });
      viewer.scene.primitives.add(fill);
      fills.push(fill);
    } catch (e) {
      console.warn('[aoi] fill', e);
    }
  }
  viewer.scene.requestRender();
}

export function initAoi(v: Viewer) {
  viewer = v;
  lines = v.scene.primitives.add(new PolylineCollection());
  labels = v.scene.primitives.add(new LabelCollection());
  render();
}

function changed() {
  save();
  render();
  bus.emit('aoi', undefined);
}

export function addAoi(name: string, shape: Shape): Aoi {
  const base = name.trim() || `AOI-${list.length + 1}`;
  let n = base;
  for (let i = 2; list.some((a) => a.name.toLowerCase() === n.toLowerCase()); i++) n = `${base}-${i}`;
  const a: Aoi = { id: Math.random().toString(36).slice(2, 10), name: n.slice(0, 40), shape, created: Date.now() };
  list = [...list, a];
  log('AOI', `watch area ${a.name} armed · ${describeShape(shape)}`, 'ok', shapeCenter(shape));
  changed();
  return a;
}

export function renameAoi(id: string, name: string) {
  const n = name.trim().slice(0, 40);
  if (!n) return;
  list = list.map((a) => (a.id === id ? { ...a, name: n } : a));
  changed();
}

export function removeAoi(id: string) {
  const a = list.find((x) => x.id === id);
  list = list.filter((x) => x.id !== id);
  changed();
  if (a) log('AOI', `watch area ${a.name} disarmed`, 'info');
}

export function findAoi(q: string): Aoi | undefined {
  const s = q.trim().toLowerCase();
  return list.find((a) => a.id === s || a.name.toLowerCase() === s) ?? list.find((a) => a.name.toLowerCase().startsWith(s));
}

export function describeShape(s: Shape) {
  return s.kind === 'circle' ? `circle r=${fmtKm(s.km)} · ${fmtArea(shapeAreaKm2(s))}` : `polygon ${s.pts.length} pts · ${fmtArea(shapeAreaKm2(s))}`;
}

export function flyToAoi(a: Aoi) {
  release();
  const c = shapeCenter(a.shape);
  const r = shapeRadiusKm(a.shape);
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(c.lon, c.lat, Math.max(20, Math.min(2e4, r * 3.2)) * 1000), duration: 2 });
}

// ---------- draw tools ----------

function setPreview(ring: LatLon[] | null) {
  if (!ring || ring.length < 2) {
    if (preview) preview.show = false;
    viewer.scene.requestRender();
    return;
  }
  // the collection is rebuilt on render(); re-add if it was wiped
  if (!preview || !lines.contains(preview)) preview = lines.add({ width: 2, material: dashed() });
  preview.positions = toCart(ring);
  preview.show = true;
  viewer.scene.requestRender();
}

export function drawCircle(onDone?: (a: Aoi) => void) {
  let center: { lat: number; lon: number } | null = null;
  let km = 0;
  const tb = toolbar('DRAW CIRCLE AOI', [{ label: 'CANCEL', cls: 'danger', run: () => (clearTool(tool), tool.cancel()) }]);
  tb.set('Click the <b>centre</b> of the watch area.');
  const tool: GlobeTool = {
    id: 'aoi-circle',
    click(lat, lon) {
      if (!center) {
        center = { lat, lon };
        tb.set('Now click the <b>edge</b> to set the radius.');
        return;
      }
      km = Math.max(0.2, distKm(center.lat, center.lon, lat, lon));
      clearTool(tool);
      setPreview(null);
      tb.close();
      const a = addAoi('', { kind: 'circle', lat: center.lat, lon: center.lon, km: +km.toFixed(2) });
      onDone?.(a);
    },
    move(lat, lon) {
      if (!center) return;
      km = distKm(center.lat, center.lon, lat, lon);
      setPreview(circleRing(center.lat, center.lon, km, 60));
      tb.set(`radius <b>${fmtKm(km)}</b> — click to confirm`);
    },
    cancel() {
      setPreview(null);
      tb.close();
    },
  };
  setTool(tool);
}

export function drawPolygon(onDone?: (a: Aoi) => void) {
  const pts: LatLon[] = [];
  const finish = () => {
    if (pts.length < 3) return void tb.set('Need at least <b>3</b> vertices.');
    clearTool(tool);
    setPreview(null);
    tb.close();
    const a = addAoi('', { kind: 'poly', pts: pts.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)] as LatLon) });
    onDone?.(a);
  };
  const tb = toolbar('DRAW POLYGON AOI', [
    { label: 'UNDO', run: () => (pts.pop(), redraw()) },
    { label: 'FINISH', run: finish },
    { label: 'CANCEL', cls: 'danger', run: () => (clearTool(tool), tool.cancel()) },
  ]);
  const redraw = (hover?: LatLon) => {
    const ring = hover ? [...pts, hover] : pts.slice();
    if (ring.length >= 3) ring.push(ring[0]);
    setPreview(ring);
    tb.set(pts.length ? `<b>${pts.length}</b> vertices — double-click or FINISH to close` : 'Click to place vertices.');
  };
  redraw();
  let lastClick = 0;
  const tool: GlobeTool = {
    id: 'aoi-poly',
    click(lat, lon) {
      const now = performance.now();
      // the second click of a double-click is handled by dblclick
      if (now - lastClick < 250 && pts.length) return;
      lastClick = now;
      pts.push([lat, lon]);
      redraw();
    },
    move(lat, lon) {
      if (pts.length) redraw([lat, lon]);
    },
    dblclick: finish,
    cancel() {
      setPreview(null);
      tb.close();
    },
  };
  setTool(tool);
}
