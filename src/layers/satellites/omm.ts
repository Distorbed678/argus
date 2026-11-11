import type { OMMJsonObject } from 'satellite.js';

const STRING_COLS = new Set(['OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'CLASSIFICATION_TYPE']);

/** CelesTrak GP CSV → OMM objects (shared by the main thread and the SGP4 worker). */
export function parseCsv(text: string): OMMJsonObject[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift()!.split(',');
  const isStr = head.map((h) => STRING_COLS.has(h));
  const out: any[] = [];
  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length !== head.length) continue;
    const o: any = {};
    for (let i = 0; i < head.length; i++) o[head[i]] = isStr[i] ? cols[i] : Number(cols[i]);
    out.push(o);
  }
  return out;
}
