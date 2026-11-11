// Terminal-style command line ("/" to open).
import { Cartesian3, type Viewer } from 'cesium';
import { esc, fmtLL, utc, dur } from '../core/fmt';
import { findAny, findLayer, toggle, isOn, layerStates } from '../layers/manager';
import { select, lock, release, selected, flyToDossier } from '../core/target';
import { setMode, MODES } from '../fx/postfx';
import { goLive, setRate, setSimTime, simNow } from '../core/clock';
import { locate, getObserverSync } from '../core/observer';
import { getData } from '../data/fetcher';
import { settings, saveSettings, type Settings } from '../core/store';
import { setBase, historyDate } from '../core/viewer';
import { log } from '../core/bus';
import { openSettings, applyFxClass } from './settings';
import { openAR } from '../ar/skyview';
import type { Dossier } from '../layers/Layer';

let viewer: Viewer;
const history: string[] = [];
let hIdx = 0;

const HELP: [string, string][] = [
  ['track <target>', 'lock camera on a satellite / aircraft / anything (e.g. track ISS, track 25544, track UAL123)'],
  ['find <target>', 'locate and open dossier without locking'],
  ['goto <place | lat,lon> [km]', 'fly to a location (e.g. goto Tokyo, goto 38.9,-77.03 50)'],
  ['pov [sat]', 'ride along with a satellite looking down'],
  ['passes [sat]', 'next passes over your GPS position'],
  ['overhead', 'satellites above your horizon right now'],
  ['aoi add <name> <lat,lon> <km>', 'arm a circular watch area (alerts in the log)'],
  ['aoi draw [circle|poly]', 'draw a watch area on the globe'],
  ['aoi list | aoi del <name> | aoi fly <name>', 'manage watch areas'],
  ['revisit [lat,lon | aoi] [minEl]', 'earth-obs + military satellite passes over a point, next 24 h'],
  ['measure', 'great-circle distance / bearing / area tool (Esc clears)'],
  ['pin | unpin', 'add / remove the selected target to the watchlist'],
  ['intel [aoi|watch]', 'open the intel panel'],
  ['layer <name> on|off', 'toggle a feed (layer flights on, layer quakes off)'],
  ['layers', 'list all feeds and their status'],
  ['mode <id>', `imaging mode: ${MODES.map((m) => m.id).join(' | ')}`],
  ['base <sat|dark|truecolor|osm|history>', 'switch base imagery (history = NASA daily imagery for the timeline date; try time -30d)'],
  ['time <+/-Nh|m> | rate <x> | live', 'time travel / compression / resync'],
  ['release', 'release lock / exit POV'],
  ['fx on|off', 'toggle visual effects'],
  ['ar', 'AR sky view (mobile, camera + compass)'],
  ['settings', 'API keys, proxy, display options'],
  ['clear', 'clear this console'],
];

export function initCommandLine(v: Viewer) {
  viewer = v;
  const root = document.getElementById('cmd')!;
  const input = document.getElementById('cmd-input') as HTMLInputElement;
  const out = document.getElementById('cmd-out')!;

  const show = () => {
    root.hidden = false;
    input.value = '';
    setTimeout(() => input.focus(), 10);
    if (!out.innerHTML) print(`<span class="h">ARGUS command uplink. type <b>help</b> for commands. ESC to close.</span>`);
  };
  const hide = () => {
    root.hidden = true;
    input.blur();
  };
  const print = (html: string) => {
    out.insertAdjacentHTML('beforeend', `<div>${html}</div>`);
    out.scrollTop = out.scrollHeight;
  };
  (window as any).__argusCmdPrint = print;

  document.getElementById('btn-cmd')!.onclick = show;
  document.getElementById('mb-cmd')!.onclick = show;
  root.onclick = (e) => e.target === root && hide();
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
      show();
    } else if (e.key === 'Escape' && !root.hidden) hide();
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowUp') {
      hIdx = Math.max(0, hIdx - 1);
      input.value = history[hIdx] ?? '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      hIdx = Math.min(history.length, hIdx + 1);
      input.value = history[hIdx] ?? '';
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const line = input.value.trim();
      input.value = '';
      if (!line) return;
      history.push(line);
      hIdx = history.length;
      print(`<span class="prompt">$</span> ${esc(line)}`);
      try {
        const close = await run(line, print);
        if (close) hide();
      } catch (err) {
        print(`<span class="e">error: ${esc((err as Error).message)}</span>`);
      }
    }
  });
}

async function geocode(q: string) {
  const r = await getData<any[]>(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { ttl: 86400_000, persist: true });
  return r.data[0];
}

async function resolveSat(q: string | undefined): Promise<Dossier | undefined> {
  if (!q) {
    const s = selected();
    return s?.layer === 'sat' ? s : undefined;
  }
  const d = await findAny(q);
  return d?.layer === 'sat' ? d : undefined;
}

/** Returns true when the console should close (camera action happening). */
export async function run(line: string, print: (h: string) => void): Promise<boolean> {
  const [cmdRaw, ...rest] = line.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const arg = rest.join(' ');
  const ok = (m: string) => print(`<span class="o">${m}</span>`);
  const err = (m: string) => print(`<span class="e">${m}</span>`);

  switch (cmd) {
    case 'help':
    case '?':
      print(HELP.map(([c, d]) => `<span class="h"><b>${esc(c.padEnd(32))}</b> ${esc(d)}</span>`).join('\n'));
      return false;
    case 'clear':
    case 'cls':
      document.getElementById('cmd-out')!.innerHTML = '';
      return false;
    case 'track':
    case 'lock':
    case 'find':
    case 'f': {
      if (!arg) return err('usage: track <target>'), false;
      const d = await findAny(arg);
      if (!d) return err(`no target matching "${esc(arg)}" in active feeds`), false;
      select(d);
      if (cmd === 'track' || cmd === 'lock') {
        // let the newly selected target settle
        setTimeout(() => lock(), 50);
        ok(`target lock: ${esc(d.title)}`);
      } else {
        flyToDossier(d);
        ok(`located: ${esc(d.title)}`);
      }
      return true;
    }
    case 'goto':
    case 'go':
    case 'fly': {
      if (!arg) return err('usage: goto <place | lat,lon> [km]'), false;
      const m = arg.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/);
      let lat: number, lon: number, km: number;
      let name = '';
      if (m) {
        lat = +m[1];
        lon = +m[2];
        km = m[3] ? +m[3] : 30;
      } else {
        const altM = arg.match(/\s(\d+(?:\.\d+)?)\s*km$/i);
        const q = altM ? arg.slice(0, altM.index) : arg;
        const g = await geocode(q);
        if (!g) return err(`could not resolve "${esc(q)}"`), false;
        lat = +g.lat;
        lon = +g.lon;
        name = g.display_name;
        const bb = g.boundingbox?.map(Number);
        km = altM ? +altM[1] : bb ? Math.max(3, Math.min(4000, Math.abs(bb[1] - bb[0]) * 111 * 2.2)) : 50;
      }
      release();
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat, km * 1000), duration: 2.5 });
      ok(`slewing to ${esc(name || fmtLL(lat, lon))} @ ${km.toFixed(0)} km`);
      log('NAV', `slew → ${name ? name.split(',')[0] : fmtLL(lat, lon)}`, 'info', { lat, lon });
      return true;
    }
    case 'pov': {
      const d = await resolveSat(arg || undefined);
      if (!d) return err('select a satellite first or: pov <name|norad>'), false;
      select(d);
      d.actions?.find((a) => a.label === 'POV')?.run();
      return true;
    }
    case 'passes': {
      const { satEngine } = await import('../layers/satellites/engine');
      // look the satellite up without selecting it (no orbit drawing / dossier side effects)
      const cur = selected();
      const idx = arg ? satEngine.findIndex(arg) : cur?.layer === 'sat' ? Number(cur.key) : satEngine.findIndex('ISS');
      if (idx < 0) return err(satEngine.meta.length ? 'no such satellite' : 'satellite feed not loaded'), false;
      const obs = await locate();
      const ps = await satEngine.passes(idx, obs.lat, obs.lon, obs.h, 72);
      print(`<span class="h">passes of <b>${esc(satEngine.meta[idx].name)}</b> over ${fmtLL(obs.lat, obs.lon)} (${obs.source}), next 72h:</span>`);
      if (!ps.length) print('<span class="h">none above 5°</span>');
      for (const p of ps) print(`  ${utc(p.aos)}  dur ${dur((p.los - p.aos) / 1000).padEnd(8)} max ${p.maxEl.toFixed(0)}°`);
      return false;
    }
    case 'overhead':
    case 'above': {
      const obs = await locate();
      const { satEngine } = await import('../layers/satellites/engine');
      if (!satEngine.meta.length) return err('satellite feed not loaded'), false;
      const list = await satEngine.overhead(obs.lat, obs.lon, obs.h, 10);
      print(`<span class="h"><b>${list.length}</b> objects above 10° over ${fmtLL(obs.lat, obs.lon)} (${obs.source}). top 15:</span>`);
      for (const o of list.slice(0, 15)) print(`  ${esc(satEngine.meta[o.idx].name.padEnd(26))} el ${o.el.toFixed(0).padStart(3)}°  az ${o.az.toFixed(0).padStart(3)}°  ${o.alt.toFixed(0)} km`);
      return false;
    }
    case 'aoi': {
      const A = await import('../spy/aoi');
      const [sub, ...more] = rest;
      const sa = (sub ?? 'list').toLowerCase();
      const tail = more.join(' ');
      if (sa === 'add') {
        const m = tail.match(/^(.*?)\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*(?:km)?$/i);
        if (!m) return err('usage: aoi add <name> <lat,lon> <km>   e.g. aoi add Kyiv 50.45,30.52 60'), false;
        const lat = +m[2], lon = +m[3], km = +m[4];
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || !(km > 0) || km > 5000) return err('lat ±90, lon ±180, 0 < km ≤ 5000'), false;
        const a = A.addAoi(m[1] || '', { kind: 'circle', lat, lon, km });
        ok(`watch area ${esc(a.name)} armed: ${fmtLL(lat, lon)} r=${km} km`);
        A.flyToAoi(a);
        return true;
      }
      if (sa === 'draw') {
        if (/^p/i.test(tail)) A.drawPolygon();
        else A.drawCircle();
        return true;
      }
      if (sa === 'del' || sa === 'rm' || sa === 'delete') {
        const a = A.findAoi(tail);
        if (!a) return err(`no watch area "${esc(tail)}"`), false;
        A.removeAoi(a.id);
        ok(`${esc(a.name)} removed`);
        return false;
      }
      if (sa === 'fly' || sa === 'goto') {
        const a = A.findAoi(tail);
        if (!a) return err(`no watch area "${esc(tail)}"`), false;
        A.flyToAoi(a);
        return true;
      }
      const all = A.aois();
      if (!all.length) print('<span class="h">no watch areas — aoi add &lt;name&gt; &lt;lat,lon&gt; &lt;km&gt; or aoi draw</span>');
      for (const a of all) print(`  <b>${esc(a.name.padEnd(16))}</b> ${esc(A.describeShape(a.shape))}`);
      return false;
    }
    case 'revisit': {
      const R = await import('../spy/revisit');
      const { findAoi } = await import('../spy/aoi');
      const { shapeCenter } = await import('../core/geo');
      const mEl = arg.match(/\s(\d{1,2})$/);
      const minEl = mEl ? +mEl[1] : 30;
      const q = (mEl ? arg.slice(0, mEl.index) : arg).trim();
      let lat: number, lon: number, label: string;
      const ll = q.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
      const aoi = q && !ll ? findAoi(q) : undefined;
      if (ll) ((lat = +ll[1]), (lon = +ll[2]), (label = fmtLL(lat, lon)));
      else if (aoi) {
        const c = shapeCenter(aoi.shape);
        ((lat = c.lat), (lon = c.lon), (label = `AOI ${aoi.name}`));
      } else if (q) return err(`"${esc(q)}" is not lat,lon or a watch area name`), false;
      else {
        const o = getObserverSync();
        ((lat = o.lat), (lon = o.lon), (label = `observer ${fmtLL(lat, lon)}`));
      }
      print(`<span class="h">screening earth-obs + military catalog over ${esc(label)} (≥${minEl}°, 24 h)…</span>`);
      const res = await R.computeRevisit(lat, lon, 24, minEl);
      if (typeof res === 'string') return err(res), false;
      const s = R.summarize(res.rows, 24);
      print(`<span class="h"><b>${s.passes}</b> passes by <b>${s.sats}</b> satellites${s.geo ? ` + ${s.geo} GEO` : ''} · median gap ${Number.isFinite(s.median) ? (s.median * 60).toFixed(0) + ' min' : '—'}. first 25:</span>`);
      for (const l of R.revisitLines(res.rows)) print(esc(l));
      return false;
    }
    case 'measure':
    case 'ruler': {
      const { startMeasure } = await import('../spy/measure');
      startMeasure();
      return true;
    }
    case 'pin':
    case 'unpin': {
      const d = selected();
      if (!d) return err('select a target first'), false;
      const { togglePin, isPinned } = await import('../spy/watchlist');
      if ((cmd === 'pin') === isPinned(d)) return ok(`${esc(d.title)} already ${cmd === 'pin' ? 'pinned' : 'not pinned'}`), false;
      togglePin(d);
      ok(`${esc(d.title)} ${cmd === 'pin' ? 'pinned' : 'unpinned'}`);
      return false;
    }
    case 'intel':
    case 'watch':
    case 'watchlist': {
      const { openIntel } = await import('./intel');
      openIntel(cmd === 'intel' ? (arg || undefined) : 'watch');
      return true;
    }
    case 'layer':
    case 'l': {
      const m = arg.match(/^(.*?)\s+(on|off)$/i);
      const name = m ? m[1] : arg;
      const meta = findLayer(name);
      if (!meta) return err(`unknown layer "${esc(name)}" — try: layers`), false;
      const on = m ? m[2].toLowerCase() === 'on' : !isOn(meta.id);
      await toggle(meta.id, on);
      ok(`${meta.name} ${on ? 'ONLINE' : 'OFFLINE'}`);
      return false;
    }
    case 'layers':
    case 'status':
      print(
        layerStates()
          .map((s) => `<span class="h"><b>${(s.on ? '■ ' : '□ ') + s.meta.id.padEnd(14)}</b> ${esc(s.meta.name.padEnd(30))} ${s.on ? s.status.toUpperCase() : ''} ${s.count ? s.count : ''}</span>`)
          .join('\n'),
      );
      return false;
    case 'mode': {
      const m = MODES.find((x) => x.id === arg.toLowerCase() || x.label.toLowerCase().includes(arg.toLowerCase()));
      if (!m) return err(`modes: ${MODES.map((x) => x.id).join(', ')}`), false;
      setMode(m.id);
      ok(`sensor → ${m.label}`);
      return false;
    }
    case 'base': {
      const b = arg.toLowerCase() as Settings['base'];
      if (!['sat', 'dark', 'truecolor', 'osm', 'history'].includes(b)) return err('base sat|dark|truecolor|osm|history'), false;
      saveSettings({ base: b });
      setBase(b);
      ok(b === 'history' ? `base imagery → NASA MODIS Terra ${historyDate()} (follows the timeline)` : `base imagery → ${b}`);
      return false;
    }
    case 'time': {
      const m = arg.match(/^([+-]?\d+(?:\.\d+)?)\s*([hmd]?)$/i);
      if (!m) return err('usage: time +2h | time -30m | time +1d'), false;
      const mult = { h: 3600_000, m: 60_000, d: 86400_000, '': 3600_000 }[m[2].toLowerCase() as 'h'];
      setSimTime(simNow() + Number(m[1]) * mult);
      ok(`sim time → ${utc(simNow())}`);
      return false;
    }
    case 'rate': {
      const r = Number(arg);
      if (!Number.isFinite(r)) return err('usage: rate 60'), false;
      setRate(r);
      ok(`time compression ${r}×`);
      return false;
    }
    case 'live':
    case 'now':
      goLive();
      ok('real time');
      return false;
    case 'release':
    case 'unlock':
    case 'esc':
      release();
      ok('released');
      return true;
    case 'home':
      release();
      viewer.camera.flyHome(2);
      return true;
    case 'fx':
      saveSettings({ reduceFx: arg === 'off' ? true : arg === 'on' ? false : !settings.reduceFx });
      applyFxClass();
      setMode(settings.mode, true);
      ok(`effects ${settings.reduceFx ? 'reduced' : 'full'}`);
      return false;
    case 'whoami':
    case 'observer': {
      const o = getObserverSync();
      ok(`observer ${fmtLL(o.lat, o.lon)} (${o.source})`);
      return false;
    }
    case 'locate':
    case 'me': {
      const o = await locate();
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(o.lon, o.lat, 2e5), duration: 2 });
      return true;
    }
    case 'ar':
      openAR();
      return true;
    case 'settings':
    case 'config':
      openSettings();
      return true;
    default: {
      // bare target name → find
      const d = await findAny(line);
      if (d) {
        select(d);
        flyToDossier(d);
        ok(`located: ${esc(d.title)}`);
        return true;
      }
      err(`unknown command "${esc(cmd)}" — type help`);
      return false;
    }
  }
}
