import { describe, expect, it } from 'vitest';
import { subsolar, terminatorRing } from '../../src/core/astro';
import { distKm, R_KM } from '../../src/core/geo';

describe('subsolar point', () => {
  it('is near the equator at the March equinox, at local noon longitude', () => {
    const s = subsolar(Date.parse('2026-03-20T12:00:00Z'));
    expect(Math.abs(s.lat)).toBeLessThan(0.6);
    // equation of time ≈ −7.5 min in late March: the Sun transits Greenwich ~12:07,
    // so at 12:00 UTC the sub-solar point is ~1.9° east
    expect(s.lon).toBeGreaterThan(0.5);
    expect(s.lon).toBeLessThan(3.5);
  });

  it('reaches the tropics at the solstices', () => {
    expect(subsolar(Date.parse('2026-06-21T12:00:00Z')).lat).toBeCloseTo(23.44, 0);
    expect(subsolar(Date.parse('2026-12-21T12:00:00Z')).lat).toBeCloseTo(-23.44, 0);
  });

  it('moves ~15° of longitude west per hour', () => {
    const a = subsolar(Date.parse('2026-08-01T10:00:00Z')).lon;
    const b = subsolar(Date.parse('2026-08-01T11:00:00Z')).lon;
    expect(a - b).toBeCloseTo(15, 0);
  });
});

describe('terminator ring', () => {
  it('is a closed great circle 90° from the subsolar point', () => {
    const t = Date.parse('2026-11-11T06:00:00Z');
    const s = subsolar(t);
    const ring = terminatorRing(t, 72);
    expect(ring).toHaveLength(73);
    const quarter = (Math.PI / 2) * R_KM;
    for (const p of ring) expect(distKm(p.lat, p.lon, s.lat, s.lon)).toBeCloseTo(quarter, -1);
    expect(ring[0].lat).toBeCloseTo(ring[72].lat, 6);
  });

  it('keeps longitudes in [-180, 180]', () => {
    for (const p of terminatorRing(Date.now(), 90)) expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
  });
});
