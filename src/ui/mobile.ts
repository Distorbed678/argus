// Mobile bottom-bar → bottom sheets; desktop panel close buttons; sensor-mode panel.
import { bus } from '../core/bus';
import { MODES, setMode } from '../fx/postfx';
import { settings } from '../core/store';
import { select } from '../core/target';

const SHEETS = ['layers', 'log', 'modes', 'timeline'];
const small = () => matchMedia('(max-width: 860px)').matches;
let openSheetFn: (id: string | null) => void = () => {};

/** Close any open bottom sheet. Returns true if one was open (so a map tap only dismisses it). */
export function closeSheets(): boolean {
  if (!small() || !document.querySelector('.panel.sheet')) return false;
  openSheetFn(null);
  return true;
}

export function initPanels() {
  const bar = document.getElementById('mobilebar')!;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button[data-sheet]')];
  const restoreBtns = new Map<string, HTMLButtonElement>();

  const unhide = (id: string) => {
    document.getElementById(id)!.hidden = false;
    restoreBtns.get(id)?.remove();
    restoreBtns.delete(id);
  };

  const openSheet = (openSheetFn = (id: string | null) => {
    if (id) unhide(id); // a panel closed on desktop must still open as a sheet
    for (const s of SHEETS) document.getElementById(s)!.classList.toggle('sheet', s === id);
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.sheet === id));
    document.body.classList.toggle('sheet-open', !!id);
    if (id && small()) select(null);
  });
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.sheet!;
      openSheet(document.getElementById(id)!.classList.contains('sheet') ? null : id);
    }),
  );
  // a dossier on mobile replaces any open sheet
  bus.on('select', (d) => {
    if (d && small()) openSheet(null);
  });
  // leaving the mobile layout: drop sheet state; entering it: restore hidden desktop panels
  matchMedia('(max-width: 860px)').addEventListener('change', (e) => {
    if (e.matches) for (const id of [...restoreBtns.keys()]) unhide(id);
    else openSheet(null);
  });

  // close buttons: on mobile close the sheet, on desktop collapse the panel to a top-bar tab
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((x) => {
    x.onclick = () => {
      const id = x.dataset.close!;
      if (small()) return openSheet(null);
      document.getElementById(id)!.hidden = true;
      if (restoreBtns.has(id)) return;
      const b = document.createElement('button');
      b.className = 'icon-btn restore-btn';
      b.textContent = { layers: '☰', log: '≡', modes: '◐' }[id] ?? id.slice(0, 3).toUpperCase();
      b.title = `Show ${id}`;
      b.setAttribute('aria-label', `Show ${id} panel`);
      b.onclick = () => unhide(id);
      restoreBtns.set(id, b);
      document.querySelector('.top-actions')!.prepend(b);
    };
  });

  // space weather chip: tap to expand on mobile
  document.getElementById('hud-wx')!.addEventListener('click', (e) => {
    if (small() && (e.target as HTMLElement).closest('.hud-title')) document.getElementById('hud-wx')!.classList.toggle('open');
  });

  // sensor modes
  const list = document.getElementById('mode-list')!;
  for (const m of MODES) {
    const b = document.createElement('button');
    b.dataset.id = m.id;
    b.textContent = m.label;
    b.onclick = () => setMode(m.id);
    list.appendChild(b);
  }
  const paint = (id: string) => list.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  paint(settings.mode);
  bus.on('mode', paint);
}
