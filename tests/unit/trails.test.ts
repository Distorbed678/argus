import { describe, expect, it } from 'vitest';
import { TrailStore } from '../../src/spy/trails';

describe('TrailStore', () => {
  it('keeps at most maxPts fixes per target, oldest first', () => {
    const s = new TrailStore(5, 100, 0);
    for (let i = 0; i < 12; i++) s.push('a', i * 0.01, 0, 1000, i + 1);
    const p = s.points('a');
    expect(p).toHaveLength(5);
    expect(p[0].t).toBe(8);
    expect(p[4].t).toBe(12);
  });

  it('ignores stale fixes and collapses stationary ones', () => {
    const s = new TrailStore(10, 100, 0.05);
    s.push('a', 1, 1, 0, 10);
    s.push('a', 1, 1, 0, 5); // older
    s.push('a', 1.0001, 1, 0, 20); // ~11 m: same spot, timestamp refreshed
    expect(s.points('a')).toHaveLength(1);
    expect(s.points('a')[0].t).toBe(20);
  });

  it('evicts the least recently updated targets over the cap (batched)', () => {
    const s = new TrailStore(10, 10, 0); // cap 10, evicts once it exceeds 11
    for (let i = 0; i < 11; i++) s.push(`t${i}`, 0, 0, 0, 1);
    s.push('t0', 1, 0, 0, 2); // t0 is now most recent
    expect(s.size).toBe(11);
    s.push('new', 0, 0, 0, 1); // 12 > 11 → back down to 10
    expect(s.size).toBe(10);
    expect(s.points('t1')).toHaveLength(0);
    expect(s.points('t2')).toHaveLength(0);
    expect(s.points('t0')).toHaveLength(2);
    expect(s.points('new')).toHaveLength(1);
  });

  it('builds densified cartesian positions with a live head', () => {
    const s = new TrailStore(10, 10, 0);
    s.push('a', 0, 0, 0, 1);
    expect(s.positions('a')).toHaveLength(0);
    const pos = s.positions('a', { lat: 0, lon: 1, alt: 0 }); // ~111 km → 25 km steps
    expect(pos.length).toBeGreaterThanOrEqual(5);
  });
});
