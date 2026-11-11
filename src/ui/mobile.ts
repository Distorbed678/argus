// Mobile bottom-bar → bottom sheets; desktop panel close buttons; sensor-mode panel.
import { bus } from '../core/bus';
import { MODES, setMode } from '../fx/postfx';
import { settings } from '../core/store';
import { select } from '../core/target';

export function initPanels() {
  const bar = document.getElementById('mobilebar')!;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button[data-sheet]')];
  const sheets = ['layers', 'log', 'modes', 'timeline'];
  const small = () => matchMedia('(max-width: 860px)').matches;

  const openSheet = (id: string | null) => {
    for (const s of sheets) document.getElementById(s)!.classList.toggle('sheet', s === id);
    buttons.forEach((b) => b.classList.toggle('on', b.dataset.sheet === id));
    if (id && small()) select(null);
  };
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

  // close buttons: on mobile close the sheet, on desktop collapse the panel
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((x) => {
    x.onclick = () => {
      const id = x.dataset.close!;
      const el = document.getElementById(id)!;
      if (small()) openSheet(null);
      else el.hidden = true;
      if (!small()) restoreBtn(id, el);
    };
  });

  // re-open hidden desktop panels via small tabs
  const restoreBtn = (id: string, el: HTMLElement) => {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.textContent = id.toUpperCase().slice(0, 3);
    b.title = `Show ${id}`;
    b.onclick = () => {
      el.hidden = false;
      b.remove();
    };
    document.querySelector('.top-actions')!.prepend(b);
  };

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
