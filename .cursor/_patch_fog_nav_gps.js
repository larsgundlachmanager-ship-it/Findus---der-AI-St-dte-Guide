const fs = require('fs');
const p = 'src/services/homeMap/fogTrackEngine.ts';
let s = fs.readFileSync(p, 'utf8');

const oldTip = `function publishWalkTip(
  track: WalkTrackPoint[],
  gps: { lat: number; lng: number },
): void {
  const tip = computeTransitTip(track, gps);
  const base = useFogStore.getState().exploredPolygons;
  publishExplored(
    [...base.slice(0, Math.max(0, base.length - 1)), ...tip],
    \`walk:\${gps.lat.toFixed(4)},\${gps.lng.toFixed(4)}\`,
  );
}`;

const newTip = `function publishWalkTip(
  track: WalkTrackPoint[],
  gps: { lat: number; lng: number },
): void {
  const tip = computeTransitTip(track, gps);
  const base = useFogStore.getState().exploredPolygons;
  // ~25 m Raster — sonst jeder Meter neuer trackKey → Fog-GeoJSON-Rebuild → GPS stockt.
  const qLat = Math.round(gps.lat * 4000) / 4000;
  const qLng = Math.round(gps.lng * 4000) / 4000;
  const key = \`walk:\${qLat.toFixed(4)},\${qLng.toFixed(4)}\`;
  if (key === lastTrackKey && base.length > 0) return;
  publishExplored(
    [...base.slice(0, Math.max(0, base.length - 1)), ...tip],
    key,
  );
}`;

if (!s.includes(oldTip)) {
  console.error('publishWalkTip block not found');
  process.exit(1);
}
s = s.replace(oldTip, newTip);

const blobOld = `if (isMapUserGesturing()) return;
  const quick = [cheapGpsRevealCircle(gps.lat, gps.lng)];`;
const blobNew = `if (isMapUserGesturing()) return;
  // Nav: kein Instant-Blob — Tip-Pfad reicht, GPS bleibt flüssig.
  if (navFogActive()) return;
  const quick = [cheapGpsRevealCircle(gps.lat, gps.lng)];`;
if (!s.includes(blobOld)) {
  console.error('pushInstantGpsBlob block not found');
  process.exit(1);
}
s = s.replace(blobOld, blobNew);

const fullOld = `function runDeferredFullCompute(track: WalkTrackPoint[], key: string): void {
  // Full-Merge immer mapIdle — hinter Mic/Chrome/Polish, nie Hot-Path.
  runMapIdleWhenFree(() => {
    if (isMapUserGesturing() || fogShouldYield() || homeMapShouldPause()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, null);
      return;
    }
    if (fogSpeedTier() === 'transit') {
      // Zwischenzeitlich wieder Transit — Tip-Pfad, kein Full.
      return;
    }`;
const fullNew = `function runDeferredFullCompute(track: WalkTrackPoint[], key: string): void {
  // Full-Merge immer mapIdle — hinter Mic/Chrome/Polish, nie Hot-Path.
  // Während Nav: Full-Fog friert JS/GPS ein — nur Tip.
  if (navFogActive()) return;
  runMapIdleWhenFree(() => {
    if (navFogActive()) return;
    if (isMapUserGesturing() || fogShouldYield() || homeMapShouldPause()) {
      scheduleFogRecompute(useFogStore.getState().walkTrack, null);
      return;
    }
    if (fogSpeedTier() === 'transit') {
      // Zwischenzeitlich wieder Transit — Tip-Pfad, kein Full.
      return;
    }`;
if (!s.includes(fullOld)) {
  console.error('runDeferredFullCompute block not found');
  process.exit(1);
}
s = s.replace(fullOld, fullNew);

const forceOld = `export function forceFogRecompute(track: WalkTrackPoint[]): void {
  useFogStore.getState().setWalkTrack(track);
  if (homeMapShouldPause()) return;
  if (homeMapFogExploreIdleFrozen()) return;`;
const forceNew = `export function forceFogRecompute(track: WalkTrackPoint[]): void {
  useFogStore.getState().setWalkTrack(track);
  if (homeMapShouldPause()) return;
  if (homeMapFogExploreIdleFrozen()) return;
  // Live-Nav: Full-Merge überspringen (GPS/Puck priorisieren).
  if (navFogActive()) return;`;
if (!s.includes(forceOld)) {
  console.error('forceFogRecompute block not found');
  process.exit(1);
}
s = s.replace(forceOld, forceNew);

const waitOld = `const waitWalk = fogShouldYield()
    ? Math.max(FOG_DEBOUNCE_WALK_TIP_MS, 1800)
    : FOG_DEBOUNCE_WALK_TIP_MS;`;
const waitNew = `const waitWalk = fogShouldYield()
    ? Math.max(FOG_DEBOUNCE_WALK_TIP_MS, 1800)
    : navFogActive()
      ? 2_800
      : FOG_DEBOUNCE_WALK_TIP_MS;`;
if (!s.includes(waitOld)) {
  console.error('waitWalk block not found');
  process.exit(1);
}
s = s.replace(waitOld, waitNew);

const dueOld = `if (dueFull && key !== lastTrackKey) {
      lastWalkFullAtMs = now;
      runDeferredFullCompute(useFogStore.getState().walkTrack, key);
      return;
    }`;
const dueNew = `if (dueFull && key !== lastTrackKey && !navFogActive()) {
      lastWalkFullAtMs = now;
      runDeferredFullCompute(useFogStore.getState().walkTrack, key);
      return;
    }`;
if (!s.includes(dueOld)) {
  console.error('dueFull block not found');
  process.exit(1);
}
s = s.replace(dueOld, dueNew);

fs.writeFileSync(p + '.new', s);
fs.renameSync(p + '.new', p);
console.log('fogTrackEngine patched ok');
