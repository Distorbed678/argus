// Revisit forecast: which earth-obs / military satellites pass over a point in the next 24 h.
// Pass maths runs in the SGP4 worker (chunked); this module only formats the result.
import { Cartesian3 } from 'cesium';
import { esc, fmtLL, utc, dur, ago } from '../core/fmt';
import { simNow } from '../core/clock';
import { select } from '../core/target';
import { log } from '../core/bus';
import { pickById } from '../layers/manager';
import type { Dossier } from '../layers/Layer';
import { SAT_CATS, CAT_INDEX } from '../layers/satellites/categories';

export interface RevisitRow {
  idx: number;
  name: string;
  norad: number;
  cat: string;
  aos: number;
  los: number;
  maxEl: number;
  persistent?: boolean;
}

export async function computeRevisit(lat: number, lon: number, hours = 24, minEl = 30): Promise<{ rows: RevisitRow[]; candidates: number } | string> {
  const { satEngine } = await import('../layers/satellites/engine');
  if (!satEngine.ready) return 'satellite catalog not loaded — switch on a satellite layer first';
  const idxs = satEngine.indicesOf(['earthobs', 'military']);
  const t0 = performance.now();
  const passes = await satEngine.revisit(idxs, lat, lon, hours, minEl);
  console.info(`[revisit] ${idxs.length} candidates · ${passes.length} passes · ${(performance.now() - t0).toFixed(0)} ms in worker`);
  const rows = passes.map((p) => {
    const m = satEngine.meta[p.idx];
    return { idx: p.idx, name: m.name, norad: m.norad, cat: m.cat, aos: p.aos, los: p.los, maxEl: p.maxEl, persistent: p.persistent };
  });
  return { rows, candidates: idxs.length };
}

export function summarize(rows: RevisitRow[], hours: number) {
  const moving = rows.filter((r) => !r.persistent);
  const sats = new Set(moving.map((r) => r.norad)).size;
  const gaps: number[] = [];
  for (let i = 1; i < moving.length; i++) gaps.push((moving[i].aos - moving[i - 1].aos) / 3600_000);
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : NaN;
  const maxGap = gaps.length ? gaps[gaps.length - 1] : NaN;
  return { passes: moving.length, sats, geo: rows.length - moving.length, median, maxGap, hours };
}

const catColor = (c: string) => SAT_CATS[CAT_INDEX[c as keyof typeof CAT_INDEX]]?.color ?? '#8aa4c8';

function table(rows: RevisitRow[]) {
  return `<table class="rv-table"><tr><th>AOS UTC</th><th>SATELLITE</th><th>MAX</th><th>DUR</th></tr>${rows
    .filter((r) => !r.persistent)
    .slice(0, 150)
    .map(
      (r) =>
        `<tr data-idx="${r.idx}"><td>${r.persistent ? 'GEO' : utc(r.aos).slice(11, 16)}</td><td><i style="background:${catColor(r.cat)}"></i>${esc(r.name)}</td><td>${r.maxEl.toFixed(0)}°</td><td>${r.persistent ? 'stare' : dur((r.los - r.aos) / 1000)}</td></tr>`,
    )
    .join('')}</table>`;
}

/** Opens a REVISIT FORECAST dossier for a point and fills it when the worker answers. */
export function openRevisit(lat: number, lon: number, label: string, minEl = 30, hours = 24) {
  const extra = document.createElement('div');
  extra.className = 'revisit';
  extra.innerHTML = '<div class="dim">propagating earth-obs + military catalog in the worker…</div>';
  const d: Dossier = {
    layer: 'revisit',
    key: `${lat.toFixed(3)},${lon.toFixed(3)}`,
    kind: 'REVISIT FORECAST',
    title: label,
    subtitle: `${fmtLL(lat, lon)} · next ${hours} h from ${utc(simNow()).slice(0, 16)}`,
    classification: 'SECRET // OVERHEAD COLLECTION WINDOWS (PUBLIC ELEMENTS)',
    fields: [
      ['CANDIDATES', 'earth-obs + military/recon (public TLEs)'],
      ['MIN ELEVATION', `${minEl}° at the point`],
    ],
    position: () => Cartesian3.fromDegrees(lon, lat),
    range: 3e6,
    extra,
    actions: [
      { label: minEl > 15 ? 'MIN EL 10°' : 'MIN EL 30°', run: () => openRevisit(lat, lon, label, minEl > 15 ? 10 : 30, hours) },
    ],
  };
  select(d);
  void computeRevisit(lat, lon, hours, minEl).then((res) => {
    if (typeof res === 'string') {
      extra.innerHTML = `<div class="dim">${esc(res)}</div>`;
      return;
    }
    const s = summarize(res.rows, hours);
    const next = res.rows.find((r) => !r.persistent && r.los > simNow());
    extra.innerHTML = `
      <div class="sub">SUMMARY</div>
      <div class="kv"><span>PASSES ≥${minEl}°</span><b>${s.passes} by ${s.sats} LEO satellites</b></div>
      <div class="kv"><span>GEO IN VIEW</span><b>${s.geo ? `${s.geo} (continuous, ≥${minEl}°)` : 'none'}</b></div>
      <div class="kv"><span>MEDIAN GAP</span><b>${Number.isFinite(s.median) ? `${(s.median * 60).toFixed(0)} min` : '—'}</b></div>
      <div class="kv"><span>LONGEST GAP</span><b>${Number.isFinite(s.maxGap) ? `${s.maxGap.toFixed(1)} h` : '—'}</b></div>
      <div class="kv"><span>NEXT PASS</span><b>${next ? `${esc(next.name)} ${ago(next.aos)}` : '—'}</b></div>
      <div class="sub">PASS TABLE (${res.candidates} SATELLITES SCREENED)</div>
      ${res.rows.length ? table(res.rows) : '<div class="dim">no passes above the elevation mask</div>'}
      <div class="dim rv-note">SGP4 on public CelesTrak elements; times ±1 min. Classified orbits are not in the public catalog.</div>`;
    extra.querySelectorAll<HTMLElement>('tr[data-idx]').forEach((tr) => {
      tr.onclick = async () => {
        const sd = await pickById('sat', tr.dataset.idx!);
        if (sd) select(sd);
      };
    });
    log('REVISIT', `${label}: ${s.passes} imaging-class passes ≥${minEl}° in ${hours} h by ${s.sats} satellites`, 'info', { lat, lon });
  });
  return d;
}

/** Plain-text rows for the command line. */
export function revisitLines(rows: RevisitRow[], max = 25) {
  return rows
    .filter((r) => !r.persistent)
    .slice(0, max).map((r) => `  ${r.persistent ? 'GEO stare       ' : utc(r.aos).slice(5, 16).replace('T', ' ')}  ${r.name.padEnd(24).slice(0, 24)} max ${r.maxEl.toFixed(0).padStart(2)}°  ${r.persistent ? '' : dur((r.los - r.aos) / 1000)}`);
}
