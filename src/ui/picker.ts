// Global click/tap routing: primitives carry {layer,key} ids; empty ground → ground intel dossier.
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Entity, Cartographic, Math as CMath, type Viewer, Cartesian2 } from 'cesium';
import { pickById } from '../layers/manager';
import { select } from '../core/target';
import { selectGround } from '../layers/weather/pointWeather';
import { isMobile } from '../core/store';
import { closeSheets } from './mobile';
import { activeTool } from '../core/tools';
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

  const groundAt = (p: Cartesian2) => {
    const ray = viewer.camera.getPickRay(p);
    const hit = (ray && viewer.scene.globe.pick(ray, viewer.scene)) ?? viewer.camera.pickEllipsoid(p);
    if (!hit) return null;
    const c = Cartographic.fromCartesian(hit);
    return { lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude) };
  };

  let clickSeq = 0;
  h.setInputAction(async (e: { position: Cartesian2 }) => {
    // an interactive tool (AOI draw, measure) owns the clicks while active
    const tool = activeTool();
    if (tool) {
      const g = groundAt(e.position);
      if (g) tool.click(g.lat, g.lon);
      return;
    }
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
  h.setInputAction(() => activeTool()?.dblclick?.(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  if (!isMobile) {
    // pick only once the pointer rests: a pick re-renders every primitive into an offscreen
    // buffer, so throttled picks while panning across 17k points were wasted GPU work
    let timer: number | undefined;
    const pos = new Cartesian2();
    h.setInputAction((e: { endPosition: Cartesian2 }) => {
      Cartesian2.clone(e.endPosition, pos);
      clearTimeout(timer);
      const tool = activeTool();
      if (tool?.move) {
        const g = groundAt(pos);
        if (g) tool.move(g.lat, g.lon);
        return;
      }
      timer = window.setTimeout(() => {
        canvas.style.cursor = idOf(viewer.scene.pick(pos)) ? 'crosshair' : '';
      }, 140);
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }
}
