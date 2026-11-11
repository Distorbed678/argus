import { createOsmBuildingsAsync, Cesium3DTileStyle, type Cesium3DTileset } from 'cesium';
import type { LayerFactory } from '../Layer';

const factory: LayerFactory = (ctx) => {
  let ts: Cesium3DTileset | undefined;
  return {
    async enable() {
      ts = await createOsmBuildingsAsync();
      ts.style = new Cesium3DTileStyle({ color: "color('#4fc3ff', 0.85)" });
      ctx.viewer.scene.primitives.add(ts);
      ctx.status('live', 'Cesium ion OSM Buildings');
    },
    disable() {
      if (ts) ctx.viewer.scene.primitives.remove(ts);
      ts = undefined;
    },
  };
};
export default factory;
