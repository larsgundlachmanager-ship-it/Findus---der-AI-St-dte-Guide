const fs = require('fs');
const p = 'src/services/homeMap/fogTrackEngine.ts';
let s = fs.readFileSync(p, 'utf8');

const old = `      const dueFull = now - lastBikeFullAtMs >= FOG_BIKE_FULL_EVERY_MS;
      if (dueFull) {
        lastBikeFullAtMs = now;
        const key = fogTrackCacheKey(useFogStore.getState().walkTrack);
        if (key !== lastTrackKey) {
          runDeferredFullCompute(useFogStore.getState().walkTrack, key);
        }
        return;
      }
      if (!gps) return;
      try {
        const tip = computeTransitTip(track, gps);
        const base = useFogStore.getState().exploredPolygons;
        publishExplored(
          [...base.slice(0, Math.max(0, base.length - 1)), ...tip],
          \`bike:\${gps.lat.toFixed(4)},\${gps.lng.toFixed(4)}\`,
        );
      } catch {
        /* soft */
      }`;

const neu = `      const dueFull = now - lastBikeFullAtMs >= FOG_BIKE_FULL_EVERY_MS;
      if (dueFull && !navFogActive()) {
        lastBikeFullAtMs = now;
        const key = fogTrackCacheKey(useFogStore.getState().walkTrack);
        if (key !== lastTrackKey) {
          runDeferredFullCompute(useFogStore.getState().walkTrack, key);
        }
        return;
      }
      if (!gps) return;
      try {
        const tip = computeTransitTip(track, gps);
        const base = useFogStore.getState().exploredPolygons;
        const qLat = Math.round(gps.lat * 4000) / 4000;
        const qLng = Math.round(gps.lng * 4000) / 4000;
        const tipKey = \`bike:\${qLat.toFixed(4)},\${qLng.toFixed(4)}\`;
        if (tipKey === lastTrackKey && base.length > 0) return;
        publishExplored(
          [...base.slice(0, Math.max(0, base.length - 1)), ...tip],
          tipKey,
        );
      } catch {
        /* soft */
      }`;

if (!s.includes(old)) {
  console.error('bike tip block not found');
  process.exit(1);
}
s = s.replace(old, neu);
fs.writeFileSync(p + '.new', s);
fs.renameSync(p + '.new', p);
console.log('bike tip patched');
