import { describe, expect, it } from 'vitest';
import {
  distKm,
  bearingDeg,
  destination,
  pointInPolygon,
  pointInCircle,
  inShape,
  polygonAreaKm2,
  circleAreaKm2,
  circleRing,
  densify,
  shapeCenter,
  shapeRadiusKm,
  measure,
  compass16,
  fmtKm,
  type LatLon,
} from '../../src/core/geo';

describe('great-circle distance / bearing (measure maths)', () => {
  it('matches known city-pair distances', () => {
    // London Heathrow → New York JFK ≈ 5,540 km
    expect(distKm(51.47, -0.4543, 40.6413, -73.7781)).toBeCloseTo(5540, -1);
    // one degree of latitude ≈ 111.2 km
    expect(distKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
    expect(distKm(10, 10, 10, 10)).toBe(0);
  });

  it('gives initial bearings', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 6);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 6);
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 6);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 6);
    // LHR → JFK leaves heading west-north-west
    expect(bearingDeg(51.47, -0.4543, 40.6413, -73.7781)).toBeCloseTo(288, 0);
  });

  it('destination() inverts distance + bearing', () => {
    const p = destination(48.85, 2.35, 135, 500);
    expect(distKm(48.85, 2.35, p.lat, p.lon)).toBeCloseTo(500, 6);
    expect(bearingDeg(48.85, 2.35, p.lat, p.lon)).toBeCloseTo(135, 6);
  });

  it('measure() sums segments, closes polygons and computes area', () => {
    const sq: LatLon[] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    const open = measure(sq, false);
    expect(open.segments).toHaveLength(3);
    expect(open.areaKm2).toBeNull();
    const closed = measure(sq, true);
    expect(closed.segments).toHaveLength(4);
    expect(closed.totalKm).toBeCloseTo(4 * 111.19, -1);
    // 1°×1° at the equator ≈ 12,364 km²
    expect(closed.areaKm2!).toBeCloseTo(12364, -2);
  });

  it('formats', () => {
    expect(compass16(0)).toBe('N');
    expect(compass16(292.5)).toBe('WNW');
    expect(compass16(-90)).toBe('W');
    expect(fmtKm(0.25)).toBe('250 m');
    expect(fmtKm(12.34)).toBe('12.3 km');
  });
});

describe('AOI containment', () => {
  const box: LatLon[] = [
    [10, 10],
    [10, 20],
    [20, 20],
    [20, 10],
  ];

  it('point-in-polygon, open or closed ring', () => {
    expect(pointInPolygon(15, 15, box)).toBe(true);
    expect(pointInPolygon(25, 15, box)).toBe(false);
    expect(pointInPolygon(15, 15, [...box, box[0]])).toBe(true);
    expect(pointInPolygon(15, 15, box.slice(0, 2))).toBe(false);
  });

  it('handles concave polygons', () => {
    const u: LatLon[] = [
      [0, 0],
      [0, 3],
      [3, 3],
      [3, 2],
      [1, 2],
      [1, 1],
      [3, 1],
      [3, 0],
    ];
    expect(pointInPolygon(0.5, 1.5, u)).toBe(true);
    expect(pointInPolygon(2, 1.5, u)).toBe(false); // inside the notch
  });

  it('handles polygons crossing the antimeridian', () => {
    const fiji: LatLon[] = [
      [-20, 175],
      [-20, -175],
      [-15, -175],
      [-15, 175],
    ];
    expect(pointInPolygon(-17, 179.5, fiji)).toBe(true);
    expect(pointInPolygon(-17, -179.5, fiji)).toBe(true);
    expect(pointInPolygon(-17, 170, fiji)).toBe(false);
    expect(pointInPolygon(-17, -170, fiji)).toBe(false);
  });

  it('circle containment is geodesic', () => {
    const c = { lat: 60, lon: 0, km: 100 };
    expect(pointInCircle(60.8, 0, c)).toBe(true); // ~89 km north
    expect(pointInCircle(60, 1.9, c)).toBe(false); // ~106 km east at 60°N
    expect(inShape(60, 1.7, { kind: 'circle', ...c })).toBe(true); // ~95 km
    expect(inShape(15, 15, { kind: 'poly', pts: box })).toBe(true);
  });

  it('shape centre / radius / area', () => {
    const c = shapeCenter({ kind: 'poly', pts: box });
    expect(c.lat).toBeCloseTo(15, 0);
    expect(c.lon).toBeCloseTo(15, 6);
    expect(shapeRadiusKm({ kind: 'circle', lat: 0, lon: 0, km: 42 })).toBe(42);
    // small circle area ≈ πr²
    expect(circleAreaKm2(10)).toBeCloseTo(Math.PI * 100, 0);
    expect(polygonAreaKm2(circleRing(0, 0, 100, 360))).toBeCloseTo(Math.PI * 100 * 100, -2);
  });
});

describe('densify', () => {
  it('splits long edges along the great circle', () => {
    const d = densify(
      [
        [0, 0],
        [0, 10],
      ],
      100,
    );
    expect(d.length).toBeGreaterThan(10);
    expect(d[0]).toEqual([0, 0]);
    expect(d[d.length - 1]).toEqual([0, 10]);
    for (const p of d) expect(p[0]).toBeCloseTo(0, 9);
  });
});
