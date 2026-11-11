// Top-bar readouts: UTC clock, sim time, camera position, track count, FPS.
import type { Viewer } from 'cesium';
import { bus } from '../core/bus';
import { cameraInfo } from '../core/viewer';
import { simNow, isLive } from '../core/clock';
import { fmtLat, fmtLon, fmtDist } from '../core/fmt';
import { layerStates } from '../layers/manager';

export function initHud(viewer: Viewer) {
  const $ = (id: string) => document.getElementById(id)!;
  const utc = $('ro-utc');
  const sim = $('ro-sim');
  const simWrap = $('ro-sim-wrap');
  const cam = $('ro-cam');
  const alt = $('ro-alt');
  const tracks = $('ro-tracks');
  const fps = $('ro-fps');

  let frames = 0;
  viewer.scene.postRender.addEventListener(() => frames++);
  let lastFps = performance.now();

  setInterval(() => {
    const now = new Date();
    utc.textContent = now.toISOString().slice(11, 19);
    const live = isLive();
    sim.textContent = live ? 'LIVE' : new Date(simNow()).toISOString().slice(5, 16).replace('T', ' ');
    simWrap.classList.toggle('offline', !live);
    const t = performance.now();
    const f = (frames * 1000) / (t - lastFps);
    frames = 0;
    lastFps = t;
    // requestRenderMode only draws on change, so a few frames/s means 'idle', not 'slow'
    fps.textContent = f < 12 ? 'IDLE' : f.toFixed(0);
  }, 1000);

  const updateCam = () => {
    const c = cameraInfo();
    cam.textContent = `${fmtLat(c.lat).replace(/(\.\d{2})\d+/, '$1')} ${fmtLon(c.lon).replace(/(\.\d{2})\d+/, '$1')}`;
    alt.textContent = fmtDist(c.alt);
  };
  viewer.camera.changed.addEventListener(updateCam);
  viewer.camera.percentageChanged = 0.01;
  updateCam();

  let pending = false;
  bus.on('status', () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const n = layerStates().reduce((s, l) => s + (l.on ? l.count ?? 0 : 0), 0);
      tracks.textContent = n.toLocaleString();
    }, 500);
  });
}
