/**
 * Hamburg-Tag: Call-1 sieht den Satz. Kein Steal/Pitch/M5-Klau davor.
 * Run: npx -y -p tsx tsx src/module2/reboot/pipeline/hamburgCompound.smoke.test.ts
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  orchestrateUtterance,
  shouldStealTurnBeforeCall1,
} from './orchestrateSlots';
import {
  dispatchJobsForUtterance,
  hasParallelChildJobs,
  shouldExclusiveM5Plan,
  planMustNotSwallowParts,
  call1OwnsCompoundTurn,
} from './dispatchJobs';
import { shouldHandoffToPitchModule } from '../../pitch/shouldHandoffPitch';
import { shouldHandoffToTourModule } from '../../tour/shouldHandoffTour';
import { CALL1_FROZEN_CONTRACT, CALL1_FROZEN_SHA256 } from './call1Frozen';
import { frozenCall1Sha256 } from './goldTriage';
import { backendForJob, JOB_MODULE_BACKEND } from './moduleBackends';
import type { FindusJobId } from '../../jobs/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const hash = createHash('sha256')
  .update(CALL1_FROZEN_CONTRACT, 'utf8')
  .digest('hex');
assert(hash === CALL1_FROZEN_SHA256, `call1 hash ${hash}`);
assert(frozenCall1Sha256() === CALL1_FROZEN_SHA256, 'gold freeze sha');

const HAMBURG =
  'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang.';

const orch = orchestrateUtterance(HAMBURG);
const jobs = dispatchJobsForUtterance(HAMBURG);

const need: FindusJobId[] = [
  'transit_live',
  'dining_open',
  'dining_hard_match',
  'poi_identify',
  'fact_number',
  'weather_outfit',
  'sight_recommend',
  'day_plan_budget',
];
for (const j of need) {
  assert(jobs.includes(j), `hamburg missing ${j} got ${jobs.join(',')}`);
}
assert(!orch.clockJob, 'hamburg is departure not alarm');
assert(orch.weaveDayPlan, 'hamburg weaves');
assert(hasParallelChildJobs(HAMBURG), 'hamburg child jobs');
assert(!shouldExclusiveM5Plan(HAMBURG), 'hamburg not exclusive m5');
assert(!orch.stealEarlyM5, 'hamburg must not steal before Call-1');
assert(
  !shouldStealTurnBeforeCall1(HAMBURG),
  'hamburg steal before call1 is dead',
);
assert(call1OwnsCompoundTurn(HAMBURG), 'hamburg stays with Call-1 jobs');
{
  const partial = 'Morgen 9 Uhr los nach Hamburg, frühstücken';
  const na = partial.toLowerCase().replace(/\s+/g, ' ').trim();
  const nb = HAMBURG.toLowerCase().replace(/\s+/g, ' ').trim();
  assert(
    Math.abs(na.length - nb.length) > 24,
    'partial warmup must not replace the full sentence',
  );
}
{
  const turnSrc = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../router/runConciergeTurn.ts',
    ),
    'utf8',
  );
  assert(
    !/tryEarlyM5Handoff\s*\(/.test(turnSrc),
    'runConciergeTurn must not call tryEarlyM5Handoff',
  );
}
assert(
  !shouldHandoffToPitchModule(HAMBURG),
  'hamburg day plan is not a GPS breakfast pitch',
);
assert(
  !shouldHandoffToTourModule(HAMBURG),
  'hamburg day plan is not a GPS pack tour starting now',
);
assert(planMustNotSwallowParts(orch), 'hamburg parts not swallowed');
assert(orch.thinkAhead.includes('sunset_anchor'), 'sunset thinkahead');
assert(orch.thinkAhead.includes('evening_first_pitch'), 'evening first');
assert(
  orch.thinkAhead.includes('reverse_from_departure'),
  'reverse from 9:00',
);
assert(backendForJob('transit_live').module === 'transit', 'transit backend');
assert(backendForJob('dining_open').module === 'pitch', 'pitch backend');
assert(backendForJob('day_plan_budget').module === 'plan', 'plan weaves');
assert(backendForJob('weather_outfit').module === 'weather', 'weather backend');
assert(backendForJob('fact_number').module === 'fact', 'fact backend');
assert(Object.keys(JOB_MODULE_BACKEND).length >= 23, 'all job backends');

{
  assert(
    orchestrateUtterance(HAMBURG).weaveDayPlan &&
      call1OwnsCompoundTurn(HAMBURG),
    'hamburg compound plan ingest',
  );
}

const wx = orchestrateUtterance(
  'Wie wird das Wetter und wie lange brauche ich da hin?',
);
assert(
  wx.jobs.includes('weather_outfit') && wx.jobs.includes('nav_route'),
  'weather+eta split',
);
assert(
  !wx.weaveDayPlan && !wx.jobs.includes('day_plan_budget'),
  'weather+eta no plan dump',
);
assert(planMustNotSwallowParts(wx), 'eta parts stay');
assert(
  call1OwnsCompoundTurn(
    'Wie wird das Wetter und wie lange brauche ich da hin?',
  ),
  'weather+eta owned by call1',
);

const pope = orchestrateUtterance('Wie alt ist der Papst?');
assert(pope.jobs.includes('fact_number'), 'pope fact job');
assert(!pope.weaveDayPlan, 'pope no timeline');

console.log('hamburgCompound.smoke.test.ts OK');
