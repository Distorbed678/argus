// Selection, target lock (camera follow) and satellite POV camera.
import {
  Cartesian3,
  HeadingPitchRange,
  Matrix4,
  Transforms,
  Math as CMath,
  type Viewer,
} from 'cesium';
import { bus } from './bus';
import type { Dossier } from '../layers/Layer';

let viewer: Viewer;
let current: Dossier | null = null;
let following = false;
let pov: (() => { pos: Cartesian3; dir: Cartesian3; up: Cartesian3 } | null) | null = null;

export function initTarget(v: Viewer) {
  viewer = v;
  v.scene.preUpdate.addEventListener(() => {
    if (pov) {
      const p = pov();
      if (p) {
        v.camera.setView({ destination: p.pos, orientation: { direction: p.dir, up: p.up } });
        v.scene.requestRender();
      }
      return;
    }
    if (following && current?.position) {
      const p = current.position();
      if (p) {
        v.camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(p));
        v.scene.requestRender();
      }
    }
  });
  // user dragging while locked keeps the lock (orbiting); Escape releases
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) release();
  });
}

export function selected() {
  return current;
}
export function isFollowing() {
  return following;
}
export function isPov() {
  return !!pov;
}

export function select(d: Dossier | null) {
  if (current && current !== d) current.onClose?.();
  if (!d) {
    release();
    current = null;
    bus.emit('select', null);
    return;
  }
  if (current && current !== d && (pov || following)) release();
  current = d;
  bus.emit('select', d);
  viewer.scene.requestRender();
}

export function lock() {
  if (!current?.position) return;
  const p = current.position();
  if (!p) return;
  stopPov();
  const range = current.range ?? Math.max(2000, Math.min(4e6, viewer.camera.positionCartographic.height * 0.3));
  following = true;
  viewer.camera.lookAt(p, new HeadingPitchRange(viewer.camera.heading, CMath.toRadians(-45), range));
  viewer.scene.requestRender();
}

export function release() {
  stopPov();
  if (following) {
    following = false;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }
  viewer.scene.requestRender();
}

export function startPov(fn: NonNullable<typeof pov>) {
  if (following) {
    following = false;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
  }
  pov = fn;
  viewer.camera.frustum && ((viewer.camera.frustum as any).fov = CMath.toRadians(50));
  viewer.scene.screenSpaceCameraController.enableInputs = false;
}

export function stopPov() {
  if (!pov) return;
  pov = null;
  viewer.scene.screenSpaceCameraController.enableInputs = true;
  (viewer.camera.frustum as any).fov = CMath.toRadians(60);
  // back off to see the planet
  const c = viewer.camera.positionWC;
  const up = Cartesian3.normalize(c, new Cartesian3());
  viewer.camera.flyTo({ destination: Cartesian3.multiplyByScalar(up, Cartesian3.magnitude(c) + 4e6, new Cartesian3()), duration: 1.2 });
}

export function flyToDossier(d: Dossier, range?: number) {
  const p = d.position?.();
  if (!p) return;
  release();
  const r = range ?? d.range ?? 1.5e6;
  const up = Cartesian3.normalize(p, new Cartesian3());
  const dest = Cartesian3.add(p, Cartesian3.multiplyByScalar(up, r, new Cartesian3()), new Cartesian3());
  viewer.camera.flyTo({ destination: dest, duration: 2 });
}
