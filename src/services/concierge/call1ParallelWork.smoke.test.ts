/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/call1ParallelWork.smoke.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const policySrc = fs.readFileSync(
  path.join(__dirname, 'findusResponsePolicy.ts'),
  'utf8',
);
assert(
  /PARALLEL ZUR CALL-1-SPEECH/i.test(policySrc),
  'latency SSOT names parallel doctrine',
);
assert(
  /Call-2-Speech ist KEIN neuer Start|klebt flüssig/i.test(policySrc),
  'latency SSOT: Call-2 glues to queue',
);
assert(/PARALLEL dazu/i.test(policySrc), 'bridge continuity: work parallel to TTS');
assert(
  !/Call 1 fertig → Bridge push → dann Call 2/.test(policySrc),
  'no serial Call1→Bridge→Call2 wording',
);

const turnSrc = fs.readFileSync(
  path.join(__dirname, '../../module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert(/kickCall1ParallelWork/.test(turnSrc), 'kickCall1ParallelWork wired');
assert(
  /Promise\.all\(\[\s*introP,\s*runPitchModule/.test(turnSrc),
  'pitch research parallel to bridge intro',
);
assert(
  /Research\/Fanout SOFORT parallel zur Call-1-Bridge/.test(turnSrc),
  'fanout hoisted early after orchestrator',
);

const kickSrc = fs.readFileSync(
  path.join(__dirname, 'kickCall1ParallelWork.ts'),
  'utf8',
);
assert(/ensureWeatherFresh/.test(kickSrc), 'weather kick');
assert(
  /kickInstantMapNav/.test(kickSrc) || /kickNavDestPrefetch/.test(kickSrc),
  'nav kick / instant map',
);
assert(
  /setTimeout\(\(\) =>/.test(kickSrc),
  'cold geocode modules yield before Call-1 TTS',
);
assert(/researchTodaysEvents/.test(kickSrc), 'events research kick');
assert(/runWebResearch/.test(kickSrc), 'web search kick');
assert(/tryEarlyJustDoIt/.test(kickSrc), 'timer/wake/reminder kick');
assert(/hydratePlanTimeline/.test(kickSrc), 'timeline hydrate kick');
assert(/searchPlacesByText/.test(kickSrc), 'pitch search kick');

const presentSrc = fs.readFileSync(
  path.join(__dirname, 'presentConcierge.ts'),
  'utf8',
);
assert(
  /Fused Turn: Call-2 klebt/.test(presentSrc) &&
    /enqueueSpeech/.test(presentSrc),
  'presentConcierge appends Call-2 to fused session, no 8s wait',
);
assert(
  /if \(!fusedTurnLive\)/.test(presentSrc),
  'presentConcierge skips idle-wait while fused live',
);
assert(
  /early address nav bridge/.test(turnSrc) &&
    /extractStreetAddressFromUtterance/.test(turnSrc),
  'street+housenumber gets deterministic early bridge',
);
assert(
  /kickInstantMapNav/.test(turnSrc),
  'address bridge commits map nav while TTS speaks',
);
assert(
  /streetAddr/.test(kickSrc) || /extractStreetAddressFromUtterance/.test(kickSrc),
  'kick prefetches bare street+housenumber without nav verb',
);

const prefetchSrc = fs.readFileSync(
  path.join(__dirname, '../navigation/navDestPrefetch.ts'),
  'utf8',
);
const resolveSrc = fs.readFileSync(
  path.join(__dirname, '../navigation/resolveNavTarget.ts'),
  'utf8',
);
assert(
  /kickInstantMapNav/.test(prefetchSrc),
  'prefetch module exports instant map nav',
);
assert(
  /setPendingNavOffer/.test(prefetchSrc),
  'instant map paints dest pin via pending offer',
);
assert(
  /preferStreetAddress/.test(prefetchSrc),
  'address prefetch uses street-address geocode mode',
);
assert(
  /awaitNavDestPrefetch/.test(resolveSrc),
  'address commit reuses Call-1 prefetch',
);

console.log('call1ParallelWork.smoke.test.ts OK');
