/**
 * Pipeline-Gate: Jobs aus echten Sätzen, Call-1-Freeze, Partner-Links.
 * Run: npx --yes tsx src/module2/reboot/pipeline/pipeline.smoke.test.ts
 */
import { createHash } from 'crypto';
import {
  orchestrateUtterance,
  isClockOnlyUtterance,
  shouldStealTurnBeforeCall1,
} from './orchestrateSlots';
import { CALL1_FROZEN_CONTRACT, CALL1_FROZEN_SHA256 } from './call1Frozen';
import { LIVE_REPLAY_SITUATIONS } from './liveReplay.cases';
import {
  buildStayDeeplink,
  buildUberDeeplink,
  speakablePartnerUrl,
} from './partnerLinkCheck';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const hash = createHash('sha256').update(CALL1_FROZEN_CONTRACT, 'utf8').digest('hex');
if (hash !== CALL1_FROZEN_SHA256) {
  throw new Error(`Call-1 contract drifted\n expected ${CALL1_FROZEN_SHA256}\n got ${hash}`);
}

assert(!isClockOnlyUtterance('Morgen 9 Uhr los nach Hamburg'), '9 Uhr los is not a clock job');
assert(isClockOnlyUtterance('Stell mir einen Wecker um 7'), 'wecker is clock');
assert(
  !shouldStealTurnBeforeCall1(
    'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch, Michel',
  ),
  'hamburg compound must not steal M5 before Call-1',
);

const hh = orchestrateUtterance(
  'Morgen 9 Uhr los nach Hamburg frühstücken abends Pannfisch mit Elbblick Michel rauf wie hoch wie teuer was ist das eine Tour Sonnenuntergang',
);
assert(hh.jobs.includes('transit_live'), `hamburg transit ${hh.jobs.join(',')}`);
assert(hh.jobs.includes('dining_open'), `hamburg breakfast ${hh.jobs.join(',')}`);
assert(
  hh.jobs.includes('dining_hard_match'),
  `hamburg pannfisch ${hh.jobs.join(',')}`,
);
assert(hh.jobs.includes('poi_identify'), `hamburg michel ${hh.jobs.join(',')}`);
assert(hh.weaveDayPlan, 'hamburg weaves');
assert(!hh.clockJob, 'hamburg no clock');

const wx = orchestrateUtterance('Wie wird das Wetter und wie lange brauche ich da hin?');
assert(wx.jobs.includes('weather_outfit'), `wx jobs ${wx.jobs.join(',')}`);
assert(wx.jobs.includes('nav_route'), `eta jobs ${wx.jobs.join(',')}`);
assert(!wx.weaveDayPlan, 'weather+eta is not a day plan');

const pope = orchestrateUtterance('Wie alt ist der Papst?');
assert(pope.jobs.includes('fact_number'), 'pope fact');
assert(!pope.weaveDayPlan, 'pope no timeline');

const steak = orchestrateUtterance('Lust auf Steak');
assert(
  steak.jobs.includes('dining_hard_match') || steak.jobs.includes('dining_open'),
  'steak dining',
);
const hunger = orchestrateUtterance('Ich hab Hunger');
assert(hunger.jobs.includes('dining_open'), 'hunger is now, not leftover steak');

for (const sit of LIVE_REPLAY_SITUATIONS) {
  for (const turn of sit.turns) {
    if (turn.mustJobs.length === 0) continue;
    const o = orchestrateUtterance(turn.q);
    for (const j of turn.mustJobs) {
      assert(o.jobs.includes(j), `${sit.id} missing ${j} jobs=${o.jobs.join(',')}`);
    }
    for (const j of turn.forbidJobs ?? []) {
      assert(!o.jobs.includes(j), `${sit.id} forbid ${j}`);
    }
    if (turn.forbidClock) assert(!o.clockJob, `${sit.id} clock`);
    if (turn.weaveDayPlan != null) {
      assert(o.weaveDayPlan === turn.weaveDayPlan, `${sit.id} weave`);
    }
  }
}

const stay = buildStayDeeplink({
  destination: 'Hamburg',
  checkin: '2026-08-24',
  checkout: '2026-08-25',
  adults: 2,
});
assert(stay.ok && speakablePartnerUrl(stay), `stay ${stay.reason} ${stay.url}`);
assert(/address=/.test(stay.url), 'stay address');

const uber = buildUberDeeplink({
  clientId: 'demo',
  dropLat: 53.55,
  dropLng: 9.99,
  dropAddress: 'Michel, Hamburg',
});
assert(uber.ok && speakablePartnerUrl(uber), `uber ${uber.reason}`);

const broken = buildStayDeeplink({ destination: '' });
assert(!broken.ok && speakablePartnerUrl(broken) == null, 'empty dest no speak');

console.log('pipeline.smoke.test.ts OK');
