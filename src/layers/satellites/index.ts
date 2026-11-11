import type { LayerFactory } from '../Layer';
import { describeError } from '../../data/fetcher';
import { satEngine } from './engine';
import type { SatCat } from './categories';

/** One toggleable layer per satellite category, all backed by the shared engine. */
export function satLayer(cat: SatCat | 'all'): LayerFactory {
  return (ctx) => {
    const cats: SatCat[] = cat === 'all' ? ['stations', 'starlink', 'comms', 'gnss', 'earthobs', 'military', 'other'] : [cat];
    const counts = new Map<SatCat, number>();
    satEngine.onCount((c, n) => {
      if (!cats.includes(c)) return;
      counts.set(c, n);
      const total = cats.reduce((s, k) => s + (counts.get(k) ?? 0), 0);
      if (on) ctx.status('live', 'CelesTrak GP · SGP4 in worker', total);
    });
    let on = false;
    return {
      async enable() {
        on = true;
        try {
          await satEngine.init(ctx.viewer);
        } catch (e) {
          const d = describeError(e);
          ctx.status(d.status, d.detail);
          return;
        }
        for (const c of cats) await satEngine.setVisible(c, true);
        const total = satEngine.meta.filter((m) => cats.includes(m.cat)).length;
        ctx.status('live', 'CelesTrak GP · SGP4 in worker', total);
      },
      disable() {
        on = false;
        for (const c of cats) void satEngine.setVisible(c, false);
      },
    };
  };
}
