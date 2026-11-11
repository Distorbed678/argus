// Submarine cables + landing points from the bundled TeleGeography snapshot (public/data/cables.json).
import { PolylineCollection, PointPrimitiveCollection, BlendOption, Cartesian3, Color, Material, NearFarScalar } from 'cesium';
import { getData, describeError } from '../../data/fetcher';
import { fmtLL } from '../../core/fmt';
import { pid, type LayerFactory } from '../Layer';

interface Snap {
  generated: string;
  cables: { id: string; name: string; color: string; lines: number[][] }[]; // flat [lon,lat,lon,lat…]
  landings: { id: string; name: string; lon: number; lat: number }[];
}

const factory: LayerFactory = (ctx) => {
  let lines: PolylineCollection | undefined;
  let pts: PointPrimitiveCollection | undefined;
  let snap: Snap | undefined;
  return {
    async enable() {
      try {
        const r = await getData<Snap>('./data/cables.json', { ttl: 86400_000 });
        snap = r.data;
      } catch (e) {
        const d = describeError(e);
        ctx.status(d.status, 'snapshot missing — run `npm run data`');
        return;
      }
      lines = ctx.viewer.scene.primitives.add(new PolylineCollection());
      pts = ctx.viewer.scene.primitives.add(new PointPrimitiveCollection({ blendOption: BlendOption.OPAQUE }));
      for (const c of snap!.cables) {
        const col = Color.fromCssColorString(c.color || '#4fc3ff').withAlpha(0.75);
        const mat = Material.fromType('Color', { color: col });
        for (const l of c.lines) {
          if (l.length < 4) continue;
          lines!.add({ positions: Cartesian3.fromDegreesArray(l), width: 1.5, material: mat, id: pid(ctx.id, `c:${c.id}`) });
        }
      }
      const lpColor = Color.fromCssColorString('#e0f4ff');
      const lpScale = new NearFarScalar(1e5, 1.5, 2e7, 0.6);
      for (const p of snap!.landings) {
        pts!.add({ position: Cartesian3.fromDegrees(p.lon, p.lat), pixelSize: 4, color: lpColor, scaleByDistance: lpScale, id: pid(ctx.id, `l:${p.id}`) });
      }
      ctx.status('cached', `snapshot ${snap!.generated.slice(0, 10)}`, snap!.cables.length);
      ctx.requestRender();
    },
    disable() {
      if (lines) ctx.viewer.scene.primitives.remove(lines);
      if (pts) ctx.viewer.scene.primitives.remove(pts);
      lines = pts = undefined;
    },
    pick(key) {
      if (!snap) return;
      if (key.startsWith('c:')) {
        const c = snap.cables.find((x) => x.id === key.slice(2));
        if (!c) return;
        const first = c.lines[0];
        return {
          layer: ctx.id,
          key,
          kind: 'SUBSEA CABLE',
          title: c.name,
          subtitle: 'Submarine telecommunications cable',
          fields: [
            ['SEGMENTS', String(c.lines.length)],
            ['ID', c.id],
          ],
          position: () => Cartesian3.fromDegrees(first[0], first[1]),
          actions: [{ label: 'TELEGEOGRAPHY ↗', run: () => window.open(`https://www.submarinecablemap.com/submarine-cable/${c.id}`, '_blank', 'noopener') }],
          range: 3e6,
        };
      }
      const l = snap.landings.find((x) => x.id === key.slice(2));
      if (!l) return;
      return {
        layer: ctx.id,
        key,
        kind: 'CABLE LANDING STATION',
        title: l.name,
        fields: [['POSITION', fmtLL(l.lat, l.lon)]],
        position: () => Cartesian3.fromDegrees(l.lon, l.lat),
        range: 3e5,
      };
    },
    find(q) {
      if (!snap) return;
      const s = q.toLowerCase();
      const c = snap.cables.find((x) => x.name.toLowerCase().includes(s));
      return c ? this.pick!(`c:${c.id}`) as any : undefined;
    },
  };
};
export default factory;
