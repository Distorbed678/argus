// THREAT BOARD: live object counts per category with session sparklines, and the latest alerts
// grouped by severity (AOI alerts highlighted). Lives as a tab in the INTEL panel.
import type { Viewer } from 'cesium';
import { Cartesian3 } from 'cesium';
import { bus, type LogEntry } from '../core/bus';
import { esc } from '../core/fmt';
import { release } from '../core/target';
import { layerStates } from '../layers/manager';
import { CATEGORIES } from '../layers/registry';
import { closeSheets } from './mobile';
import { registerTab, toggleIntel } from './intel';

const SAMPLE_MS = 30_000;
const MAX_SAMPLES = 120; // one hour
const series = new Map<string, number[]>(CATEGORIES.map((c) => [c, []]));
const alerts: LogEntry[] = [];
const warns: LogEntry[] = [];

export function categoryCounts(): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const s of layerStates()) if (s.on && s.count) out[s.meta.category] += s.count;
  return out;
}

function sample() {
  const c = categoryCounts();
  for (const cat of CATEGORIES) {
    const a = series.get(cat)!;
    a.push(c[cat]);
    if (a.length > MAX_SAMPLES) a.shift();
  }
}

/** Inline SVG sparkline (exported for tests). */
export function sparkline(vals: number[], w = 90, h = 18): string {
  if (vals.length < 2) return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
}

const fmtN = (n: number) => (n >= 1e4 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());

function render(el: HTMLElement) {
  const c = categoryCounts();
  const total = Object.values(c).reduce((s, n) => s + n, 0);
  const row = (e: LogEntry) =>
    `<li class="${e.src === 'AOI' ? 'aoi' : ''}${e.lon != null ? ' geo' : ''}" data-lat="${e.lat ?? ''}" data-lon="${e.lon ?? ''}"><span class="t">${new Date(e.t).toISOString().slice(11, 16)}</span><span class="s">${esc(e.src)}</span><span class="m">${esc(e.msg)}</span></li>`;
  const aoiN = [...alerts, ...warns].filter((e) => e.src === 'AOI').length;
  el.innerHTML = `
    <div class="board-total"><span>TRACKED OBJECTS</span><b>${total.toLocaleString()}</b><span>ALERTS ${alerts.length} · WARN ${warns.length}${aoiN ? ` · <i class="aoi-n">AOI ${aoiN}</i>` : ''}</span></div>
    <div class="board-cats">${CATEGORIES.map((cat) => {
      const s = series.get(cat)!;
      const trend = s.length > 1 ? s[s.length - 1] - s[0] : 0;
      return `<div class="bc ${c[cat] ? '' : 'zero'}"><span class="bc-n">${esc(cat)}</span><b>${fmtN(c[cat])}</b>${sparkline(s)}<span class="bc-t">${trend > 0 ? '▲' : trend < 0 ? '▼' : '·'}</span></div>`;
    }).join('')}</div>
    <div class="sub">CRITICAL</div>
    <ol class="board-log alert">${alerts.length ? alerts.slice(-12).reverse().map(row).join('') : '<li class="dim">none this session</li>'}</ol>
    <div class="sub">WARNINGS</div>
    <ol class="board-log warn">${warns.length ? warns.slice(-12).reverse().map(row).join('') : '<li class="dim">none this session</li>'}</ol>
    <p class="dim intel-note">Counts are objects on screen from switched-on feeds; sparklines sample every 30 s this session.</p>`;
}

export function initBoard(viewer: Viewer) {
  bus.on('log', (e) => {
    if (e.level === 'alert') alerts.push(e);
    else if (e.level === 'warn') warns.push(e);
    else return;
    if (alerts.length > 60) alerts.shift();
    if (warns.length > 60) warns.shift();
  });
  sample();
  window.setInterval(() => !document.hidden && sample(), SAMPLE_MS);
  registerTab({ id: 'board', label: 'THREAT BOARD', render, every: 5000 });
  document.getElementById('intel')!.addEventListener('click', (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>('.board-log li.geo');
    if (!li) return;
    closeSheets();
    release();
    viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(Number(li.dataset.lon), Number(li.dataset.lat), 1.2e6), duration: 2 });
  });
  document.getElementById('btn-board')!.onclick = () => toggleIntel('board');
}
