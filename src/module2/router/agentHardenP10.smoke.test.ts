/**
 * P10 weather lanes + nav Zwischenstopp helper.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/agentHardenP10.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  reconcileWeatherJobShape,
  inferCall1JobShape,
  jobShapeToExecutionHint,
} from './call1JobShape';
import { diffWeatherJobShapes, metaWeatherLaneHint } from '../meta/metaWeather';
import { parseCall1OrderTicket } from './call1OrderTicket';
import { isOnRouteZwischenstoppIntent } from '../../services/navigation/onRouteZwischenstopp';

import fs from 'node:fs';
import path from 'node:path';

const rain = 'Regnet es heute Abend?';
assert.equal(reconcileWeatherJobShape('weather_info', rain), 'weather_rain');
assert.equal(metaWeatherLaneHint(rain), 'weather_rain');

const outfit = 'Wie wird das Wetter — was soll ich anziehen?';
assert.equal(reconcileWeatherJobShape('weather_rain', outfit), 'weather_outfit');
const diff = diffWeatherJobShapes(outfit);
assert.ok(diff.outfit);
assert.equal(diff.inferred, 'weather_outfit');

assert.equal(jobShapeToExecutionHint('weather_outfit'), 'chat_lane');

const order = parseCall1OrderTicket(
  { order: { jobShape: 'weather_rain' } },
  { userText: outfit },
);
assert.equal(order.jobShape, 'weather_outfit');
assert.equal(order.need.weatherOutfit, true);

assert.equal(inferCall1JobShape('Wie lange brauch ich zum Bahnhof?'), 'logistics');

assert.ok(
  isOnRouteZwischenstoppIntent('Kurz zum Briefkasten vorher', true),
  'on-route zwischenstopp',
);
assert.ok(
  !isOnRouteZwischenstoppIntent('Kurz zum Briefkasten vorher', false),
  'no nav → no zwischenstopp',
);

const multiStopSrc = fs.readFileSync(
  path.join(__dirname, '../../services/navigation/multiStopTour.ts'),
  'utf8',
);
assert.match(
  multiStopSrc,
  /export async function insertZwischenstoppForActiveNav/,
  'zwischenstopp facade exported',
);

console.log('agentHardenP10.smoke.test.ts OK');
