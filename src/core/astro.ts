import { JulianDate, Simon1994PlanetaryPositions, Cartesian3 } from 'cesium';
import { sunPos, jday, gstime } from 'satellite.js';

const R2D = 180 / Math.PI;
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

export function subsolar(t: number) {
  const d = new Date(t);
  const s = sunPos(jday(d));
  const g = gstime(d);
  return { lat: s.decl * R2D, lon: wrap((s.rtasc - g) * R2D) };
}

export function sublunar(t: number) {
  const d = new Date(t);
  const m = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(JulianDate.fromDate(d), new Cartesian3());
  const r = Cartesian3.magnitude(m);
  const ra = Math.atan2(m.y, m.x);
  const dec = Math.asin(m.z / r);
  const g = gstime(d);
  return { lat: dec * R2D, lon: wrap((ra - g) * R2D), distKm: r / 1000 };
}

/** Points along the terminator great circle (90° from the subsolar point). */
export function terminatorRing(t: number, n = 180) {
  const s = subsolar(t);
  const la = s.lat / R2D;
  const lo = s.lon / R2D;
  const pts: { lat: number; lon: number }[] = [];
  const lam = Math.PI / 2;
  for (let k = 0; k <= n; k++) {
    const b = (k / n) * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(la) * Math.cos(lam) + Math.cos(la) * Math.sin(lam) * Math.cos(b));
    const lon2 = lo + Math.atan2(Math.sin(b) * Math.sin(lam) * Math.cos(la), Math.cos(lam) - Math.sin(la) * Math.sin(lat2));
    pts.push({ lat: lat2 * R2D, lon: wrap(lon2 * R2D) });
  }
  return pts;
}

export { sunPos, jday };
