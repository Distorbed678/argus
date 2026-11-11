import { describe, expect, it } from 'vitest';
import { estimateDecay, semiMajorKm, uncertaintyDays } from '../../src/layers/sky/decay';
import { NavGrid, cellOf, level, WINDOW_MS } from '../../src/layers/intel/gpsjamGrid';

describe('re-entry estimate', () => {
  it('semi-major axis from mean motion', () => {
    // ISS ~15.5 rev/day ≈ 6,795 km
    expect(semiMajorKm(15.5)).toBeCloseTo(6795, -1);
  });

  it('decaying orbit → finite positive estimate after the epoch', () => {
    const e = estimateDecay({ MEAN_MOTION: 15.96, MEAN_MOTION_DOT: 0.00237, ECCENTRICITY: 0.0004, EPOCH: '2026-11-10T00:00:00' })!;
    expect(e.perigeeKm).toBeGreaterThan(250);
    expect(e.perigeeKm).toBeLessThan(320);
    expect(e.dhdt).toBeLessThan(0);
    expect(e.days).toBeGreaterThan(5);
    expect(e.days).toBeLessThan(120);
    expect(e.at).toBeGreaterThan(Date.parse('2026-11-10T00:00:00Z'));
  });

  it('faster decay → sooner re-entry; no decay → no estimate', () => {
    const slow = estimateDecay({ MEAN_MOTION: 16, MEAN_MOTION_DOT: 0.001, ECCENTRICITY: 0, EPOCH: '2026-11-10T00:00:00Z' })!;
    const fast = estimateDecay({ MEAN_MOTION: 16, MEAN_MOTION_DOT: 0.01, ECCENTRICITY: 0, EPOCH: '2026-11-10T00:00:00Z' })!;
    expect(fast.days).toBeLessThan(slow.days);
    expect(estimateDecay({ MEAN_MOTION: 15, MEAN_MOTION_DOT: 0, ECCENTRICITY: 0, EPOCH: '2026-11-10T00:00:00Z' })).toBeNull();
    expect(uncertaintyDays(10)).toBeGreaterThan(uncertaintyDays(1));
  });
});

describe('GPS-interference grid', () => {
  it('bins into 1° cells and bands by degraded share', () => {
    expect(cellOf(51.5, -0.1)).toBe('51,-1');
    expect(level(0.01)).toBe('low');
    expect(level(0.05)).toBe('medium');
    expect(level(0.2)).toBe('high');
  });

  it('counts distinct aircraft, needs ≥3 to report, prunes old reports', () => {
    const g = new NavGrid();
    const t = 1_000_000;
    g.add('a', 54.2, 18.6, 3, 0, t); // degraded
    g.add('b', 54.3, 18.1, 10, 8, t);
    expect(g.stats()).toHaveLength(0);
    g.add('c', 54.9, 18.9, 11, 8, t);
    g.add('c', 54.8, 18.8, 11, 8, t + 1000); // same aircraft again
    const [s] = g.stats();
    expect(s.total).toBe(3);
    expect(s.bad).toBe(1);
    expect(s.level).toBe('high');
    g.prune(t + WINDOW_MS + 5000);
    expect(g.cellCount).toBe(0);
  });
});
