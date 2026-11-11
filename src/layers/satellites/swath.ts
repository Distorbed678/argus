// Typical imaging swath widths by satellite class. Published instrument figures, rounded; real
// swaths depend on mode, pointing and altitude, so everything here is labelled approximate.
import type { SatCat } from './categories';

const TABLE: [RegExp, number, string][] = [
  [/WORLDVIEW|GEOEYE|LEGION/, 14, 'VHR optical'],
  [/SKYSAT|BLACKSKY/, 6, 'VHR optical smallsat'],
  [/PLEIADES/, 20, 'VHR optical'],
  [/FLOCK|DOVE|PLANETSCOPE|SUPERDOVE/, 25, 'PlanetScope optical'],
  [/LANDSAT/, 185, 'OLI/TIRS'],
  [/SENTINEL-2/, 290, 'MSI'],
  [/SENTINEL-1/, 250, 'C-SAR IW mode'],
  [/SENTINEL-3/, 1270, 'OLCI'],
  [/SENTINEL-5P/, 2600, 'TROPOMI'],
  [/^(TERRA|AQUA)$/, 2330, 'MODIS'],
  [/SUOMI|NOAA 2\d|NOAA-2\d|JPSS/, 3000, 'VIIRS'],
  [/^NOAA \d{2}$|METOP|DMSP/, 2900, 'AVHRR-class imager'],
  [/FENGYUN 3|FY-3|METEOR-M/, 2800, 'polar weather imager'],
  [/ICEYE/, 30, 'X-band SAR stripmap'],
  [/CAPELLA|UMBRA/, 10, 'X-band SAR spotlight/strip'],
  [/RADARSAT/, 350, 'C-band SAR ScanSAR'],
  [/COSMO-SKYMED|CSG/, 40, 'X-band SAR stripmap'],
  [/SAR-LUPE|SARAH/, 8, 'X-band SAR (reported)'],
  [/KOMPSAT|ARIRANG/, 15, 'optical'],
  [/CARTOSAT/, 10, 'optical'],
  [/SPOT/, 60, 'optical'],
  [/GAOFEN/, 60, 'optical (varies by unit)'],
  [/JILIN|SUPERVIEW/, 12, 'VHR optical'],
  [/YAOGAN/, 40, 'reported optical/SAR class'],
  [/^USA \d/, 20, 'classified · generic estimate'],
];

/** Geostationary / high-orbit weather imagers see a full disk: no strip. */
const FULL_DISK = /GOES|HIMAWARI|METEOSAT|ELEKTRO|FENGYUN 4|FY-4|INSAT-3D|GEO-KOMPSAT|GK-2A/;

export interface Swath {
  km: number;
  label: string;
}

export function swathFor(name: string, cat: SatCat): Swath | null {
  const n = name.toUpperCase();
  if (FULL_DISK.test(n)) return null;
  for (const [re, km, label] of TABLE) if (re.test(n)) return { km, label };
  if (cat === 'earthobs') return { km: 100, label: 'earth-obs · generic estimate' };
  if (cat === 'military') return { km: 30, label: 'military · generic estimate' };
  return null;
}
