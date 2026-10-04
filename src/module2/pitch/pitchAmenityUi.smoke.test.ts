/**
 * Phase 8 — UI-Synthese: Amenity Nav/Maps, keine Timeline; Tour → Timeline (Source).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/pitchAmenityUi.smoke.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isAmenitySinglePlacePitch,
  resolvePitchUiLayout,
} from './pitchAmenityUi';
import { pitchChoiceVisibleActions, buildPitchRouteAction } from './pitchActions';
import type { QuickAction } from '../../types/concierge';

assert.equal(
  isAmenitySinglePlacePitch({ text: 'Wo kann ich Basketball spielen?' }),
  true,
);
assert.equal(
  isAmenitySinglePlacePitch({ text: 'Hotel in Amsterdam mit Pool' }),
  false,
);
assert.equal(
  resolvePitchUiLayout({
    kind: 'generic',
    text: 'Wo kann ich Basketball spielen?',
    orderOpenTimeline: true,
    orderOpenCalendar: true,
  }),
  'live_split',
  'amenity ignores order timeline',
);
assert.equal(
  resolvePitchUiLayout({
    kind: 'food',
    text: 'Restaurant einplanen in die Timeline',
    orderOpenTimeline: true,
  }),
  'timeline_stack',
  'explicit timeline still works for non-amenity',
);

{
  // Option-Tap → Nav + Maps (Amenity)
  const nav = buildPitchRouteAction({
    name: 'Basketballplatz Stadtpark',
    lat: 53.58,
    lng: 10.02,
  });
  assert.ok(nav);
  assert.equal(nav!.type, 'START_NAVIGATION');
  assert.equal(nav!.payload.destLat, 53.58);
  assert.equal(nav!.payload.destLng, 10.02);

  const option = {
    name: 'Basketballplatz Stadtpark',
    lat: 53.58,
    lng: 10.02,
    allowCoordsMaps: true,
    showNavBeforeSelect: true,
    actions: [
      nav!,
      {
        type: 'OPEN_URL' as const,
        label: '🗺️ Maps',
        payload: {
          url: 'https://www.google.com/maps/search/?api=1&query=53.58,10.02',
          destName: 'Basketballplatz Stadtpark',
        },
      },
    ] satisfies QuickAction[],
  };

  const before = pitchChoiceVisibleActions(option, false);
  assert.ok(
    before.some((a) => a.type === 'START_NAVIGATION'),
    'amenity shows nav before select when flagged',
  );
  assert.ok(
    before.some((a) => /maps|🗺️/i.test(`${a.label} ${a.payload?.url ?? ''}`)),
    'amenity shows coords maps',
  );

  const after = pitchChoiceVisibleActions(option, true);
  assert.ok(after.some((a) => a.type === 'START_NAVIGATION'), 'nav after select');
  assert.equal(
    after.filter((a) => a.type === 'START_NAVIGATION').length,
    1,
    'one nav target = spoken option',
  );
  const dest = after.find((a) => a.type === 'START_NAVIGATION')!;
  assert.equal(dest.payload.destName, 'Basketballplatz Stadtpark');

  // Buttons 1:1 — zweite Option hat eigenen Dest-Namen
  const optB = {
    name: 'Court am See',
    lat: 53.59,
    lng: 10.03,
    allowCoordsMaps: true,
    actions: [
      buildPitchRouteAction({
        name: 'Court am See',
        lat: 53.59,
        lng: 10.03,
      })!,
    ],
  };
  const bActs = pitchChoiceVisibleActions(optB, true);
  assert.equal(
    bActs.find((a) => a.type === 'START_NAVIGATION')?.payload.destName,
    'Court am See',
  );
}

{
  // Wiring: Amenity never timeline; Tour mirrors to timeline
  const mod2 = path.resolve(__dirname, '..');
  const build = fs.readFileSync(
    path.join(__dirname, 'buildPitchRequest.ts'),
    'utf8',
  );
  assert.match(build, /resolvePitchUiLayout/);
  assert.match(build, /isAmenitySinglePlacePitch/);

  const run = fs.readFileSync(path.join(__dirname, 'runPitchModule.ts'), 'utf8');
  assert.match(run, /isAmenitySinglePlacePitch/);
  assert.match(run, /allowCoordsMaps:\s*amenityPlace/);
  assert.match(run, /wantCalendar = false/);

  const pub = fs.readFileSync(path.join(__dirname, 'publishPitchUi.ts'), 'utf8');
  assert.match(pub, /isAmenitySinglePlacePitch/);
  assert.match(pub, /live_split/);

  const ow = fs.readFileSync(
    path.join(mod2, 'router/call1OpenWorldContract.ts'),
    'utf8',
  );
  assert.match(ow, /isAmenityPlaceFindQuery/);
  assert.match(ow, /amenityPlace/);

  const tour = fs.readFileSync(
    path.join(mod2, 'tour/mirrorTourToTimeline.ts'),
    'utf8',
  );
  assert.match(tour, /upsertStopOnDay/);
  assert.match(tour, /requestOpenPlanCalendar/);
  assert.match(tour, /tour_\$\{result\.requestId\}/);

  const speech = fs.readFileSync(path.join(mod2, 'tour/tourSpeech.ts'), 'utf8');
  assert.match(speech, /mirrorTourToTimeline/);
}

console.log('pitchAmenityUi.smoke.test.ts ok');
