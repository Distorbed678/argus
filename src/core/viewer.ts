import {
  Viewer,
  Ion,
  ImageryLayer,
  UrlTemplateImageryProvider,
  Color,
  Terrain,
  Credit,
  ClockStep,
  JulianDate,
  Cartesian3,
  Cartesian2,
  Cartographic,
  Math as CMath,
  type ImageryProvider,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { settings, isMobile, type Settings } from './store';
import { log } from './bus';

let viewer: Viewer;
let baseLayer: ImageryLayer | undefined;
let labelLayer: ImageryLayer | undefined;

/**
 * "History" base: NASA GIBS MODIS Terra daily true colour for the timeline's date (UTC day).
 * Today's mosaic is still filling in, so live time shows yesterday; Terra imagery starts 2000-02-24.
 */
export function historyDate(): string {
  const sim = JulianDate.toDate(viewer.clock.currentTime).getTime();
  const yesterday = Date.now() - 86400_000;
  const t = Math.max(Date.UTC(2000, 1, 24), Math.min(sim, yesterday));
  return new Date(t).toISOString().slice(0, 10);
}
let historyShown = '';

function baseProvider(kind: string): ImageryProvider {
  switch (kind) {
    case 'history': {
      historyShown = historyDate();
      return new UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${historyShown}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
        maximumLevel: 9,
        credit: new Credit(`NASA GIBS / MODIS Terra true colour ${historyShown}`),
      });
    }
    case 'dark':
      return new UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 16,
        credit: new Credit('Esri, HERE, Garmin, © OpenStreetMap contributors'),
      });
    case 'truecolor':
      return new UrlTemplateImageryProvider({
        url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
        maximumLevel: 9,
        credit: new Credit('NASA GIBS / VIIRS'),
      });
    case 'osm':
      return new UrlTemplateImageryProvider({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maximumLevel: 19,
        credit: new Credit('© OpenStreetMap contributors'),
      });
    default:
      return new UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: new Credit('Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, GIS User Community'),
      });
  }
}

export function setBase(kind: Settings['base']) {
  const layers = viewer.imageryLayers;
  const next = new ImageryLayer(baseProvider(kind));
  if (kind === 'sat') {
    next.saturation = 0.85;
    next.brightness = 0.9;
  }
  if (kind === 'osm') {
    next.saturation = 0.2;
    next.hue = 0.55;
    next.brightness = 0.7;
  }
  layers.add(next, 0);
  if (baseLayer) layers.remove(baseLayer, true);
  baseLayer = next;
  viewer.scene.requestRender();
}

export function setLabels(on: boolean) {
  if (labelLayer) {
    viewer.imageryLayers.remove(labelLayer, true);
    labelLayer = undefined;
  }
  if (on) {
    labelLayer = viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: new Credit('Esri boundaries & places'),
      }),
    );
    labelLayer.alpha = 0.8;
  }
  viewer.scene.requestRender();
}

/** Keep the labels overlay on top after overlays are added. */
export function raiseLabels() {
  if (labelLayer) viewer.imageryLayers.raiseToTop(labelLayer);
}

export function applyQuality() {
  viewer.useBrowserRecommendedResolution = !settings.highQuality;
  viewer.scene.postProcessStages.fxaa.enabled = settings.highQuality;
  viewer.scene.globe.maximumScreenSpaceError = settings.highQuality ? 1.5 : isMobile ? 3 : 2;
  viewer.scene.requestRender();
}

export function createViewer(container: HTMLElement, credits: HTMLElement): Viewer {
  if (settings.keys.ion) Ion.defaultAccessToken = settings.keys.ion;

  viewer = new Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    vrButton: false,
    baseLayer: false,
    creditContainer: credits,
    requestRenderMode: true,
    showRenderLoopErrors: false,
    maximumRenderTimeChange: 1,
    shouldAnimate: true,
    msaaSamples: isMobile ? 1 : 2,
    terrain: settings.keys.ion ? Terrain.fromWorldTerrain({ requestVertexNormals: true }) : undefined,
  });

  const scene = viewer.scene;
  scene.globe.baseColor = Color.fromCssColorString('#030b18');
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.depthTestAgainstTerrain = false;
  scene.globe.tileCacheSize = isMobile ? 60 : 160;
  scene.backgroundColor = Color.fromCssColorString('#01040a');
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.hueShift = 0.05;
    scene.skyAtmosphere.brightnessShift = -0.1;
  }
  scene.screenSpaceCameraController.minimumZoomDistance = 50;
  scene.screenSpaceCameraController.maximumZoomDistance = 2.5e8;
  viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
  viewer.clock.currentTime = JulianDate.now();
  // Never show Cesium's modal "rendering has stopped" dialog: log it and restart the loop.
  let errCount = 0;
  scene.renderError.addEventListener((_s, err) => {
    console.error('[render]', err);
    ((window as any).__argusErr ??= []).push(String((err as Error)?.stack ?? err));
    if (++errCount <= 3) log('GPU', `render fault recovered: ${String(err).slice(0, 100)}`, 'warn');
    setTimeout(() => {
      viewer.useDefaultRenderLoop = true;
      scene.requestRender();
    }, 250);
  });
  (window as any).__argus = viewer;

  setBase(settings.base);
  setLabels(settings.labels);
  // the history base follows the timeline: swap imagery when the sim date crosses a UTC day
  window.setInterval(() => {
    if (settings.base !== 'history' || document.hidden) return;
    const d = historyDate();
    if (d === historyShown) return;
    setBase('history');
    log('IMAGERY', `history base → MODIS Terra ${d}`, 'info');
  }, 2000);
  applyQuality();

  // Start far out in space for the fly-in.
  viewer.camera.setView({ destination: Cartesian3.fromDegrees(-40, 20, 9.0e7) });
  return viewer;
}

export function getViewer() {
  return viewer;
}

/** Geographic point at the center of the screen (falls back to camera nadir when looking at space). */
export function viewCenter() {
  const c = viewer.scene.canvas;
  const hit = viewer.camera.pickEllipsoid(new Cartesian2(c.clientWidth / 2, c.clientHeight / 2));
  const cam = cameraInfo();
  if (!hit) return { lat: cam.lat, lon: cam.lon, dist: cam.alt };
  const g = Cartographic.fromCartesian(hit);
  return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude), dist: Cartesian3.distance(hit, viewer.camera.positionWC) };
}

export function cameraInfo() {
  const c = viewer.camera.positionCartographic;
  return { lon: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude), alt: c.height };
}
