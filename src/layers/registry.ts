import type { LayerMeta } from './Layer';
import type { SatCat } from './satellites/categories';

const sat = (id: string, name: string, cat: SatCat): LayerMeta => ({
  id,
  name,
  category: 'SPACE',
  source: 'CelesTrak GP (SGP4)',
  load: () => import('./satellites/index').then((m) => ({ default: m.satLayer(cat) })),
});

const gibs = (id: string, name: string, category: LayerMeta['category'], layer: string, tms: string, ext: string, opts: { alpha?: number; night?: boolean; timeMode?: 'geo' | 'day' | 'default'; note?: string } = {}): LayerMeta => ({
  id,
  name,
  category,
  source: `NASA GIBS · ${layer.replace(/_/g, ' ')}`,
  note: opts.note,
  load: () => import('./weather/gibs').then((m) => ({ default: m.gibsLayer(layer, tms, ext, opts) })),
});

const osm = (id: string, name: string, kind: string): LayerMeta => ({
  id,
  name,
  category: 'INTEL',
  source: 'OpenStreetMap Overpass (zoom < 600 km)',
  note: 'Loads for the current view when zoomed in',
  load: () => import('./intel/overpass').then((m) => ({ default: m.overpassLayer(kind) })),
});

export const LAYERS: LayerMeta[] = [
  // SPACE
  sat('sat-stations', 'Crewed & stations', 'stations'),
  sat('sat-military', 'Military / recon sats', 'military'),
  sat('sat-starlink', 'Starlink', 'starlink'),
  sat('sat-comms', 'Comms constellations', 'comms'),
  sat('sat-gnss', 'GPS / GNSS', 'gnss'),
  sat('sat-earthobs', 'Earth obs / weather sats', 'earthobs'),
  sat('sat-other', 'Other active sats', 'other'),
  sat('sat-debris', 'Debris fields', 'debris'),
  { id: 'terminator', name: 'Day/night + city lights', category: 'SPACE', source: 'Solar ephemeris + NASA Black Marble', load: () => import('./sky/terminator') },
  { id: 'sun-moon', name: 'Sub-solar / sub-lunar', category: 'SPACE', source: 'Cesium ephemeris', load: () => import('./sky/sunMoon') },
  { id: 'aurora', name: 'Aurora oval', category: 'SPACE', source: 'NOAA SWPC OVATION', load: () => import('./hazards/aurora') },
  { id: 'space-wx', name: 'Space weather (Kp, flares)', category: 'SPACE', source: 'NOAA SWPC', load: () => import('./hazards/spaceWeather') },
  { id: 'reentry', name: 'Re-entries (decaying objects)', category: 'SPACE', source: 'CelesTrak DECAYING · drag estimate', note: 'Countdowns are a first-order drag-decay estimate, not official predictions', load: () => import('./sky/reentry') },
  { id: 'launches', name: 'Rocket launches', category: 'SPACE', source: 'The Space Devs Launch Library 2', load: () => import('./sky/launches') },
  // AIR
  { id: 'flights', name: 'Live flights', category: 'AIR', source: 'adsb.lol → adsb.fi → OpenSky (via proxy)', load: () => import('./flights') },
  { id: 'mil-air', name: 'Military aircraft', category: 'AIR', source: 'adsb.lol /v2/mil (via proxy)', load: () => import('./military') },
  { id: 'tfr', name: 'US flight restrictions (TFR)', category: 'AIR', source: 'FAA TFR GeoServer (via proxy)', load: () => import('./intel/tfr') },
  { id: 'gpsjam', name: 'GPS interference (estimate)', category: 'AIR', source: 'ADS-B NACp aggregation (adsb.lol via proxy)', note: 'Share of airborne aircraft reporting NACp < 8 per 1° cell over 30 min. An estimate: avionics faults degrade NACp too.', load: () => import('./intel/gpsjam') },
  // SEA/LAND
  { id: 'ships', name: 'Ships (AIS)', category: 'SEA/LAND', source: 'Digitraffic AIS (Baltic) + aisstream.io (key)', needsKey: 'aisstream', keyOptional: true, load: () => import('./ships') },
  { id: 'trains', name: 'Live trains (Finland)', category: 'SEA/LAND', source: 'Digitraffic rail GPS', load: () => import('./trains') },
  // WEATHER
  { id: 'radar', name: 'Precipitation radar', category: 'WEATHER', source: 'RainViewer', load: () => import('./weather/radar') },
  gibs('clouds-ir', 'Live IR clouds (geostationary)', 'WEATHER', 'GOES', 'GoogleMapsCompatible_Level6', 'png', { timeMode: 'geo', alpha: 0.75, note: 'GOES-East + GOES-West + Himawari, 10-min' }),
  gibs('precip', 'Global precipitation (IMERG)', 'WEATHER', 'IMERG_Precipitation_Rate', 'GoogleMapsCompatible_Level6', 'png', { alpha: 0.8 }),
  gibs('sst', 'Sea surface temperature', 'WEATHER', 'GHRSST_L4_MUR_Sea_Surface_Temperature', 'GoogleMapsCompatible_Level7', 'png', { alpha: 0.7 }),
  gibs('aerosol', 'Smoke / aerosol index', 'WEATHER', 'OMPS_NOAA21_NadirMapper_AerosolIndex_380', 'GoogleMapsCompatible_Level6', 'png', { alpha: 0.7 }),
  { id: 'storms', name: 'Tropical cyclones + cones', category: 'WEATHER', source: 'NOAA NHC / CPHC (Atlantic, E+C Pacific)', load: () => import('./sky/storms') },
  { id: 'sondes', name: 'Weather balloons (radiosondes)', category: 'WEATHER', source: 'SondeHub amateur network', load: () => import('./sky/sondes') },
  { id: 'airq', name: 'Air quality (sampled)', category: 'WEATHER', source: 'Open-Meteo air quality (CAMS)', load: () => import('./weather/airQuality') },
  { id: 'waves', name: 'Ocean waves / swell (sampled)', category: 'WEATHER', source: 'Open-Meteo marine', load: () => import('./weather/marine') },
  { id: 'wind', name: 'Wind field (sampled)', category: 'WEATHER', source: 'Open-Meteo', load: () => import('./weather/wind') },
  // HAZARDS
  { id: 'quakes', name: 'Earthquakes (24h)', category: 'HAZARDS', source: 'USGS', load: () => import('./hazards/quakes') },
  { id: 'eonet', name: 'Natural events', category: 'HAZARDS', source: 'NASA EONET v3', load: () => import('./hazards/eonet') },
  { id: 'gdacs', name: 'Disaster alerts', category: 'HAZARDS', source: 'GDACS (UN/EC)', load: () => import('./hazards/gdacs') },
  { id: 'fires', name: 'Active fires (24h)', category: 'HAZARDS', source: 'NASA FIRMS MODIS (via proxy)', load: () => import('./hazards/fires') },
  { id: 'tsunami', name: 'Tsunami bulletins', category: 'HAZARDS', source: 'NOAA NTWC + PTWC (via proxy)', load: () => import('./hazards/tsunami') },
  { id: 'volcanoes', name: 'Volcanoes (Holocene)', category: 'HAZARDS', source: 'Smithsonian GVP (bundled snapshot)', load: () => import('./hazards/volcanoes') },
  { id: 'nws', name: 'US severe weather alerts', category: 'HAZARDS', source: 'NOAA NWS', load: () => import('./hazards/alerts') },
  // INTEL
  { id: 'cables', name: 'Undersea cables', category: 'INTEL', source: 'TeleGeography (bundled snapshot)', load: () => import('./intel/cables') },
  osm('osm-military', 'Military sites', 'military'),
  osm('osm-nuclear', 'Nuclear facilities', 'nuclear'),
  osm('osm-power', 'Power plants', 'power'),
  osm('osm-airports', 'Airfields', 'airports'),
  osm('osm-ports', 'Ports & harbours', 'ports'),
  osm('osm-towers', 'Comms towers & masts', 'towers'),
  { id: 'buildings', name: '3D buildings', category: 'INTEL', source: 'Cesium OSM Buildings', needsKey: 'ion', load: () => import('./intel/buildings') },
  // SIGNALS
  { id: 'gdelt', name: 'News events', category: 'SIGNALS', source: 'GDELT GKG GeoJSON (via proxy, best effort)', load: () => import('./signals/gdelt') },
  { id: 'ioda', name: 'Internet outages', category: 'SIGNALS', source: 'IODA (Georgia Tech)', load: () => import('./signals/ioda') },
  { id: 'radio', name: 'Live radio stations', category: 'SIGNALS', source: 'radio-browser.info', load: () => import('./signals/radio') },
  { id: 'wiki', name: 'Live Wikipedia edits', category: 'SIGNALS', source: 'Wikimedia EventStreams', load: () => import('./signals/wikiEdits') },
  // HUMAN
  { id: 'cameras', name: 'Public traffic cameras', category: 'HUMAN', source: 'Caltrans + NYC DOT (+ Windy key)', needsKey: 'windy', keyOptional: true, load: () => import('./cameras') },
  gibs('nightlights', 'Night lights (full)', 'HUMAN', 'VIIRS_Black_Marble', 'GoogleMapsCompatible_Level8', 'png', { alpha: 0.9 }),
  gibs('population', 'Population density', 'HUMAN', 'GPW_Population_Density_2020', 'GoogleMapsCompatible_Level7', 'png', { alpha: 0.65 }),
];

export const CATEGORIES = ['SPACE', 'AIR', 'SEA/LAND', 'WEATHER', 'HAZARDS', 'INTEL', 'SIGNALS', 'HUMAN'] as const;
