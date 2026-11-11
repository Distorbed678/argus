#!/usr/bin/env node
// Snapshots datasets whose hosts don't allow browser CORS (or are static anyway) into public/data/.
// Run: npm run data
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../public/data/', import.meta.url);
const UA = { 'User-Agent': 'ARGUS-globe-snapshot/0.1' };

async function json(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const round = (v) => Math.round(v * 1000) / 1000;

async function cables() {
  const [c, l] = await Promise.all([
    json('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json'),
    json('https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json'),
  ]);
  const byId = new Map();
  for (const f of c.features) {
    const id = f.properties.id;
    const entry = byId.get(id) ?? { id, name: f.properties.name, color: f.properties.color, lines: [] };
    const geoms = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of geoms) entry.lines.push(line.flatMap(([x, y]) => [round(x), round(y)]));
    byId.set(id, entry);
  }
  const landings = l.features.map((f) => ({ id: f.properties.id, name: f.properties.name, lon: round(f.geometry.coordinates[0]), lat: round(f.geometry.coordinates[1]) }));
  const out = { generated: new Date().toISOString(), cables: [...byId.values()], landings };
  await writeFile(new URL('cables.json', OUT), JSON.stringify(out));
  console.log(`cables: ${out.cables.length} cables, ${landings.length} landing points`);
}

// Keyless "511" road-agency sites (all on the same platform): /List/GetData/Cameras pages through
// every camera site with names, coordinates and still-image URLs (/map/Cctv/<imageId>).
const AGENCIES = [
  ['511on.ca', 'Ontario 511', 'on'],
  ['511.alaska.gov', 'Alaska 511', 'ak'],
  ['511wi.gov', 'Wisconsin 511', 'wi'],
  ['511ga.org', 'Georgia 511', 'ga'],
  ['az511.gov', 'Arizona 511', 'az'],
  ['511.idaho.gov', 'Idaho 511', 'id'],
  ['udottraffic.utah.gov', 'UDOT Traffic (Utah)', 'ut'],
  ['nvroads.com', 'NV Roads (Nevada)', 'nv'],
  ['511la.org', 'Louisiana 511', 'la'],
  ['511pa.com', '511PA (Pennsylvania)', 'pa'],
  ['newengland511.org', 'New England 511', 'ne'],
  ['ctroads.org', 'CTroads (Connecticut)', 'ct'],
  ['fl511.com', 'FL511 (Florida)', 'fl'],
];

async function agency([host, name, code]) {
  const out = [];
  const PAGE = 100; // the platform caps a page at 100 rows
  for (let start = 0, total = Infinity, fails = 0; start < total && start < 20000; start += PAGE) {
    const q = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }], order: [{ column: 1, dir: 'asc' }], start, length: PAGE, search: { value: '' } }));
    let j;
    try {
      j = await json(`https://${host}/List/GetData/Cameras?query=${q}&lang=en`);
    } catch (e) {
      // one bad page shouldn't lose the whole agency
      if (++fails > 3) break;
      continue;
    }
    total = j.recordsTotal ?? 0;
    if (!j.data?.length) break;
    for (const site of j.data) {
      const wkt = site.latLng?.geography?.wellKnownText ?? '';
      const m = wkt.match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/);
      if (!m) continue;
      const img = (site.images ?? []).find((i) => !i.disabled && !i.blocked && i.imageUrl);
      if (!img) continue;
      const label = [site.location, img.description && img.description !== 'N/A' && img.description !== site.location ? img.description : ''].filter(Boolean).join(' · ');
      out.push({
        id: `${code}${img.id}`,
        name: label || site.roadway || `${name} camera ${site.id}`,
        lat: Number(m[2]),
        lon: Number(m[1]),
        img: `https://${host}${img.imageUrl}`,
        src: name,
        refresh: img.refreshRateMs ? Math.round(img.refreshRateMs / 1000) : 60,
      });
    }
  }
  // drop the agency if its stills can't be hot-linked
  if (out.length) {
    const r = await fetch(out[0].img, { headers: UA, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r?.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`${host}: stills not public (${r?.status})`);
  }
  return out;
}

/** Compact v2 format: per-source URL prefixes + array rows (see src/layers/cameras.ts). */
function compact(cams) {
  const srcs = [];
  const idx = new Map();
  const groups = new Map();
  for (const c of cams) {
    if (!idx.has(c.src)) (idx.set(c.src, srcs.length), srcs.push({ n: c.src, h: '' }), groups.set(c.src, []));
    groups.get(c.src).push(c.img);
  }
  for (const s of srcs) {
    const urls = groups.get(s.n);
    let p = urls[0];
    for (const u of urls) while (!u.startsWith(p)) p = p.slice(0, -1);
    s.h = p;
  }
  const rows = cams.map((c) => {
    const s = idx.get(c.src);
    const row = [c.id, c.name, round(c.lat), round(c.lon), s, c.img.slice(srcs[s].h.length), c.refresh ?? 0];
    if (c.stream) row.push(c.stream);
    return row;
  });
  return { v: 2, generated: new Date().toISOString(), s: srcs, c: rows };
}

async function cameras() {
  const cams = [];
  const districts = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  await Promise.all(
    districts.map(async (d) => {
      try {
        const j = await json(`https://cwwp2.dot.ca.gov/data/d${Number(d)}/cctv/cctvStatusD${d}.json`);
        for (const { cctv } of j.data) {
          if (cctv.inService !== 'true') continue;
          const img = cctv.imageData?.static?.currentImageURL;
          const lat = Number(cctv.location.latitude);
          const lon = Number(cctv.location.longitude);
          if (!img || !lat || !lon) continue;
          cams.push({
            id: `ca-${d}-${cctv.index}`,
            name: `${cctv.location.locationName} (${cctv.location.nearbyPlace})`,
            lat,
            lon,
            img,
            stream: cctv.imageData.streamingVideoURL || undefined,
            src: `Caltrans D${Number(d)}`,
            refresh: Number(cctv.imageData.static.currentImageUpdateFrequency || 2) * 60,
          });
        }
      } catch (e) {
        console.warn('caltrans', d, e.message);
      }
    }),
  );
  try {
    const ny = await json('https://webcams.nyctmc.org/api/cameras');
    for (const c of ny) {
      if (c.isOnline !== 'true' && c.isOnline !== true) continue;
      cams.push({ id: `nyc-${c.id}`, name: c.name, lat: c.latitude, lon: c.longitude, img: c.imageUrl, src: 'NYC DOT', refresh: 2 });
    }
  } catch (e) {
    console.warn('nyc', e.message);
  }
  // a few agencies at a time, politely
  for (let i = 0; i < AGENCIES.length; i += 4) {
    const res = await Promise.allSettled(AGENCIES.slice(i, i + 4).map(agency));
    res.forEach((r, k) => {
      const [host] = AGENCIES[i + k];
      if (r.status === 'fulfilled') {
        cams.push(...r.value);
        console.log(`  ${host}: ${r.value.length}`);
      } else console.warn(`  ${host}: FAILED ${r.reason?.message ?? r.reason}`);
    });
  }
  if (cams.length < 1000) throw new Error(`camera list too small (${cams.length}) — keeping existing file`);
  await writeFile(new URL('cameras.json', OUT), JSON.stringify(compact(cams)));
  console.log(`cameras: ${cams.length}`);
}

async function centroids() {
  const j = await json('https://raw.githubusercontent.com/gavinr/world-countries-centroids/master/dist/countries.geojson');
  const out = {};
  for (const f of j.features) if (f.properties.ISO) out[f.properties.ISO] = f.geometry.coordinates.map(round);
  await writeFile(new URL('country-centroids.json', OUT), JSON.stringify(out));
  console.log(`centroids: ${Object.keys(out).length}`);
}

// Fallback satellite catalog for when CelesTrak rate-limits a fresh browser (403 within 2 h).
const GP = 'https://celestrak.org/NORAD/elements/gp.php';
const GROUPS = ['stations', 'starlink', 'oneweb', 'kuiper', 'qianfan', 'gps-ops', 'glo-ops', 'galileo', 'beidou', 'sbas', 'nnss', 'musson', 'weather', 'noaa', 'goes',
  'resource', 'sarsat', 'dmc', 'tdrss', 'argos', 'planet', 'spire', 'iridium-NEXT', 'globalstar', 'orbcomm', 'swarm', 'amateur', 'x-comm', 'other-comm', 'satnogs',
  'gorizont', 'raduga', 'molniya', 'geo', 'intelsat', 'ses', 'eutelsat', 'military', 'radar', 'cubesat', 'other', 'science', 'geodetic', 'engineering', 'education',
  'last-30-days', 'gnss', 'ast'];
async function satellites() {
  const r = await fetch(`${GP}?GROUP=active&FORMAT=csv`, { headers: UA });
  let csv = r.ok ? await r.text() : '';
  if (!r.ok || !csv.startsWith('OBJECT_NAME')) {
    console.warn(`celestrak active: ${r.status} — merging individual groups instead`);
    const seen = new Set();
    let head = '';
    const rows = [];
    for (const g of GROUPS) {
      try {
        const res = await fetch(`${GP}?GROUP=${g}&FORMAT=csv`, { headers: UA });
        const t = await res.text();
        if (!res.ok || !t.startsWith('OBJECT_NAME')) continue;
        const lines = t.trim().split(/\r?\n/);
        head = lines.shift();
        const idCol = head.split(',').indexOf('NORAD_CAT_ID');
        for (const l of lines) {
          const id = l.split(',')[idCol];
          if (!seen.has(id)) (seen.add(id), rows.push(l));
        }
      } catch {
        /* skip group */
      }
    }
    csv = [head, ...rows].join('\n');
  }
  const n = csv.split('\n').length - 1;
  if (n < 1000) throw new Error(`satellite snapshot too small (${n}) — keeping existing file`);
  await writeFile(new URL('gp-active.csv', OUT), csv);
  console.log(`satellites: ${csv.split('\n').length - 1} elements`);
}

// Smithsonian GVP "Volcanoes of the World" Holocene list (their GeoServer has no browser CORS).
async function volcanoes() {
  const j = await json(
    'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json',
  );
  // compact rows: [number, name, lat, lon, type, last eruption year (null = unknown), country, elevation m]
  const rows = j.features
    .filter((f) => f.geometry?.coordinates)
    .map((f) => {
      const p = f.properties;
      return [p.Volcano_Number, p.Volcano_Name, round(f.geometry.coordinates[1]), round(f.geometry.coordinates[0]), p.Primary_Volcano_Type ?? '', p.Last_Eruption_Year ?? null, p.Country ?? '', p.Elevation ?? null];
    });
  if (rows.length < 500) throw new Error(`volcano list too small (${rows.length}) — keeping existing file`);
  await writeFile(new URL('volcanoes.json', OUT), JSON.stringify({ generated: new Date().toISOString(), source: 'Smithsonian GVP VOTW', v: rows }));
  console.log(`volcanoes: ${rows.length}`);
}

// SatNOGS ground stations that are online or testing (the API has no browser CORS).
async function satnogs() {
  const j = await json('https://network.satnogs.org/api/stations/?format=json');
  // rows: [id, name, lat, lon, alt m, status (O=online, T=testing), observations, success %, last seen ISO, bands]
  const rows = j
    .filter((s) => s.status !== 'Offline' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map((s) => [s.id, s.name, round(s.lat), round(s.lng), s.altitude ?? 0, s.status === 'Online' ? 'O' : 'T', s.observations ?? 0, s.success_rate ?? null, s.last_seen ?? null, [...new Set((s.antenna ?? []).map((a) => a.band))].join('/')]);
  if (rows.length < 50) throw new Error(`satnogs list too small (${rows.length}) — keeping existing file`);
  await writeFile(new URL('satnogs-stations.json', OUT), JSON.stringify({ generated: new Date().toISOString(), s: rows }));
  console.log(`satnogs stations: ${rows.length}`);
}

await mkdir(OUT, { recursive: true });
// optional filter: `node scripts/fetch-static-data.mjs volcanoes cameras`
const JOBS = { cables, cameras, centroids, satellites, volcanoes, satnogs };
const only = process.argv.slice(2).filter((a) => a in JOBS);
const results = await Promise.allSettled((only.length ? only : Object.keys(JOBS)).map((k) => JOBS[k]()));
for (const r of results) if (r.status === 'rejected') console.error('FAILED:', r.reason?.message ?? r.reason);
