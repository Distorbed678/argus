import { SceneTransforms, Cartesian2, Cartesian3, EllipsoidalOccluder, Ellipsoid, type Viewer } from 'cesium';
import { bus } from '../core/bus';
import { selected, isFollowing, isPov } from '../core/target';

export function initReticle(viewer: Viewer) {
  const el = document.getElementById('reticle')!;
  const tag = el.querySelector<HTMLElement>('.tag')!;
  const scratch = new Cartesian2();
  const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.ZERO);

  bus.on('select', (d) => {
    el.hidden = !d;
    if (d) {
      tag.textContent = `${d.kind} :: ${d.title}`.slice(0, 48);
      // restart lock-in animation
      const ring = el.querySelector<HTMLElement>('.ring')!;
      ring.style.animation = 'none';
      void ring.offsetWidth;
      ring.style.animation = '';
    }
  });

  viewer.scene.postRender.addEventListener(() => {
    const d = selected();
    if (!d?.position || isPov()) {
      if (!el.hidden && (isPov() || !d)) el.hidden = true;
      return;
    }
    const p = d.position();
    if (!p) return;
    occluder.cameraPosition = viewer.camera.positionWC;
    const visible = occluder.isPointVisible(p);
    const w = visible ? SceneTransforms.worldToWindowCoordinates(viewer.scene, p, scratch) : undefined;
    if (!w) {
      el.style.opacity = '0';
      return;
    }
    el.hidden = false;
    el.style.opacity = '1';
    el.style.transform = `translate(${w.x}px, ${w.y}px)`;
    el.classList.toggle('following', isFollowing());
  });
}
