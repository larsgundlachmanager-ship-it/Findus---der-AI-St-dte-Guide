/**
 * Wetter + Kleidung + Stadtbummel: Antwort, keine leere Timeline.
 * Run: npx --yes --package tsx@4.19.3 tsx src/module2/planning/weatherOutfit.smoke.test.ts
 */
import {
  looksLikeOutfitOrWeatherUtterance,
  weatherAskIsFutureDay,
  weatherOutfitLookupTips,
  looksLikeModul5PlanUtterance,
} from './planUtteranceGate';
import { shouldForceModul5Handoff } from './planHandoffGuard';
import { isFindusReisebueroHandoff } from '../../reisebuero/handoff';
import { classifyJob } from '../jobs/classifyJob';
import { classifyUtteranceFamily } from '../kernel/utteranceFamily';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const Q =
  'wie wird morgen das Wetter, was muss ich anziehen wenn ich einen Städtetrip machen möchte';

assert(looksLikeOutfitOrWeatherUtterance(Q), 'outfit+wetter erkannt');
assert(weatherAskIsFutureDay(Q), 'morgen is future day');
assert(!weatherAskIsFutureDay('wie wird das Wetter heute morgen'), 'heute morgen is not future-day');
assert(!looksLikeModul5PlanUtterance(Q), 'kein Tagesplan');
assert(!shouldForceModul5Handoff(Q), 'kein M5 / keine Timeline');
assert(!isFindusReisebueroHandoff(Q), 'kein Reisebüro nur weil Städtetrip vorkommt');
assert(
  isFindusReisebueroHandoff(
    'Lust auf Städtetrip, keine Ahnung welche Stadt, 500 Euro, Wochenende',
  ),
  'offener Städtetrip ohne Wetter bleibt Reisebüro',
);
assert(classifyJob(Q).jobId === 'weather_outfit', 'job weather_outfit');
assert(
  !classifyJob(Q).secondaryJobIds.includes('nightlife_vibe'),
  'Stadtbummel injects no nightlife',
);
assert(classifyUtteranceFamily(Q).family === 'plan' || classifyUtteranceFamily(Q).family === 'weather', 'family weather-or-plan (Städtetrip)');
assert(looksLikeOutfitOrWeatherUtterance('Wird heute regnen?'), 'regnen = wetter');
assert(looksLikeOutfitOrWeatherUtterance('Regnet es heute?'), 'regnet = wetter');
assert(classifyUtteranceFamily('Wird heute regnen?').family === 'weather', 'family regnen');
assert(classifyUtteranceFamily('Regnet es heute?').family === 'weather', 'family regnet');
assert(
  /keine Timeline/i.test(weatherOutfitLookupTips(Q)),
  'checklist says no empty timeline',
);

console.log('weatherOutfit.smoke.test.ts ok');
