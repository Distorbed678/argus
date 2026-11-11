import { Cartesian3, Cartographic, Math as CMath } from 'cesium';

export const fmtLat = (v: number) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v: number) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? 'E' : 'W'}`;
export const fmtLL = (lat: number, lon: number) => `${fmtLat(lat)} ${fmtLon(lon)}`;

export function fmtDist(m: number) {
  if (!Number.isFinite(m)) return '—';
  if (Math.abs(m) >= 1e6) return `${(m / 1000).toFixed(0)} km`;
  if (Math.abs(m) >= 1e4) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

export function ago(t: number | undefined) {
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return `in ${dur(-s)}`;
  if (s < 5) return 'now';
  return `${dur(s)} ago`;
}

export function dur(s: number) {
  s = Math.abs(Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function utc(t: number) {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

const scratch = new Cartographic();
export function toLL(p: Cartesian3) {
  const c = Cartographic.fromCartesian(p, undefined, scratch);
  if (!c) return { lat: 0, lon: 0, h: 0 };
  return { lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude), h: c.height };
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Tiny glyph icons drawn to canvas once and shared by billboard collections. */
const iconCache = new Map<string, HTMLCanvasElement>();
export function icon(kind: 'plane' | 'ship' | 'train' | 'cam' | 'diamond' | 'ring' | 'tri' | 'radio' | 'pin' | 'cross', color: string, size = 24): HTMLCanvasElement {
  const k = `${kind}|${color}|${size}`;
  const hit = iconCache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.scale(size / 24, size / 24);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.shadowColor = color;
  g.shadowBlur = 4;
  g.beginPath();
  switch (kind) {
    case 'plane':
      g.moveTo(0, -11);
      g.lineTo(2, -4);
      g.lineTo(10, 1);
      g.lineTo(10, 3);
      g.lineTo(2, 1);
      g.lineTo(1.5, 7);
      g.lineTo(4, 9.5);
      g.lineTo(4, 11);
      g.lineTo(0, 10);
      g.lineTo(-4, 11);
      g.lineTo(-4, 9.5);
      g.lineTo(-1.5, 7);
      g.lineTo(-2, 1);
      g.lineTo(-10, 3);
      g.lineTo(-10, 1);
      g.lineTo(-2, -4);
      g.closePath();
      g.fill();
      break;
    case 'ship':
      g.moveTo(0, -10);
      g.lineTo(5, 0);
      g.lineTo(4, 9);
      g.lineTo(-4, 9);
      g.lineTo(-5, 0);
      g.closePath();
      g.fill();
      break;
    case 'train':
      g.rect(-6, -9, 12, 16);
      g.fill();
      g.fillStyle = '#000';
      g.fillRect(-4, -6, 8, 4);
      g.fillStyle = color;
      g.fillRect(-7, 8, 3, 2);
      g.fillRect(4, 8, 3, 2);
      break;
    case 'cam':
      g.rect(-9, -5, 13, 10);
      g.fill();
      g.moveTo(4, -2);
      g.lineTo(10, -6);
      g.lineTo(10, 6);
      g.lineTo(4, 2);
      g.fill();
      break;
    case 'diamond':
      g.moveTo(0, -9);
      g.lineTo(9, 0);
      g.lineTo(0, 9);
      g.lineTo(-9, 0);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 2.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'ring':
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 3, 0, Math.PI * 2);
      g.fill();
      break;
    case 'tri':
      g.moveTo(0, -9);
      g.lineTo(9, 8);
      g.lineTo(-9, 8);
      g.closePath();
      g.stroke();
      g.fillRect(-1, -3, 2, 6);
      g.fillRect(-1, 4, 2, 2);
      break;
    case 'radio':
      g.arc(0, 2, 2.5, 0, Math.PI * 2);
      g.fill();
      for (const r of [6, 10]) {
        g.beginPath();
        g.arc(0, 2, r, -Math.PI * 0.8, -Math.PI * 0.2);
        g.stroke();
      }
      break;
    case 'pin':
      g.arc(0, -3, 6, 0, Math.PI * 2);
      g.fill();
      g.moveTo(-4, 1);
      g.lineTo(0, 10);
      g.lineTo(4, 1);
      g.fill();
      break;
    case 'cross':
      g.moveTo(-8, 0);
      g.lineTo(8, 0);
      g.moveTo(0, -8);
      g.lineTo(0, 8);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 5, 0, Math.PI * 2);
      g.stroke();
      break;
  }
  iconCache.set(k, c);
  return c;
}

export function ecefFromDeg(lon: number, lat: number, h = 0) {
  return Cartesian3.fromDegrees(lon, lat, h);
}

export const DEG = CMath.RADIANS_PER_DEGREE;
