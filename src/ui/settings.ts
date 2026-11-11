import { clear as idbClear } from 'idb-keyval';
import { settings, saveSettings, type Settings } from '../core/store';
import { setBase, setLabels, applyQuality } from '../core/viewer';
import { setMode } from '../fx/postfx';
import { log } from '../core/bus';
import { esc } from '../core/fmt';
import { proxyBase } from '../data/fetcher';

export function applyFxClass() {
  document.body.classList.toggle('reduce-fx', settings.reduceFx);
}

export function openSettings() {
  const root = document.getElementById('settings')!;
  const k = settings.keys;
  root.innerHTML = `
  <div class="settings-box panel">
    <div class="panel-head"><span class="hud-title">SYSTEM CONFIGURATION</span><button class="x" aria-label="Close">×</button></div>
    <div class="panel-inner">
      <h3>DISPLAY</h3>
      <div class="field"><label>Base imagery</label>
        <select id="s-base">
          <option value="sat">Satellite (Esri World Imagery)</option>
          <option value="dark">Tactical dark (Esri dark gray)</option>
          <option value="truecolor">NASA VIIRS true colour (daily)</option>
          <option value="osm">OpenStreetMap (tinted)</option>
        </select></div>
      <label class="toggle"><input type="checkbox" id="s-labels"> Place-name labels overlay</label>
      <label class="toggle"><input type="checkbox" id="s-fx"> Reduce effects (no rain, glitch, scanlines, CRT)</label>
      <label class="toggle"><input type="checkbox" id="s-hq"> High quality (full device resolution + FXAA) — heavier on phones</label>

      <h3>API KEYS (OPTIONAL · STORED ONLY IN THIS BROWSER)</h3>
      <div class="field"><label>Cesium ion token — world terrain + 3D buildings (free at cesium.com/ion)</label><input type="password" id="k-ion" value="${esc(k.ion)}" autocomplete="off"></div>
      <div class="field"><label>aisstream.io key — global live ships in view (free at aisstream.io)</label><input type="password" id="k-ais" value="${esc(k.aisstream)}" autocomplete="off"></div>
      <div class="field"><label>Windy Webcams key — worldwide webcams (free at api.windy.com)</label><input type="password" id="k-windy" value="${esc(k.windy)}" autocomplete="off"></div>

      <h3>CORS RELAY</h3>
      <div class="field"><label>Proxy URL prefix (blank = built-in <code>./__proxy?url=</code> when served by Vite). Use <code>{url}</code> as placeholder or end with <code>?url=</code>.</label>
        <input type="text" id="s-proxy" value="${esc(settings.proxyUrl)}" placeholder="https://argus-proxy.you.workers.dev/?url=" autocomplete="off"></div>
      <p class="note">Flights, military aircraft, fires and GDELT need a relay because those APIs don't allow browser requests. <code>npm run dev</code> / <code>npm run preview</code> include one; for static hosting deploy <code>proxy/cloudflare-worker.js</code> (free) and paste its URL here. Current: <code>${esc(proxyBase())}</code></p>

      <h3>SIGINT</h3>
      <div class="field"><label>GDELT themes (comma separated, e.g. ARMEDCONFLICT, PROTEST, TERROR, CYBER_ATTACK, MILITARY, REFUGEES)</label><input type="text" id="s-gdelt" value="${esc(settings.gdeltQuery)}"></div>

      <h3>DATA</h3>
      <p class="note">Satellite elements are cached for 2 h (CelesTrak's fair-use limit); other feeds cache briefly to avoid hammering free APIs.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn" id="s-save">SAVE &amp; APPLY</button>
        <button class="btn danger" id="s-clear">PURGE CACHE</button>
        <button class="btn danger" id="s-reset">FACTORY RESET</button>
      </div>
    </div>
  </div>`;
  root.hidden = false;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  $<HTMLSelectElement>('s-base').value = settings.base;
  $<HTMLInputElement>('s-labels').checked = settings.labels;
  $<HTMLInputElement>('s-fx').checked = settings.reduceFx;
  $<HTMLInputElement>('s-hq').checked = settings.highQuality;
  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
  };
  root.querySelector<HTMLElement>('.x')!.onclick = close;
  root.onclick = (e) => e.target === root && close();

  $('s-save').onclick = () => {
    const ionBefore = settings.keys.ion;
    const base = $<HTMLSelectElement>('s-base').value as Settings['base'];
    const patch: Partial<Settings> = {
      base,
      labels: $<HTMLInputElement>('s-labels').checked,
      reduceFx: $<HTMLInputElement>('s-fx').checked,
      highQuality: $<HTMLInputElement>('s-hq').checked,
      proxyUrl: $<HTMLInputElement>('s-proxy').value.trim(),
      gdeltQuery: $<HTMLInputElement>('s-gdelt').value.trim() || settings.gdeltQuery,
      keys: { ion: $<HTMLInputElement>('k-ion').value.trim(), aisstream: $<HTMLInputElement>('k-ais').value.trim(), windy: $<HTMLInputElement>('k-windy').value.trim() },
    };
    const baseChanged = base !== settings.base;
    const labelsChanged = patch.labels !== settings.labels;
    saveSettings(patch);
    if (baseChanged) setBase(base);
    if (labelsChanged) setLabels(settings.labels);
    applyQuality();
    applyFxClass();
    setMode(settings.mode, true);
    log('CONFIG', 'configuration saved', 'ok');
    close();
    if (settings.keys.ion !== ionBefore) {
      log('CONFIG', 'Cesium ion token changed — reloading for terrain', 'warn');
      setTimeout(() => location.reload(), 600);
    }
  };
  $('s-clear').onclick = async () => {
    await idbClear().catch(() => {});
    log('CONFIG', 'local cache purged', 'warn');
  };
  $('s-reset').onclick = () => {
    if (!confirm('Reset all ARGUS settings and keys in this browser?')) return;
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    idbClear().finally(() => location.reload());
  };
}
