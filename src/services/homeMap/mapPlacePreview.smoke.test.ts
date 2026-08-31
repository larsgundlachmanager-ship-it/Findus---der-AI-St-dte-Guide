/**
 * Run: npx --yes tsx src/services/homeMap/mapPlacePreview.smoke.test.ts
 */

import type { Poi } from '../../db/types';
import {
  bindMapPlacePreview,
  instantMapPlacePopup,
  mapPlacePreviewPendingForTests,
  peekMapPlacePreview,
  prefetchVisibleMapPlaces,
  prioritizeMapPlacePreview,
  resetMapPlacePreviewForTests,
} from './mapPlacePreview';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const poi = (id: number, name: string): Poi => ({
  id,
  name,
  lat: 53.67,
  lng: 9.76,
  radius_meters: 30,
  category: 'museum',
  teaser_text: 'Kleines Dorfmuseum in der alten Station.',
});

async function run(): Promise<void> {
  resetMapPlacePreviewForTests();
  const catalog = new Map<number, Poi>([
    [1, poi(1, 'Bahnhof')],
    [2, poi(2, 'Kirche')],
    [3, poi(3, 'Museum')],
  ]);
  bindMapPlacePreview({
    getPoi: (id) => catalog.get(id),
    getCityName: () => 'Prisdorf',
    loadFactsForPois: async () => new Map(),
  });

  const instant = instantMapPlacePopup({ id: 1, poi: catalog.get(1) });
  assert(instant.name === 'Bahnhof', 'Sofort-Popup kennt den Namen');
  assert(instant.bullets.length >= 1 && instant.bullets.length <= 2, 'Sofort-Popup hat 1–2 Stichpunkte');
  assert(
    instant.extraActions == null ||
      !instant.extraActions.some((a) => /^maps$/i.test(a.label)),
    'kein Maps ohne belegten Google-Place',
  );
  assert(peekMapPlacePreview(1) == null, 'Sofort-Popup schreibt nicht in den Cache');

  prefetchVisibleMapPlaces([2, 3, 1]);
  const pendingBefore = mapPlacePreviewPendingForTests();
  assert(pendingBefore[0] === 2, 'Hintergrund startet mit dem ersten sichtbaren Ort');

  void prioritizeMapPlacePreview(3);
  const pendingAfter = mapPlacePreviewPendingForTests();
  assert(pendingAfter[0] === 3, 'Tap packt den Ort an die Spitze');
  assert(
    pendingAfter.includes(2) && pendingAfter.includes(1),
    'sichtbare Reste bleiben in der Schlange',
  );

  resetMapPlacePreviewForTests();
  console.log('mapPlacePreview.smoke.test.ts OK');
}

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
