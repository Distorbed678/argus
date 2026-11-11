// Pure spherical-earth geometry (no Cesium): AOI tests, measure tool, revisit, worker.
// Points are always { lat, lon } in degrees; polygons are [lat, lon][] rings (open or closed).

export const R_KM = 6371.0088; // mean earth radius
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type LatLon = [number, number];

export type Shape =
  | { kind: 'circle'; lat: number; lon: number; km: number }
  | { kind: 'poly'; pts: LatLon[] };

export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Great-circle distance (haversine), km. */
export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from point 1 to point 2, degrees clockwise from true north [0, 360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached travelling `km` from (lat, lon) on initial bearing `brg` (degrees). */
export function destination(lat: number, lon: number, brg: number, km: number): { lat: number; lon: number } {
  const d = km / R_KM;
  const p1 = lat * D2R;
  const b = brg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lon * D2R + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: wrapLon(l2 * R2D) };
}

/** Ring of n+1 points (closed) approximating a geodesic circle. */
export function circleRing(lat: number, lon: number, km: number, n = 72): LatLon[] {
  const out: LatLon[] = [];
  for (let k = 0; k <= n; k++) {
    const p = destination(lat, lon, (k / n) * 360, km);
    out.push([p.lat, p.lon]);
  }
  return out;
}

/** Sum of great-circle segment lengths, km. */
export function pathKm(pts: LatLon[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distKm(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return s;
}

/** Unwrap longitudes so consecutive vertices never jump across the antimeridian. */
function unwrap(pts: LatLon[]): LatLon[] {
  const out: LatLon[] = [];
  let prev = pts[0]?.[1] ?? 0;
  for (const [la, lo] of pts) {
    let l = lo;
    while (l - prev > 180) l -= 360;
    while (l - prev < -180) l += 360;
    out.push([la, l]);
    prev = l;
  }
  return out;
}

const isClosed = (p: LatLon[]) => p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];

/**
 * Point-in-polygon (even-odd ray casting in lon/lat space). Handles polygons that cross the
 * antimeridian as long as they span < 180° of longitude.
 */
export function pointInPolygon(lat: number, lon: number, poly: LatLon[]): boolean {
  if (poly.length < 3) return false;
  const ring = unwrap(isClosed(poly) ? poly.slice(0, -1) : poly);
  // bring the test longitude into the ring's unwrapped range
  const mid = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  let x = lon;
  while (x - mid > 180) x -= 360;
  while (x - mid < -180) x += 360;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInCircle(lat: number, lon: number, c: { lat: number; lon: number; km: number }): boolean {
  return distKm(lat, lon, c.lat, c.lon) <= c.km;
}

export function inShape(lat: number, lon: number, s: Shape): boolean {
  return s.kind === 'circle' ? pointInCircle(lat, lon, s) : pointInPolygon(lat, lon, s.pts);
}

/**
 * Geodesic polygon area on the sphere, km² (the line-integral formula used by Turf / GeographicLib's
 * spherical approximation). Exact for great-circle-edged polygons on a sphere to well under 1 %.
 */
export function polygonAreaKm2(poly: LatLon[]): number {
  const ring = unwrap(isClosed(poly) ? poly.slice(0, -1) : poly);
  const n = ring.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [la1, lo1] = ring[i];
    const [la2, lo2] = ring[(i + 1) % n];
    s += (lo2 - lo1) * D2R * (2 + Math.sin(la1 * D2R) + Math.sin(la2 * D2R));
  }
  return Math.abs((s * R_KM * R_KM) / 2);
}

export function circleAreaKm2(km: number): number {
  // spherical cap area: 2πR²(1 − cos(d/R))
  return 2 * Math.PI * R_KM * R_KM * (1 - Math.cos(km / R_KM));
}

/** Centre point (vertex mean on the unit sphere) and bounding radius of a shape. */
export function shapeCenter(s: Shape): { lat: number; lon: number } {
  if (s.kind === 'circle') return { lat: s.lat, lon: s.lon };
  const ring = isClosed(s.pts) ? s.pts.slice(0, -1) : s.pts;
  let x = 0,
    y = 0,
    z = 0;
  for (const [la, lo] of ring) {
    x += Math.cos(la * D2R) * Math.cos(lo * D2R);
    y += Math.cos(la * D2R) * Math.sin(lo * D2R);
    z += Math.sin(la * D2R);
  }
  return { lat: Math.atan2(z, Math.hypot(x, y)) * R2D, lon: Math.atan2(y, x) * R2D };
}

export function shapeRadiusKm(s: Shape): number {
  if (s.kind === 'circle') return s.km;
  const c = shapeCenter(s);
  return s.pts.reduce((m, p) => Math.max(m, distKm(c.lat, c.lon, p[0], p[1])), 0);
}

export function shapeAreaKm2(s: Shape): number {
  return s.kind === 'circle' ? circleAreaKm2(s.km) : polygonAreaKm2(s.pts);
}

/** Outline ring for drawing. */
export function shapeRing(s: Shape): LatLon[] {
  if (s.kind === 'circle') return circleRing(s.lat, s.lon, s.km);
  const r = s.pts.slice();
  if (!isClosed(r)) r.push(r[0]);
  return r;
}

export const compass16 = (deg: number) =>
  ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export function fmtArea(km2: number): string {
  if (km2 >= 1e5) return `${Math.round(km2).toLocaleString()} km²`;
  if (km2 >= 1) return `${km2.toFixed(km2 >= 100 ? 0 : 1)} km²`;
  return `${Math.round(km2 * 1e6).toLocaleString()} m²`;
}

export function fmtKm(km: number): string {
  if (km >= 1000) return `${Math.round(km).toLocaleString()} km`;
  if (km >= 10) return `${km.toFixed(1)} km`;
  if (km >= 1) return `${km.toFixed(2)} km`;
  return `${Math.round(km * 1000)} m`;
}
