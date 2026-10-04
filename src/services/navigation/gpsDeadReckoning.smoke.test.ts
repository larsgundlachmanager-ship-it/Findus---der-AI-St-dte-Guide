/**
 * Run: npx --yes tsx src/services/navigation/gpsDeadReckoning.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clearGpsDeadReckoning,
  deadReckonOffsetMeters,
  getDeadReckonSample,
  noteGpsDeadReckonFix,
  subscribeDeadReckonPosition,
} from './gpsDeadReckoning';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main(): Promise<void> {
  clearGpsDeadReckoning();

  const north = deadReckonOffsetMeters(53.55, 9.93, 10, 0, 1);
  assert(Math.abs(north.lat - 53.55) > 0.00005, '1 s bei 10 m/s nach N bewegt Lat');
  assert(Math.abs(north.lng - 9.93) < 0.00001, 'Nordkurs ändert Lng kaum');

  const east = deadReckonOffsetMeters(53.55, 9.93, 10, 90, 1);
  assert(Math.abs(east.lng - 9.93) > 0.00005, '1 s Ost bewegt Lng');

  let ticks = 0;
  const unsub = subscribeDeadReckonPosition(() => {
    ticks += 1;
  });
  noteGpsDeadReckonFix({
    lat: 53.55,
    lng: 9.93,
    speedMs: 12,
    courseDeg: 90,
  });
  const a = getDeadReckonSample();
  assert(a != null && Math.abs(a.lat - 53.55) < 1e-9, 'erster Fix = Display');

  await new Promise((r) => setTimeout(r, 220));
  const b = getDeadReckonSample();
  assert(b != null, 'Sample nach Coast');
  assert(b!.lng > 9.93, 'Coast nach Osten');
  assert(b!.coasting === true, 'coasting während Tempo');
  assert(ticks >= 2, 'Ticker emittiert');

  noteGpsDeadReckonFix({
    lat: 53.55,
    lng: 9.935,
    speedMs: 12,
    courseDeg: 90,
  });
  unsub();
  clearGpsDeadReckoning();

  const loc = readFileSync(
    join(process.cwd(), 'src/services/locationService.ts'),
    'utf8',
  );
  assert(loc.includes('noteGpsDeadReckonFix'), 'locationService füttert DR');
  const scene = readFileSync(
    join(process.cwd(), 'src/services/homeMap/mapSceneController.ts'),
    'utf8',
  );
  assert(scene.includes('noteGpsDeadReckonFix'), 'mapScene füttert DR');
  const view = readFileSync(
    join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
    'utf8',
  );
  assert(view.includes('subscribeDeadReckonPosition'), 'Puck/Follow aus DR');
  assert(
    !view.includes('pushPuckPosition(s.lat, s.lng, s.accuracyM)'),
    'kein Roh-Sensor-Puck-Pfad',
  );
  const cadence = readFileSync(
    join(process.cwd(), 'src/runtime/gpsCadence.ts'),
    'utf8',
  );
  assert(cadence.includes('gpsDeadReckoning'), 'Cadence verweist auf DR');
  const drSrc = readFileSync(
    join(process.cwd(), 'src/services/navigation/gpsDeadReckoning.ts'),
    'utf8',
  );
  assert(
    drSrc.includes('coastCap') &&
      (drSrc.includes('speedMs >= 8.3') || drSrc.includes('coastSpeed >= 8.3')),
    'Transit-Tempo: längerer Coast',
  );

  console.log('gpsDeadReckoning.smoke.test.ts OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
