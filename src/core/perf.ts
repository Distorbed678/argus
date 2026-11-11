// Pause rendering while hidden; keep the GPU idle when nothing changes.
import type { Viewer } from 'cesium';
import { bus } from './bus';

export function initPerf(viewer: Viewer) {
  document.addEventListener('visibilitychange', () => {
    const visible = !document.hidden;
    viewer.useDefaultRenderLoop = visible;
    bus.emit('visibility', visible);
    if (visible) viewer.scene.requestRender();
  });
  // WebGL context loss (common on mobile when backgrounded)
  viewer.scene.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
}
