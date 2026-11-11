// Imagery modes as Cesium post-process stages.
import { PostProcessStage, type Viewer } from 'cesium';
import common from './shaders/common.glsl?raw';
import nightvision from './shaders/nightvision.glsl?raw';
import flir from './shaders/flir.glsl?raw';
import crt from './shaders/crt.glsl?raw';
import edge from './shaders/edge.glsl?raw';
import tactical from './shaders/tactical.glsl?raw';
import { bus, log } from '../core/bus';
import { settings, saveSettings } from '../core/store';

export const MODES: { id: string; label: string; src?: string }[] = [
  { id: 'normal', label: 'EO / NATURAL' },
  { id: 'tactical', label: 'TACTICAL BLUE', src: tactical },
  { id: 'nightvision', label: 'NIGHT VISION', src: nightvision },
  { id: 'flir', label: 'FLIR THERMAL', src: flir },
  { id: 'crt', label: 'CRT UPLINK', src: crt },
  { id: 'edge', label: 'EDGE ANALYSIS', src: edge },
];

let viewer: Viewer;
let stage: PostProcessStage | undefined;
const t0 = performance.now();

export function initFx(v: Viewer) {
  viewer = v;
  setMode(settings.mode, true);
}

export function setMode(id: string, silent = false) {
  const m = MODES.find((x) => x.id === id) ?? MODES[0];
  if (stage) {
    viewer.scene.postProcessStages.remove(stage);
    stage = undefined;
  }
  if (m.src && !(settings.reduceFx && m.id === 'crt')) {
    stage = new PostProcessStage({
      fragmentShader: common + '\n' + m.src,
      uniforms: { u_time: () => (performance.now() - t0) / 1000 },
    });
    viewer.scene.postProcessStages.add(stage);
  }
  document.body.dataset.mode = m.id;
  saveSettings({ mode: m.id });
  bus.emit('mode', m.id);
  if (!silent) log('SENSOR', `imaging mode → ${m.label}`, 'ok');
  viewer.scene.requestRender();
}
