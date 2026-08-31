import { routeOnExtractGraph } from './offlineCityGraph';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const extract = {
  bbox: { south: 53.6, west: 9.7, north: 53.7, east: 9.9 },
  graph: {
    nodes: [
      { i: 'a', a: 53.65, o: 9.78 },
      { i: 'b', a: 53.651, o: 9.782 },
      { i: 'c', a: 53.652, o: 9.784 },
    ],
    edges: [
      { a: 'a', b: 'b', w: 160 },
      { a: 'b', b: 'c', w: 160 },
    ],
  },
};

const r = routeOnExtractGraph(
  extract,
  { lat: 53.65, lng: 9.78 },
  { lat: 53.652, lng: 9.784 },
  'walking',
);
assert(r && r.pathPoints.length >= 2, 'path');
assert((r?.distanceM ?? 0) >= 300, `dist ${r?.distanceM}`);
assert((r?.durationSec ?? 0) >= 30, 'duration');

const miss = routeOnExtractGraph(
  extract,
  { lat: 52.0, lng: 13.0 },
  { lat: 53.652, lng: 9.784 },
  'walking',
);
assert(miss == null, 'outside bbox');

console.log('offlineCityRouter.smoke.test.ts ok');
