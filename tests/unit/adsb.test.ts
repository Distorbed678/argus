import { describe, expect, it } from 'vitest';
import { fromAdsb, fromOpenSky, deadReckon } from '../../src/layers/adsb';

const NOW = Date.parse('2026-11-11T00:00:00Z');

describe('fromAdsb (adsb.lol / adsb.fi / airplanes.live v2 records)', () => {
  it('maps the readsb fields', () => {
    const a = fromAdsb({ hex: '4ca1fa', flight: 'RYR12AB ', r: 'EI-ABC', t: 'B738', lat: 53.4, lon: -6.2, alt_baro: 36000, gs: 452.1, track: 87.5, baro_rate: -64, squawk: '2000', category: 'A3', dbFlags: 1, seen_pos: 2.5, nac_p: 9, nic: 8 }, NOW, 'adsb.lol')!;
    expect(a.hex).toBe('4ca1fa');
    expect(a.flight).toBe('RYR12AB');
    expect(a.alt).toBe(36000);
    expect(a.mil).toBe(true);
    expect(a.seen).toBe(NOW - 2500);
    expect(a.nacp).toBe(9);
    expect(a.nic).toBe(8);
    expect(a.src).toBe('adsb.lol');
  });

  it('keeps "ground" altitude and falls back to geometric altitude / true heading', () => {
    expect(fromAdsb({ hex: 'a', lat: 1, lon: 2, alt_baro: 'ground' }, NOW, 'x')!.alt).toBe('ground');
    const b = fromAdsb({ hex: 'b', lat: 1, lon: 2, alt_geom: 1200, true_heading: 270 }, NOW, 'x')!;
    expect(b.alt).toBe(1200);
    expect(b.track).toBe(270);
    expect(b.mil).toBe(false);
  });

  it('drops records without a position', () => {
    expect(fromAdsb({ hex: 'c', alt_baro: 1000 }, NOW, 'x')).toBeNull();
  });
});

describe('fromOpenSky (state vectors)', () => {
  it('converts SI units to ft / kt / fpm', () => {
    // [icao24, callsign, country, time_position, last_contact, lon, lat, baro_alt(m), on_ground, velocity(m/s), true_track, vertical_rate(m/s), sensors, geo_alt, squawk]
    const a = fromOpenSky(['3c6444', 'DLH9U  ', 'Germany', 1794355200, 1794355201, 8.56, 50.03, 1000, false, 100, 90, 5, null, 1050, '1000'], 'OpenSky')!;
    expect(a.flight).toBe('DLH9U');
    expect(a.country).toBe('Germany');
    expect(a.alt).toBeCloseTo(3280.84, 1);
    expect(a.gs).toBeCloseTo(194.384, 2);
    expect(a.baro_rate).toBeCloseTo(984.25, 1);
    expect(a.seen).toBe(1794355200 * 1000);
  });

  it('marks on-ground states and drops states without a position', () => {
    expect(fromOpenSky(['x', '', 'C', 1, 1, 1, 2, null, true, 0, 0, 0, null, null, null], 'o')!.alt).toBe('ground');
    expect(fromOpenSky(['x', '', 'C', 1, 1, null, null, 100, false], 'o')).toBeNull();
  });
});

describe('deadReckon', () => {
  it('advances along the track at ground speed', () => {
    // 600 kt due north for 60 s ≈ 10 NM ≈ 0.1667° of latitude
    const p = deadReckon({ hex: 'a', lat: 10, lon: 20, alt: 30000, gs: 600, track: 0, seen: NOW, src: 'x' }, NOW + 60_000);
    expect(p.lat).toBeCloseTo(10 + 10 / 60, 2);
    expect(p.lon).toBeCloseTo(20, 6);
  });

  it('caps extrapolation at 120 s and never moves grounded or speedless targets', () => {
    const a = { hex: 'a', lat: 0, lon: 0, alt: 1000 as const, gs: 360, track: 90, seen: NOW, src: 'x' };
    expect(deadReckon(a, NOW + 600_000).lon).toBeCloseTo(deadReckon(a, NOW + 120_000).lon, 9);
    expect(deadReckon({ ...a, alt: 'ground' }, NOW + 60_000)).toEqual({ lat: 0, lon: 0 });
    expect(deadReckon({ ...a, gs: undefined }, NOW + 60_000)).toEqual({ lat: 0, lon: 0 });
  });
});
