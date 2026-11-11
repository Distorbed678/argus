// "Classified" target dossier panel with live telemetry.
import { bus } from '../core/bus';
import { esc } from '../core/fmt';
import { select, lock, release, flyToDossier } from '../core/target';
import type { Dossier } from '../layers/Layer';

export function initDossier() {
  const el = document.getElementById('dossier')!;
  let timer: number | undefined;
  let liveEl: HTMLElement | null = null;
  let cur: Dossier | null = null;

  const kv = (rows: [string, string][], cls = '') => rows.map(([k, v]) => `<div class="kv ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');

  const render = (d: Dossier) => {
    const cls = d.classification ?? 'UNCLASSIFIED // OSINT';
    const isOsint = !d.classification;
    el.innerHTML = `
      <div class="d-class ${isOsint ? 'osint' : ''}">${esc(cls)}</div>
      <div class="panel-head"><span class="d-kind">${esc(d.kind)}</span><button class="x" aria-label="Close">×</button></div>
      <div class="d-body">
        <div class="d-title">${esc(d.title)}</div>
        ${d.subtitle ? `<div class="d-sub">${esc(d.subtitle)}</div>` : ''}
        <div class="sub">TELEMETRY</div>
        <div class="d-live"></div>
        ${kv(d.fields)}
        <div class="d-extra"></div>
      </div>
      <div class="d-actions"></div>`;
    liveEl = el.querySelector('.d-live');
    el.querySelector<HTMLElement>('.x')!.onclick = () => select(null);
    if (d.extra) el.querySelector('.d-extra')!.appendChild(d.extra);
    const acts = el.querySelector('.d-actions')!;
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    };
    if (d.position) {
      mk('FLY TO', () => flyToDossier(d));
      if (!d.actions?.some((a) => a.label === 'LOCK')) mk('LOCK', () => lock());
    }
    for (const a of d.actions ?? []) mk(a.label, a.run);
    mk('RELEASE', () => release()).classList.add('danger');
    updateLive();
  };

  const updateLive = () => {
    if (!cur?.live || !liveEl) return;
    const rows = cur.live();
    if (rows) liveEl.innerHTML = kv(rows, 'live');
  };

  bus.on('select', (d) => {
    clearInterval(timer);
    cur = d;
    document.body.classList.toggle('has-dossier', !!d);
    if (!d) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.scrollTop = 0;
    render(d);
    if (d.live) timer = window.setInterval(updateLive, 1000);
  });
}
