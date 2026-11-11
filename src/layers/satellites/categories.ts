export type SatCat = 'stations' | 'starlink' | 'comms' | 'gnss' | 'earthobs' | 'military' | 'other' | 'debris';

export const SAT_CATS: { id: SatCat; label: string; color: string }[] = [
  { id: 'stations', label: 'Crewed / stations', color: '#ffffff' },
  { id: 'starlink', label: 'Starlink', color: '#3fa9ff' },
  { id: 'comms', label: 'Comms constellations', color: '#00e5ff' },
  { id: 'gnss', label: 'Navigation (GPS/GNSS)', color: '#7cffb2' },
  { id: 'earthobs', label: 'Earth obs / weather', color: '#ffd166' },
  { id: 'military', label: 'Military / recon', color: '#ff3b5c' },
  { id: 'other', label: 'Other active', color: '#8aa4c8' },
  { id: 'debris', label: 'Debris fields', color: '#6b7d99' },
];
export const CAT_INDEX: Record<SatCat, number> = Object.fromEntries(SAT_CATS.map((c, i) => [c.id, i])) as any;

const R = {
  stations: /^(ISS|ZARYA|CSS|TIANHE|TIANGONG|WENTIAN|MENGTIAN)\b|CREW DRAGON|DRAGON|SOYUZ|PROGRESS|SHENZHOU|TIANZHOU|STARLINER|CYGNUS|HTV/,
  starlink: /^STARLINK/,
  comms: /ONEWEB|IRIDIUM|GLOBALSTAR|ORBCOMM|INTELSAT|\bSES\b|EUTELSAT|VIASAT|KUIPER|QIANFAN|G60|TELESAT|INMARSAT|ASTRA|ECHOSTAR|DIRECTV|SIRIUS|XM-|THURAYA|O3B|HISPASAT|ARABSAT|TURKSAT|YAMAL|EXPRESS|LUCH|TDRS|SPACEWAY|AST SPACEMOBILE|BLUEBIRD|LYNK|SWARM|HONGYAN|GUOWANG|HULIANWANG/,
  gnss: /NAVSTAR|\bGPS\b|GLONASS|GALILEO|GSAT0|BEIDOU|\bQZS|IRNSS|NAVIC/,
  earthobs: /NOAA|GOES|METEOSAT|METEOR|FENGYUN|FY-|HIMAWARI|METOP|DMSP|SENTINEL|LANDSAT|TERRA|AQUA|SUOMI|JPSS|WORLDVIEW|FLOCK|SKYSAT|LEMUR|SPIRE|PLEIADES|ICEYE|CAPELLA|UMBRA|JILIN|GAOFEN|SUPERVIEW|KOMPSAT|RADARSAT|CARTOSAT|RESURS|KANOPUS|ELEKTRO|INSAT|GCOM|GPM|CALIPSO|CLOUDSAT|SMAP|ICESAT|GRACE|SWOT|TROPICS|PLANETSCOPE|DOVE|BLACKSKY|SATELLOGIC|NUSAT/,
  military: /^USA \d|NROL|YAOGAN|OFEQ|SBIRS|\bWGS\b|MUOS|AEHF|MILSTAR|\bDSP\b|GSSAP|SAR-LUPE|SARAH|\bCSO\b|HELIOS|\bIGS\b|COSMOS|KOSMOS|SHIJIAN|TJS|TONGXIN JISHU|LACROSSE|MERIDIAN|LOTOS|PION|BARS-M|PERSONA|KONDOR|SKYNET|SICRAL|SYRACUSE|XTAR|COSMO-SKYMED|ZUBAIR|GHOSTS?|SILENTBARKER|STPSAT|ORS-/,
};

export function categorize(name: string, militaryIds: Set<number>, norad: number): SatCat {
  const n = name.toUpperCase();
  if (R.stations.test(n)) return 'stations';
  // fragments and rocket bodies first, so "FENGYUN 1C DEB" isn't filed as a weather satellite
  if (/\bDEB\b|R\/B|DEBRIS/.test(n)) return 'debris';
  if (R.starlink.test(n)) return 'starlink';
  if (militaryIds.has(norad) || R.military.test(n)) return 'military';
  if (R.gnss.test(n)) return 'gnss';
  if (R.comms.test(n)) return 'comms';
  if (R.earthobs.test(n)) return 'earthobs';
  return 'other';
}
