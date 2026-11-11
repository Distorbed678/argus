import { describe, expect, it } from 'vitest';
import { categorize, CAT_INDEX, SAT_CATS } from '../../src/layers/satellites/categories';
import { swathFor } from '../../src/layers/satellites/swath';

const none = new Set<number>();

describe('satellite categorisation', () => {
  it.each([
    ['ISS (ZARYA)', 'stations'],
    ['CSS (TIANHE)', 'stations'],
    ['STARLINK-1234', 'starlink'],
    ['ONEWEB-0012', 'comms'],
    ['IRIDIUM 180', 'comms'],
    ['GPS BIIF-2 (PRN 01)', 'gnss'],
    ['NAVSTAR 78 (USA 319)', 'gnss'], // GPS stays navigation; only names starting "USA n" are military
    ['GALILEO 25 (PRN E21)', 'gnss'],
    ['BEIDOU-3 M1', 'gnss'],
    ['LANDSAT 9', 'earthobs'],
    ['SENTINEL-2A', 'earthobs'],
    ['NOAA 19', 'earthobs'],
    ['USA 224', 'military'],
    ['YAOGAN-30 01', 'military'],
    ['COSMOS 2558', 'military'],
    ['FENGYUN 1C DEB', 'debris'],
    ['SL-16 R/B', 'debris'],
    ['TIANQI-1', 'other'],
  ])('%s → %s', (name, cat) => {
    expect(categorize(name, none, 1)).toBe(cat);
  });

  it('puts anything in the CelesTrak military group into military', () => {
    expect(categorize('SOME BUS 3', new Set([424242]), 424242)).toBe('military');
  });

  it('is case-insensitive', () => {
    expect(categorize('starlink-1', none, 1)).toBe('starlink');
  });

  it('has an index entry for every category', () => {
    for (const c of SAT_CATS) expect(SAT_CATS[CAT_INDEX[c.id]].id).toBe(c.id);
  });
});

describe('imaging swath table', () => {
  it('knows common instruments and labels generic estimates', () => {
    expect(swathFor('LANDSAT 9', 'earthobs')?.km).toBe(185);
    expect(swathFor('SENTINEL-2B', 'earthobs')?.km).toBe(290);
    expect(swathFor('SOME CUBESAT', 'earthobs')?.label).toMatch(/estimate/);
    expect(swathFor('USA 245', 'military')?.label).toMatch(/estimate/);
  });

  it('has no strip for full-disk geostationary imagers or non-imaging classes', () => {
    expect(swathFor('GOES 18', 'earthobs')).toBeNull();
    expect(swathFor('STARLINK-1', 'starlink')).toBeNull();
  });
});
