import { fetchRouteDirectionsResult } from '../src/services/navigation/googleMapsNav.ts';
import { planJourney } from '../src/services/transit/journeyPlanner.ts';

const from = { lat: 53.6748, lng: 9.7935 };
const near = { lat: 53.6762, lng: 9.7918 };
const bahnhof = { lat: 53.6759, lng: 9.7892 };
const hamburg = { lat: 53.5528, lng: 10.0067 };

async function testFoot() {
  const r = await fetchRouteDirectionsResult(from, near, 'walking');
  console.log(
    'FOOT near',
    r
      ? `${Math.round(r.distanceM)}m ${Math.round((r.durationSec ?? 0) / 60)}min steps=${r.steps?.length}`
      : 'FAIL',
  );
}

async function testBike() {
  const r = await fetchRouteDirectionsResult(from, near, 'bicycling');
  console.log(
    'BIKE near',
    r ? `${Math.round(r.distanceM)}m ${Math.round((r.durationSec ?? 0) / 60)}min` : 'FAIL',
  );
  const far = await fetchRouteDirectionsResult(from, bahnhof, 'bicycling');
  console.log('BIKE bahnhof', far ? `${Math.round(far.distanceM)}m` : 'FAIL');
}

async function testTransit(label, to) {
  const r = await planJourney({
    from,
    to,
    travelMode: 'transit',
    departAt: new Date(),
    numItineraries: 3,
  });
  const best = r.itineraries[0];
  if (!best) {
    console.log('TRANSIT', label, 'FAIL none');
    return;
  }
  const modes = best.legs.map((l) => l.mode).join('→');
  console.log(
    'TRANSIT',
    label,
    `ok source=${best.source} ${Math.round(best.durationSec / 60)}min transfers=${best.transfers} legs=${best.legs.length} [${modes}]`,
  );
}

await testFoot();
await testBike();
await testTransit('hamburg', hamburg);
await testTransit('pinneberg', { lat: 53.659, lng: 9.801 });
