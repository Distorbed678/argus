// NOAA NWS active severe/extreme alerts (US). Polygons where geometry exists, pins otherwise skipped.
import { Color, GeoJsonDataSource, Cartesian3, BoundingSphere, ConstantProperty } from 'cesium';
import { getData, Poller, describeError } from '../../data/fetcher';
import { utc, ago } from '../../core/fmt';
import { pid, type LayerFactory } from '../Layer';

const SEV: Record<string, string> = { Extreme: '#ff2d55', Severe: '#ff9f1c', Moderate: '#ffd166' };

const factory: LayerFactory = (ctx) => {
  let ds: GeoJsonDataSource | undefined;
  let poller: Poller | undefined;
  const props = new Map<string, any>();
  const centers = new Map<string, Cartesian3>();
  let seen = new Set<string>();
  let first = true;

  const refresh = async () => {
    try {
      const r = await getData<any>('https://api.weather.gov/alerts/active?status=actual&severity=Severe,Extreme', {
        ttl: 4 * 60_000,
        headers: { Accept: 'application/geo+json' },
      });
      const feats = r.data.features.filter((f: any) => f.geometry);
      const next = new GeoJsonDataSource('nws');
      await next.load({ type: 'FeatureCollection', features: feats }, { clampToGround: false });
      props.clear();
      centers.clear();
      const nowSeen = new Set<string>();
      for (const e of next.entities.values) {
        const p = e.properties?.getValue(undefined as any) ?? {};
        const key = p.id ?? e.id;
        props.set(key, p);
        nowSeen.add(key);
        (e as any).argus = pid(ctx.id, key);
        const col = Color.fromCssColorString(SEV[p.severity] ?? '#4fc3ff');
        if (e.polygon) {
          e.polygon.material = col.withAlpha(0.25) as any;
          e.polygon.outline = new ConstantProperty(true);
          e.polygon.outlineColor = new ConstantProperty(col);
          e.polygon.height = new ConstantProperty(0);
          const hier = e.polygon.hierarchy?.getValue(undefined as any);
          if (hier?.positions?.length) centers.set(key, BoundingSphere.fromPoints(hier.positions).center);
        }
        if (!first && !seen.has(key)) ctx.log(`${p.event}: ${p.areaDesc?.slice(0, 80)}`, p.severity === 'Extreme' ? 'alert' : 'warn');
      }
      seen = nowSeen;
      first = false;
      await ctx.viewer.dataSources.add(next);
      if (ds) ctx.viewer.dataSources.remove(ds, true);
      ds = next;
      ctx.status(r.fromCache ? 'cached' : 'live', `${r.data.features.length} active, ${feats.length} with polygons`, feats.length);
      ctx.requestRender();
    } catch (e) {
      const d = describeError(e);
      ctx.status(d.status, d.detail);
      throw e;
    }
  };

  return {
    enable() {
      poller = new Poller(refresh, 5 * 60_000);
      poller.start();
    },
    disable() {
      poller?.stop();
      if (ds) ctx.viewer.dataSources.remove(ds, true);
      ds = undefined;
    },
    pick(key) {
      const p = props.get(key);
      if (!p) return;
      return {
        layer: ctx.id,
        key,
        kind: 'WEATHER WARNING',
        title: p.event?.toUpperCase(),
        subtitle: p.areaDesc,
        classification: p.severity === 'Extreme' ? 'FLASH // EXTREME' : undefined,
        fields: [
          ['SEVERITY', `${p.severity} / ${p.certainty} / ${p.urgency}`],
          ['ISSUED', `${utc(Date.parse(p.sent))} (${ago(Date.parse(p.sent))})`],
          ['EXPIRES', p.expires ? utc(Date.parse(p.expires)) : '—'],
          ['SENDER', p.senderName ?? '—'],
          ['HEADLINE', p.headline ?? '—'],
        ],
        position: () => centers.get(key),
        range: 6e5,
      };
    },
  };
};
export default factory;
