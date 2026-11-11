// INTEL panel: tabs for watch areas, the watchlist and (later) the threat board.
// Desktop: floating panel toggled from the top bar. Mobile: a bottom sheet (see mobile.ts).
import { bus } from '../core/bus';
import { esc, ago, fmtLL } from '../core/fmt';
import { aois, drawCircle, drawPolygon, flyToAoi, removeAoi, renameAoi, describeShape } from '../spy/aoi';
import { aoiContents } from '../spy/alerts';
import { watchPins, pinStatus, selectPin, unpin } from '../spy/watchlist';
import { closeSheets } from './mobile';

interface Tab {
  id: string;
  label: string;
  render(el: HTMLElement): void;
  /** re-render cadence while visible (ms), 0 = only on events */
  every?: number;
}

const tabs: Tab[] = [];
let current = 'aoi';
let root: HTMLElement;
let body: HTMLElement;
let head: HTMLElement;
let timer: number | undefined;

const small = () => matchMedia('(max-width: 860px)').matches;

export function registerTab(t: Tab) {
  tabs.push(t);
  if (head) paintHead();
}

/** Extra per-AOI row actions contributed by other features (e.g. REVISIT). */
const aoiActions: { label: string; run: (id: string) => void }[] = [];
export function registerAoiAction(a: { label: string; run: (id: string) => void }) {
  aoiActions.push(a);
}

function paintHead() {
  head.innerHTML = tabs.map((t) => `<button data-tab="${t.id}" class="${t.id === current ? 'on' : ''}">${esc(t.label)}</button>`).join('');
  head.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => show(b.dataset.tab!)));
}

function renderNow() {
  if (root.hidden && !root.classList.contains('sheet')) return;
  const t = tabs.find((x) => x.id === current);
  if (!t) return;
  // keep an inline rename input alive while the user types
  if (body.querySelector('input:focus')) return;
  t.render(body);
}

function show(id: string) {
  current = id;
  paintHead();
  clearInterval(timer);
  renderNow();
  const t = tabs.find((x) => x.id === id);
  if (t?.every) timer = window.setInterval(renderNow, t.every);
}

export function openIntel(tab?: string) {
  if (small()) {
    (document.querySelector('#mobilebar [data-sheet="intel"]') as HTMLButtonElement | null)?.classList.contains('on') ||
      (document.querySelector('#mobilebar [data-sheet="intel"]') as HTMLButtonElement | null)?.click();
  } else {
    root.hidden = false;
    document.getElementById('btn-intel')?.classList.add('on');
  }
  show(tab ?? current);
}

export function toggleIntel(tab?: string) {
  if (!small() && !root.hidden && (!tab || tab === current)) {
    root.hidden = true;
    clearInterval(timer);
    document.getElementById('btn-intel')?.classList.remove('on');
    return;
  }
  openIntel(tab);
}

/** Start a globe tool from the panel: on phones the sheet has to get out of the way first. */
const startTool = (fn: () => void) => {
  closeSheets();
  fn();
};

function aoiTab(el: HTMLElement) {
  const list = aois();
  el.innerHTML = `
    <div class="intel-tools">
      <button class="btn" data-a="circle">+ CIRCLE</button>
      <button class="btn" data-a="poly">+ POLYGON</button>
    </div>
    ${
      list.length
        ? list
            .map((a) => {
              const inside = aoiContents(a)
                .map((c) => `${c.n} ${c.layer}`)
                .join(' · ');
              return `<div class="aoi-row" data-id="${a.id}">
                <div class="aoi-name"><b>◇ ${esc(a.name)}</b><span class="dim">${esc(describeShape(a.shape))}</span>
                ${inside ? `<span class="aoi-in">inside: ${esc(inside)}</span>` : ''}</div>
                <div class="aoi-acts">
                  <button class="btn" data-r="fly">FLY</button>
                  ${aoiActions.map((x, i) => `<button class="btn" data-x="${i}">${esc(x.label)}</button>`).join('')}
                  <button class="btn" data-r="ren">RENAME</button>
                  <button class="btn danger" data-r="del">DEL</button>
                </div></div>`;
            })
            .join('')
        : `<p class="dim intel-empty">No watch areas yet. Draw one on the globe, or type<br><code>aoi add Kyiv 50.45,30.52 60</code></p>`
    }
    <p class="dim intel-note">Alerts fire for military aircraft entering, earth-obs/military satellites overhead, and quakes, fire hotspots, GDACS and EONET events inside — for feeds that are switched on.</p>`;
  el.querySelector<HTMLElement>('[data-a="circle"]')!.onclick = () => startTool(() => drawCircle());
  el.querySelector<HTMLElement>('[data-a="poly"]')!.onclick = () => startTool(() => drawPolygon());
  el.querySelectorAll<HTMLElement>('.aoi-row').forEach((row) => {
    const id = row.dataset.id!;
    const a = list.find((x) => x.id === id)!;
    row.querySelector<HTMLElement>('[data-r="fly"]')!.onclick = () => (closeSheets(), flyToAoi(a));
    row.querySelector<HTMLElement>('[data-r="del"]')!.onclick = () => removeAoi(id);
    row.querySelectorAll<HTMLElement>('[data-x]').forEach((b) => (b.onclick = () => aoiActions[Number(b.dataset.x)].run(id)));
    row.querySelector<HTMLElement>('[data-r="ren"]')!.onclick = () => {
      const name = row.querySelector('.aoi-name b')!;
      const inp = document.createElement('input');
      inp.className = 'filter aoi-rename';
      inp.value = a.name;
      inp.maxLength = 40;
      name.replaceWith(inp);
      inp.focus();
      inp.select();
      const done = (ok: boolean) => {
        inp.onblur = null;
        if (ok) renameAoi(id, inp.value);
        else renderNow();
      };
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      };
      inp.onblur = () => done(true);
    };
  });
}

const STATE_LABEL = { live: 'LIVE', stale: 'STALE', lost: 'LOST CONTACT', static: 'FIXED', pending: 'PENDING' };

function watchTab(el: HTMLElement) {
  const pins = watchPins();
  if (!pins.length) {
    el.innerHTML = `<p class="dim intel-empty">Nothing pinned. Open any target's dossier and press <b>PIN</b>.<br>Satellites are re-found by NORAD id and aircraft by ICAO hex after a reload.</p>`;
    return;
  }
  el.innerHTML = pins
    .map((p) => {
      const st = pinStatus(p.id);
      const f = st?.fix ?? p.last;
      const state = st?.state ?? 'pending';
      const alt = f?.alt != null ? (p.layer === 'sat' ? `${(f.alt / 1000).toFixed(0)} km` : f.alt > 0 ? `${Math.round(f.alt / 0.3048).toLocaleString()} ft` : 'surface') : '—';
      return `<div class="pin-row st-${state}" data-id="${esc(p.id)}">
        <div class="pin-main"><b>${esc(p.title)}</b><span class="dim">${esc(p.kind)} · ${esc(p.ref)}</span>
          <span class="pin-pos">${f ? `${fmtLL(f.lat, f.lon)} · ${alt}` : 'no fix yet'}</span>
          <span class="dim">${state === 'lost' ? `last fix ${ago(f?.t)}` : state === 'live' || state === 'stale' ? `fix ${ago(f?.t)}` : ''}${st?.note ? ` · ${esc(st.note)}` : ''}</span></div>
        <div class="pin-side"><span class="pin-st">${STATE_LABEL[state]}</span><button class="x" aria-label="Unpin">×</button></div>
      </div>`;
    })
    .join('');
  el.querySelectorAll<HTMLElement>('.pin-row').forEach((row) => {
    const p = pins.find((x) => x.id === row.dataset.id)!;
    row.onclick = () => (closeSheets(), void selectPin(p));
    row.querySelector<HTMLElement>('.x')!.onclick = (e) => {
      e.stopPropagation();
      unpin(p.id);
    };
  });
}

export function initIntel() {
  root = document.getElementById('intel')!;
  head = root.querySelector('.intel-tabs')!;
  body = root.querySelector('.intel-body')!;
  registerTab({ id: 'aoi', label: 'WATCH AREAS', render: aoiTab, every: 5000 });
  registerTab({ id: 'watch', label: 'WATCHLIST', render: watchTab });
  paintHead();
  document.getElementById('btn-intel')!.onclick = () => toggleIntel();
  root.querySelector<HTMLElement>('.panel-head .x')!.onclick = () => (small() ? closeSheets() : toggleIntel());
  bus.on('aoi', () => current === 'aoi' && renderNow());
  bus.on('watch', () => current === 'watch' && renderNow());
  // the sheet opened from the mobile bar needs a first paint
  new MutationObserver(() => root.classList.contains('sheet') && show(current)).observe(root, { attributes: true, attributeFilter: ['class'] });
  show(current);
}

