import { Cartesian3, type Viewer } from 'cesium';
import { bus } from '../core/bus';
import { esc } from '../core/fmt';
import { release } from '../core/target';

const MAX = 120;

export function initLog(viewer: Viewer) {
  const list = document.getElementById('log-list')!;
  let count = 0;
  bus.on('log', (e) => {
    const li = document.createElement('li');
    li.className = e.level + (e.lon != null ? ' geo' : '');
    const t = new Date(e.t).toISOString().slice(11, 19);
    li.innerHTML = `<span class="t">${t}</span><span class="s">[${esc(e.src)}]</span><span class="m">${esc(e.msg)}</span>`;
    if (e.lon != null && e.lat != null) {
      li.title = 'click to slew camera';
      li.onclick = () => (release(), viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(e.lon!, e.lat!, 1.2e6), duration: 2 }));
    }
    list.appendChild(li);
    if (++count > MAX) {
      list.firstElementChild?.remove();
      count--;
    }
    list.scrollTop = list.scrollHeight;
  });
}
