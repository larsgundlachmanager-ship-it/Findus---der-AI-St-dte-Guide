/**
 * Run: npx --yes tsx src/services/discovery/cityCoverageFit.smoke.test.ts
 */

import {
  ringForCityOverview,
  viewBoxFromCoverageBounds,
} from './cityCoverageFit';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function run(): void {
  const box = {
    latMin: 53.4,
    latMax: 53.7,
    lngMin: 9.7,
    lngMax: 10.3,
  };
  const view = viewBoxFromCoverageBounds(box);
  assert(view.south === 53.4 && view.north === 53.7, 'viewBox lat');
  assert(view.west === 9.7 && view.east === 10.3, 'viewBox lng');

  const ring = ringForCityOverview(box);
  assert(ring.length === 5, 'bbox ring closes');
  assert(ring[0][0] === 53.4 && ring[0][1] === 9.7, 'bbox SW');
  assert(ring[2][0] === 53.7 && ring[2][1] === 10.3, 'bbox NE');

  const fromPoly = ringForCityOverview({
    ...box,
    polygon: [
      [53.5, 9.8],
      [53.6, 9.9],
      [53.55, 10.1],
    ],
  });
  assert(fromPoly.length === 3 && fromPoly[1][1] === 9.9, 'uses real polygon');

  console.log('cityCoverageFit.smoke.test.ts OK');
}

run();
