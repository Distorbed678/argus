import { bus } from '../core/bus';
import { ago, esc } from '../core/fmt';
import { layerStates, toggle } from '../layers/manager';
import { CATEGORIES } from '../layers/registry';
import type { LayerStatus } from '../layers/Layer';

const LABEL: Record<LayerStatus, string> = {
  off: '',
  loading: 'SYNC',
  live: 'LIVE',
  cached: 'CACHED',
  offline: 'OFFLINE',
  key: 'KEY REQ',
  proxy: 'NEEDS PROXY',
  error: 'ERROR',
  standby: 'STANDBY',
};

export function initLayerPanel() {
  const list = document.getElementById('layer-list')!;
  const filter = document.getElementById('layer-filter') as HTMLInputElement;
  const rows = new Map<string, HTMLElement>();
  const catCounts = new Map<string, HTMLElement>();
  let collapsed = new Set<string>();
  try {
    collapsed = new Set(JSON.parse(localStorage.getItem('argus.collapsed') ?? '[]'));
  } catch {
    /* ignore */
  }

  for (const cat of CATEGORIES) {
    const wrap = document.createElement('div');
    wrap.className = 'cat' + (collapsed.has(cat) ? ' collapsed' : '');
    wrap.innerHTML = `<div class="cat-head">${cat}<span class="n"></span></div><div class="rows"></div>`;
    const head = wrap.querySelector<HTMLElement>('.cat-head')!;
    head.onclick = () => {
      wrap.classList.toggle('collapsed');
      if (wrap.classList.contains('collapsed')) collapsed.add(cat);
      else collapsed.delete(cat);
      try {
        localStorage.setItem('argus.collapsed', JSON.stringify([...collapsed]));
      } catch {
        /* ignore */
      }
    };
    catCounts.set(cat, wrap.querySelector('.n')!);
    const rowsEl = wrap.querySelector('.rows')!;
    for (const s of layerStates().filter((l) => l.meta.category === cat)) {
      const r = document.createElement('div');
      r.className = 'row';
      r.dataset.id = s.meta.id;
      r.dataset.q = `${s.meta.name} ${s.meta.source} ${cat}`.toLowerCase();
      r.innerHTML = `<i class="chk"></i><div><div class="name">${esc(s.meta.name)}${s.meta.needsKey ? ` <span class="dim">[${s.meta.needsKey}${s.meta.keyOptional ? ' opt' : ''}]</span>` : ''}</div><span class="meta">${esc(s.meta.source)}</span></div><span class="st"></span>`;
      r.title = s.meta.note ?? s.meta.source;
      r.onclick = () => toggle(s.meta.id, !s.on);
      rowsEl.appendChild(r);
      rows.set(s.meta.id, r);
    }
    list.appendChild(wrap);
  }

  const paint = (id: string) => {
    const s = layerStates().find((l) => l.meta.id === id);
    const r = rows.get(id);
    if (!s || !r) return;
    r.classList.toggle('on', s.on);
    const st = r.querySelector<HTMLElement>('.st')!;
    st.className = `st st-${s.on ? s.status : 'off'}`;
    st.innerHTML = s.on ? `${LABEL[s.status]}${s.count ? `<span class="cnt">${s.count.toLocaleString()}</span>` : ''}` : '';
    const meta = r.querySelector<HTMLElement>('.meta')!;
    meta.textContent = s.on && s.detail ? `${s.detail}${s.updated ? ' · ' + ago(s.updated) : ''}` : s.meta.source;
    const cat = s.meta.category;
    const on = layerStates().filter((l) => l.meta.category === cat && l.on).length;
    catCounts.get(cat)!.textContent = on ? `${on} ON` : '';
  };

  for (const s of layerStates()) paint(s.meta.id);
  bus.on('status', (e) => paint(e.id));
  bus.on('layer-toggle', (e) => paint(e.id));
  setInterval(() => layerStates().forEach((s) => s.on && paint(s.meta.id)), 15000);

  filter.oninput = () => {
    const q = filter.value.trim().toLowerCase();
    for (const r of rows.values()) r.hidden = !!q && !r.dataset.q!.includes(q);
    list.querySelectorAll('.cat').forEach((c) => c.classList.toggle('collapsed', !q && collapsed.has(c.querySelector('.cat-head')!.firstChild!.textContent!)));
  };
}
