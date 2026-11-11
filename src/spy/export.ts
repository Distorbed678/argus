// EXPORT: the current globe view + the open dossier rendered into one PNG with a "classified"
// watermark, UTC timestamp and data-source credits.
import { getViewer, cameraInfo } from '../core/viewer';
import { simNow, isLive } from '../core/clock';
import { fmtLL, toLL, utc } from '../core/fmt';
import { log } from '../core/bus';
import { LAYERS } from '../layers/registry';
import type { Dossier } from '../layers/Layer';

const MONO = '"Share Tech Mono", ui-monospace, monospace';
const DISPLAY = 'Orbitron, "Share Tech Mono", monospace';

/** Wrap text to a max width; returns lines. */
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > max && line) {
      out.push(line);
      line = word;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export function sourceOf(layer: string): string {
  if (layer === 'sat') return 'CelesTrak GP elements · SGP4';
  if (layer === 'ground') return 'Open-Meteo · OpenStreetMap Nominatim';
  if (layer === 'revisit') return 'CelesTrak GP elements · SGP4 (worker)';
  return LAYERS.find((l) => l.id === layer)?.source ?? layer;
}

export async function exportDossier(d: Dossier) {
  const viewer = getViewer();
  // Cesium doesn't preserve the drawing buffer: render and copy within the same task
  viewer.render();
  const gl = viewer.scene.canvas;
  const dpr = Math.max(1, Math.min(2, gl.width / Math.max(1, gl.clientWidth)));
  const panelW = Math.round(420 * dpr);
  const W = gl.width + panelW;
  const H = Math.max(gl.height, Math.round(720 * dpr));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#020812';
  g.fillRect(0, 0, W, H);
  g.drawImage(gl, 0, (H - gl.height) / 2);

  const cls = d.classification ?? 'UNCLASSIFIED // OSINT';
  const s = (px: number) => Math.round(px * dpr);
  const band = s(28);

  // dossier panel
  const x0 = gl.width;
  g.fillStyle = 'rgba(3, 14, 30, 0.97)';
  g.fillRect(x0, 0, panelW, H);
  g.strokeStyle = 'rgba(79,195,255,0.6)';
  g.lineWidth = s(1);
  g.strokeRect(x0 + s(0.5), s(0.5), panelW - s(1), H - s(1));
  let y = band + s(26);
  const pad = s(18);
  const inner = panelW - pad * 2;
  g.fillStyle = '#ffb347';
  g.font = `${s(11)}px ${MONO}`;
  g.fillText(d.kind, x0 + pad, y);
  y += s(30);
  g.fillStyle = '#ffffff';
  g.font = `700 ${s(18)}px ${DISPLAY}`;
  for (const l of wrap(g, d.title, inner).slice(0, 3)) (g.fillText(l, x0 + pad, y), (y += s(24)));
  if (d.subtitle) {
    g.fillStyle = '#5f86ad';
    g.font = `${s(11)}px ${MONO}`;
    for (const l of wrap(g, d.subtitle, inner).slice(0, 3)) (g.fillText(l, x0 + pad, y), (y += s(16)));
  }
  y += s(10);
  const rows: [string, string, boolean][] = [...(d.live?.() ?? []).map(([k, v]) => [k, v, true] as [string, string, boolean]), ...d.fields.map(([k, v]) => [k, v, false] as [string, string, boolean])];
  const pos = d.position?.();
  if (pos) {
    const ll = toLL(pos);
    rows.unshift(['POSITION', fmtLL(ll.lat, ll.lon), true]);
  }
  for (const [k, v, live] of rows) {
    if (y > H - band - s(110)) break;
    g.font = `${s(10)}px ${MONO}`;
    g.fillStyle = '#5f86ad';
    g.fillText(k, x0 + pad, y);
    g.font = `${s(12)}px ${MONO}`;
    g.fillStyle = live ? '#7cffb2' : '#9be7ff';
    const lines = wrap(g, v, inner * 0.62);
    for (const [i, l] of lines.slice(0, 3).entries()) {
      g.textAlign = 'right';
      g.fillText(l, x0 + panelW - pad, y + i * s(15));
      g.textAlign = 'left';
    }
    y += Math.max(1, Math.min(3, lines.length)) * s(15) + s(6);
    g.strokeStyle = 'rgba(79,195,255,0.15)';
    g.beginPath();
    g.moveTo(x0 + pad, y - s(10));
    g.lineTo(x0 + panelW - pad, y - s(10));
    g.stroke();
  }

  // footer: timestamp, camera, credits
  const cam = cameraInfo();
  const credits = [`DATA: ${sourceOf(d.layer)}`, `IMAGERY: ${(document.getElementById('credits')?.innerText ?? '').replace(/\s+/g, ' ').trim() || 'Esri / NASA GIBS'}`, 'RENDER: CesiumJS · ARGUS'];
  g.font = `${s(10)}px ${MONO}`;
  g.fillStyle = '#5f86ad';
  let fy = H - band - s(12);
  for (const l of credits.flatMap((t) => wrap(g, t, inner)).slice(0, 6).reverse()) (g.fillText(l, x0 + pad, fy), (fy -= s(14)));
  g.fillStyle = '#9be7ff';
  g.fillText(`EXPORTED ${utc(Date.now())}${isLive() ? '' : ` · SIM ${utc(simNow())}`}`, x0 + pad, fy - s(6));
  g.fillText(`CAMERA ${fmtLL(cam.lat, cam.lon)} · ${Math.round(cam.alt / 1000).toLocaleString()} km`, x0 + pad, fy - s(22));

  // classification bands top + bottom
  const red = !d.classification ? 'rgba(47,128,255,0.85)' : 'rgba(170,20,45,0.92)';
  for (const by of [0, H - band]) {
    g.fillStyle = red;
    g.fillRect(0, by, W, band);
    g.fillStyle = '#ffffff';
    g.font = `${s(13)}px ${MONO}`;
    g.textAlign = 'center';
    g.fillText(cls, W / 2, by + band * 0.68);
    g.textAlign = 'left';
  }

  // diagonal watermark over the globe
  g.save();
  g.translate(gl.width / 2, H / 2);
  g.rotate(-Math.PI / 7);
  g.font = `900 ${s(64)}px ${DISPLAY}`;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255, 59, 92, 0.16)';
  g.fillText('CLASSIFIED', 0, 0);
  g.font = `${s(16)}px ${MONO}`;
  g.fillStyle = 'rgba(255, 255, 255, 0.3)';
  g.fillText(`ARGUS // ${utc(Date.now())} // OPEN-SOURCE DATA`, 0, s(36));
  g.restore();

  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) return log('EXPORT', 'PNG encoding failed', 'warn');
  const a = document.createElement('a');
  const slug = d.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase() || 'target';
  a.download = `argus-${slug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  log('EXPORT', `${a.download} (${(blob.size / 1024).toFixed(0)} KB)`, 'ok');
}
