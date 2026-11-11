import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../../src/layers/satellites/omm';

const CSV = `OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT
ISS (ZARYA),1998-067A,2026-11-10T12:00:00.000000,15.50103472,.0006703,51.6416,247.4627,130.536,325.0288,0,U,25544,999,47000,.00016717,.0001027,0
BROKEN ROW,1,2
NOAA 19,2009-005A,2026-11-10T06:00:00.000000,14.12501077,.0013484,99.1925,111.2,98.1,262.1,0,U,33591,999,91000,.000099,.0000005,0
`;

describe('parseCsv (CelesTrak GP CSV → OMM)', () => {
  it('parses rows, typing numeric columns and keeping string columns', () => {
    const r = parseCsv(CSV) as any[];
    expect(r).toHaveLength(2);
    expect(r[0].OBJECT_NAME).toBe('ISS (ZARYA)');
    expect(r[0].OBJECT_ID).toBe('1998-067A');
    expect(r[0].EPOCH).toBe('2026-11-10T12:00:00.000000');
    expect(r[0].CLASSIFICATION_TYPE).toBe('U');
    expect(r[0].NORAD_CAT_ID).toBe(25544);
    expect(r[0].MEAN_MOTION).toBeCloseTo(15.50103472, 8);
    expect(r[0].ECCENTRICITY).toBeCloseTo(0.0006703, 9);
  });

  it('skips rows whose column count does not match the header', () => {
    expect((parseCsv(CSV) as any[]).map((o) => o.NORAD_CAT_ID)).toEqual([25544, 33591]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv(CSV.replace(/\n/g, '\r\n'))).toHaveLength(2);
  });

  it('parses the bundled snapshot catalog', () => {
    const r = parseCsv(readFileSync('public/data/gp-active.csv', 'utf8')) as any[];
    expect(r.length).toBeGreaterThan(5000);
    expect(r.every((o) => Number.isInteger(o.NORAD_CAT_ID) && Number.isFinite(o.MEAN_MOTION))).toBe(true);
  });
});
