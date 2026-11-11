import './ui/theme.css';
import { Cartesian3 } from 'cesium';
import { createViewer } from './core/viewer';
import { initClock } from './core/clock';
import { initTarget, release } from './core/target';
import { initPerf } from './core/perf';
import { log } from './core/bus';
import { settings, isMobile } from './core/store';
import { locate } from './core/observer';
import { initLayers, restoreLayers } from './layers/manager';
import { initFx } from './fx/postfx';
import { runBoot } from './ui/boot';
import { initHud } from './ui/hud';
import { initLayerPanel } from './ui/layerPanel';
import { initDossier } from './ui/dossier';
import { initReticle } from './ui/reticle';
import { initLog } from './ui/interceptLog';
import { initTimeline } from './ui/timeline';
import { initCommandLine } from './ui/commandLine';
import { initPicker } from './ui/picker';
import { initPanels } from './ui/mobile';
import { openSettings, applyFxClass } from './ui/settings';
import { openAR } from './ar/skyview';
import { initAoi } from './spy/aoi';
import { initAlerts } from './spy/alerts';
import { initWatchlist } from './spy/watchlist';
import { initIntel, registerAoiAction } from './ui/intel';
import { initTrails } from './spy/trails';
import { initMeasure, toggleMeasure } from './spy/measure';
import { aois } from './spy/aoi';
import { shapeCenter } from './core/geo';

applyFxClass();
document.body.dataset.mode = settings.mode;

const viewer = createViewer(document.getElementById('globe')!, document.getElementById('credits')!);
initLog(viewer);
initClock(viewer);
initTarget(viewer);
initPerf(viewer);
initLayers(viewer);
initFx(viewer);
initHud(viewer);
initLayerPanel();
initDossier();
initReticle(viewer);
initTimeline();
initCommandLine(viewer);
initPicker(viewer);
initPanels();
initAoi(viewer);
initTrails(viewer);
initMeasure(viewer);
document.getElementById('btn-measure')!.onclick = () => toggleMeasure();
initAlerts();
initWatchlist(viewer);
initIntel();
registerAoiAction({
  label: 'REVISIT',
  run: (id) => {
    const a = aois().find((x) => x.id === id);
    if (!a) return;
    const c = shapeCenter(a.shape);
    void import('./spy/revisit').then((m) => m.openRevisit(c.lat, c.lon, `AOI ${a.name}`));
  },
});

document.getElementById('btn-settings')!.onclick = openSettings;
document.getElementById('btn-ar')!.onclick = () => openAR();
document.getElementById('btn-locate')!.onclick = async () => {
  const o = await locate();
  release();
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(o.lon, o.lat, 2.5e5), duration: 2.5 });
};

log('ARGUS', `console online · ${isMobile ? 'mobile' : 'desktop'} profile · ${settings.keys.ion ? 'ion terrain' : 'ellipsoid (no ion key)'}`, 'ok');

// first tiles + layer restore feed the boot log
const ready = new Promise<void>((resolve) => {
  const off = viewer.scene.globe.tileLoadProgressEvent.addEventListener((n: number) => {
    if (n === 0) {
      off();
      resolve();
    }
  });
});
restoreLayers();

runBoot(ready).then(() => {
  // fly-in from deep space toward the viewer's rough longitude (timezone-based guess)
  const lon = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
  viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, 25, isMobile ? 2.6e7 : 1.9e7), duration: 3.5 });
  log('ARGUS', 'operator console handed off — press / for commands', 'ok');
});

// PWA (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}
