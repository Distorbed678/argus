// Interactive globe tools (AOI drawing, measure). While a tool is active the picker routes
// clicks/moves to it instead of selecting targets. Only one tool at a time.

export interface GlobeTool {
  id: string;
  click(lat: number, lon: number): void;
  move?(lat: number, lon: number): void;
  dblclick?(): void;
  /** Esc / switching tools. */
  cancel(): void;
}

let active: GlobeTool | null = null;

export function activeTool() {
  return active;
}

export function setTool(t: GlobeTool | null) {
  if (active && active !== t) {
    const prev = active;
    active = null;
    prev.cancel();
  }
  active = t;
  document.body.classList.toggle('tool-active', !!t);
}

/** Called by the tool itself once it has finished/cancelled. */
export function clearTool(t: GlobeTool) {
  if (active === t) {
    active = null;
    document.body.classList.remove('tool-active');
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !active) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const t = active;
  active = null;
  document.body.classList.remove('tool-active');
  t.cancel();
});

/** Floating hint bar shared by the tools: title, live text and a few buttons. */
export function toolbar(title: string, buttons: { label: string; run: () => void; cls?: string }[] = []) {
  let el = document.getElementById('toolbar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toolbar';
    el.className = 'panel';
    document.body.appendChild(el);
  }
  el.hidden = false;
  el.innerHTML = `<div class="tb-head"><span class="hud-title"></span><span class="tb-btns"></span></div><div class="tb-body"></div>`;
  el.querySelector('.hud-title')!.textContent = title;
  const bw = el.querySelector('.tb-btns')!;
  for (const b of buttons) {
    const x = document.createElement('button');
    x.className = `btn ${b.cls ?? ''}`;
    x.textContent = b.label;
    x.onclick = (ev) => {
      ev.stopPropagation();
      b.run();
    };
    bw.appendChild(x);
  }
  const body = el.querySelector<HTMLElement>('.tb-body')!;
  return {
    set(html: string) {
      body.innerHTML = html;
    },
    close() {
      el!.hidden = true;
      el!.innerHTML = '';
    },
  };
}
