import { JulianDate, type Viewer } from 'cesium';

let v: Viewer;
export function initClock(viewer: Viewer) {
  v = viewer;
}

/** Current simulation time (ms since epoch). Driven by the timeline scrubber. */
export function simNow(): number {
  return JulianDate.toDate(v.clock.currentTime).getTime();
}

export function isLive(): boolean {
  return v.clock.multiplier === 1 && Math.abs(simNow() - Date.now()) < 5000;
}

export function goLive() {
  v.clock.currentTime = JulianDate.now();
  v.clock.multiplier = 1;
  v.clock.shouldAnimate = true;
  v.scene.requestRender();
}

export function setSimTime(ms: number) {
  v.clock.currentTime = JulianDate.fromDate(new Date(ms));
  v.scene.requestRender();
}

export function setRate(mult: number) {
  v.clock.multiplier = mult;
  v.clock.shouldAnimate = mult !== 0;
  v.scene.requestRender();
}

export function getRate() {
  return v.clock.shouldAnimate ? v.clock.multiplier : 0;
}
