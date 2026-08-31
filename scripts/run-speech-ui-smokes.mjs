/**
 * Speech / Aufbau / Stichpunkte / Action-Buttons + offizielle Gates.
 * Quotes paths (repo has a space). Cwd = TEMP because local tsx is broken.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = process.env.TEMP || process.env.TMP || root;

const files = [
  'src/module2/jobs/jobAnalogy.smoke.test.ts',
  'src/module2/jobs/wiringBattery.smoke.test.ts',
  'src/module2/blueprints/ownerGold.smoke.test.ts',
  'src/module2/kernel/turnKernel.smoke.test.ts',
  'src/module2/router/liveInventoryGate.smoke.test.ts',
  'src/module2/pitch/diningPitch.smoke.test.ts',
  'src/module2/pitch/foodPitchGuard.smoke.test.ts',
  'src/module2/pitch/picnicPitch.smoke.test.ts',
  'src/module2/pitch/pitchChoiceActions.smoke.test.ts',
  'src/module2/pitch/hardMatch.smoke.test.ts',
  'src/module2/planning/offerActionUtils.smoke.test.ts',
  'src/module2/planning/planSpeechSanitize.smoke.test.ts',
  'src/module2/planning/planMondayHamburg.smoke.test.ts',
  'src/module2/planning/planUtteranceSlots.smoke.test.ts',
  'src/module2/planning/planWalkOrder.smoke.test.ts',
  'src/module2/planning/planDestinationCity.smoke.test.ts',
  'src/module2/planning/planConfirmAck.smoke.test.ts',
  'src/module2/planning/planDirectAsk.smoke.test.ts',
  'src/module2/planning/weatherOutfit.smoke.test.ts',
  'src/module2/speech/synthesisRails.smoke.test.ts',
  'src/module2/reboot/pipeline/hamburgCompound.smoke.test.ts',
  'src/module2/reboot/pipeline/pipeline.smoke.test.ts',
  'src/module2/tour/tourExplore.smoke.test.ts',
  'src/module2/speech/fusedTurnSpeech.smoke.test.ts',
  'src/module2/chat/bridgeGlue.smoke.test.ts',
  'src/module2/chat/chatFirst.smoke.test.ts',
  'src/module2/chat/chatLaneMeta.smoke.test.ts',
  'src/module2/timeline/stopAccordionFacts.smoke.test.ts',
  'src/module2/timeline/placeActionUrls.smoke.test.ts',
  'src/services/audio/ttsPipeline.contract.test.ts',
  'src/services/audio/liveSentencePump.smoke.test.ts',
  'src/services/audio/punctuationChunker.smoke.test.ts',
  'src/services/concierge/dualOptionSpeech.smoke.test.ts',
  'src/services/concierge/bulletDigits.smoke.test.ts',
  'src/services/transit/ticketedAccessResearch.smoke.test.ts',
  'src/services/ui/weatherDayPlanSpeech.smoke.test.ts',
  'src/services/ui/nachtruhePolicy.smoke.test.ts',
  'src/services/navigation/navStartSpeech.smoke.test.ts',
  'src/services/navigation/transitGuideSpeech.smoke.test.ts',
  'src/services/g2p/stripStageDirections.smoke.test.ts',
  'src/services/persona/userNameSpeechHint.smoke.test.ts',
  'src/services/research/temporaryLiveSpeech.smoke.test.ts',
  'src/services/homeMap/homeMapPlaceBullets.smoke.test.ts',
  'scripts/qa-overnight-gates.ts',
  'scripts/run-pitch-gate.ts',
  'scripts/run-tour-gate.ts',
];

const fail = [];
let ok = 0;
for (const rel of files) {
  const f = join(root, rel);
  process.stdout.write(`\n=== ${rel} ===\n`);
  const r = spawnSync(
    `npx --yes --package tsx@4.19.4 tsx "${f}"`,
    { cwd: temp, stdio: 'inherit', shell: true, windowsHide: true },
  );
  if (r.status !== 0) fail.push(rel);
  else ok += 1;
}

console.log(`\nFOCUSED OK=${ok} FAIL=${fail.length}`);
for (const f of fail) console.log('FAIL', f);
process.exit(fail.length ? 1 : 0);
