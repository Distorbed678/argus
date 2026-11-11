// Global click/tap routing: primitives carry {layer,key} ids; empty ground → ground intel dossier.
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Entity, Cartographic, Math as CMath, type Viewer, Cartesian2 } from 'cesium';
import { pickById } from '../layers/manager';
import { select } from '../core/target';
import { selectGround } from '../layers/weather/pointWeather';
import { isMobile } from '../core/store';
import { closeSheets } from './mobile';
import type { PickId } from '../layers/Layer';

function idOf(picked: any): PickId | undefined {
  const id = picked?.id;
  if (!id) return;
  if (id instanceof Entity) return (id as any).argus;
  if (typeof id === 'object' && 'layer' in id && 'key' in id) return id as PickId;
  return;
}

export function initPicker(viewer: Viewer) {
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  const h = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const canvas = viewer.scene.canvas;

  let clickSeq = 0;
  h.setInputAction(async (e: { position: Cartesian2 }) => {
    // on mobile, a tap on the map with a sheet open just dismisses the sheet
    if (closeSheets()) return;
    const seq = ++clickSeq;
    // drillPick lets us skip non-ARGUS primitives (e.g. orbit lines) under the cursor
    const picks = viewer.scene.drillPick(e.position, 4, isMobile ? 18 : 8, isMobile ? 18 : 8);
    for (const p of picks) {
      const id = idOf(p);
      if (!id) continue;
      const d = await pickById(id.layer, id.key);
      if (seq !== clickSeq) return; // a newer click won while this pick was loading
      if (d) {
        select(d);
        return;
      }
    }
    const ray = viewer.camera.getPickRay(e.position);
    const hit = (ray && viewer.scene.globe.pick(ray, viewer.scene)) ?? viewer.camera.pickEllipsoid(e.position);
    if (!hit) {
      select(null);
      return;
    }
    const c = Cartographic.fromCartesian(hit);
    selectGround(CMath.toDegrees(c.latitude), CMath.toDegrees(c.longitude));
  }, ScreenSpaceEventType.LEFT_CLICK);

  if (!isMobile) {
    let last = 0;
    h.setInputAction((e: { endPosition: Cartesian2 }) => {
      const t = performance.now();
      if (t - last < 120) return;
      last = t;
      const p = viewer.scene.pick(e.endPosition);
      canvas.style.cursor = idOf(p) ? 'crosshair' : '';
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }
}
