/**
 * Run: npx --yes tsx src/services/concierge/coreWovenSpeech.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { weatherOpenerFromMatrix } from '../persona/weatherGuideVoice';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const policy = readFileSync(
  join(process.cwd(), 'src/services/concierge/findusResponsePolicy.ts'),
  'utf8',
);
assert(/FINDUS_SPEECH_CULTURE_BLOCK/.test(policy), 'speech culture SSOT exists');
assert(/FINDUS_CORE_WOVEN_SPEECH_BLOCK/.test(policy), 'core woven alias exists');
assert(/ZWEI SCHICHTEN/i.test(policy), 'two-layer culture then personality');
assert(/NUTZEN-TEST/i.test(policy), 'every sentence must earn its place');
assert(/vollständige/i.test(policy), 'complete sentences rule');
assert(/ZUSAMMENFASSEN/i.test(policy), 'summarize as prose');
assert(/Wetter-App-Opener/i.test(policy), 'no weather app opener in policy');

const opener = weatherOpenerFromMatrix({
  matrix: { coreRole: 'classic_guide', vibeTone: 'balanced' },
  cityHint: 'Hamburg',
});
assert(!/sieht es so aus/i.test(opener), 'classic weather opener not robotic');

const pack = readFileSync(
  join(process.cwd(), 'src/module2/blueprints/ownerGold.pack.json'),
  'utf8',
);
assert(
  pack.includes('general::loose_complete_summary_v1'),
  'owner gold loose complete summary',
);
assert(
  pack.includes('general::speech_culture_v1'),
  'owner gold speech culture',
);

const synth = readFileSync(
  join(process.cwd(), 'src/module2/reboot/synthesizeReboot.ts'),
  'utf8',
);
const chat = readFileSync(
  join(process.cwd(), 'src/module2/chat/runChatLane.ts'),
  'utf8',
);
assert(synth.includes('FINDUS_CORE_WOVEN_SPEECH_BLOCK'), 'reboot synthesis policy');
assert(
  chat.includes('FINDUS_CORE_WOVEN_SPEECH_BLOCK') &&
    chat.includes('buildPersonalityMatrixPromptBlock'),
  'chat lane gets policy + matrix voice',
);

const matrix = readFileSync(
  join(process.cwd(), 'src/services/persona/matrixSpeechStyle.ts'),
  'utf8',
);
assert(/KURZ ≠ ABGEHACKT/i.test(matrix), 'matrix: short != choppy');
assert(/OVERLAY/i.test(matrix), 'matrix is personality overlay');

const plan = readFileSync(
  join(process.cwd(), 'src/module2/planning/planAgentSession.ts'),
  'utf8',
);
assert(
  plan.includes('FINDUS_SPEECH_CULTURE_BLOCK'),
  'plan agent gets speech culture',
);

const welcome = readFileSync(
  join(process.cwd(), 'src/services/cityWelcomeService.ts'),
  'utf8',
);
assert(
  welcome.includes('FINDUS_SPEECH_CULTURE_BLOCK') &&
    welcome.includes('buildPersonalityMatrixPromptBlock'),
  'city welcome gets culture + overlay',
);

const pitch = readFileSync(
  join(process.cwd(), 'src/module2/pitch/pitchSpeech.ts'),
  'utf8',
);
assert(pitch.includes('FINDUS_SPEECH_CULTURE_BLOCK'), 'pitch gets speech culture');

const ingest = readFileSync(
  join(process.cwd(), 'src/module2/planning/planningLlmIngestion.ts'),
  'utf8',
);
assert(
  ingest.includes('FINDUS_SPEECH_CULTURE_BLOCK'),
  'plan ingest gets speech culture',
);

const appendix = readFileSync(
  join(process.cwd(), 'src/services/concierge/findusResponsePolicy.ts'),
  'utf8',
);
assert(
  /FINDUS_REISEBUERO_DEEP_BRIEFING_BLOCK/.test(appendix) &&
    appendix.includes('FINDUS_REISEBUERO_DEEP_BRIEFING_BLOCK,'),
  'reisebuero briefing in core appendix',
);
assert(/SPRACHKULTUR 1:1/.test(appendix), 'reisebuero briefing cites speech culture');

const recapSrc = readFileSync(
  join(process.cwd(), 'src/reisebuero/recapSpeech.ts'),
  'utf8',
);
assert(
  recapSrc.includes('weaveSpokenFacts') && !/mid\.join\(' · '\)/.test(recapSrc),
  'reisebuero recap weaves instead of telegram',
);

const navSrc = readFileSync(
  join(process.cwd(), 'src/services/navigation/spatialOrientation.ts'),
  'utf8',
);
assert(
  navSrc.includes('weaveComplexNavCue') && !/nimm \$\{turn\}/.test(navSrc),
  'nav complex forks weave, no nimm-telegram',
);
assert(
  readFileSync(
    join(process.cwd(), 'src/services/navigation/handsFreeNav/cueScheduler.ts'),
    'utf8',
  ).includes('Einfache Gabel'),
  'simple forks stay cache phrases',
);

const guardSrc = readFileSync(
  join(process.cwd(), 'src/services/agi/speechGuardrails.ts'),
  'utf8',
);
assert(
  guardSrc.includes('sieht\\s+es\\s+so\\s+aus'),
  'guardrails strip weather boilerplate opener',
);
assert(/Erstens\|Zweitens\|Drittens/.test(guardSrc), 'guardrails strip list voice');

const engine = readFileSync(
  join(process.cwd(), 'src/services/personaEngine.ts'),
  'utf8',
);
assert(/zwei Schichten/i.test(engine), 'master prompt two-layer speech');
assert(
  !/Nutze natürliche gesprochene Füllwörter/.test(engine),
  'no filler-word mandate',
);

const promptBuilder = readFileSync(
  join(process.cwd(), 'src/services/ai/promptBuilder.ts'),
  'utf8',
);
assert(
  promptBuilder.includes('FINDUS_SPEECH_CULTURE_BLOCK'),
  'POI prompts include speech culture',
);
assert(
  !/Streue natürliche Satzanfänge/.test(promptBuilder),
  'no filler-start mandate in promptBuilder',
);
assert(
  !/Pollenallergie|Baumschule\?/.test(promptBuilder),
  'no pollen/tree-nursery script in promptBuilder',
);

const promptsTs = readFileSync(
  join(process.cwd(), 'src/constants/prompts.ts'),
  'utf8',
);
assert(!/3–6 sentences/.test(promptsTs), 'no 3–6 sentence quota');

const m1 = readFileSync(
  join(process.cwd(), 'src/services/ai/module1PromptBuilders.ts'),
  'utf8',
);
assert(
  m1.includes('FINDUS_SPEECH_CULTURE_BLOCK'),
  'module1 prompts include speech culture',
);

const fastHook = readFileSync(
  join(process.cwd(), 'src/services/ai/fastHook.ts'),
  'utf8',
);
assert(!/Pollenallergie|Pollen-Check/.test(fastHook), 'no pollen script in fastHook');
assert(!/Bilsbekbrücke/.test(fastHook), 'no Bilsbek place-script in fastHook');
assert(!/Schau mal/.test(fastHook), 'no schau-mal scripts in fastHook');

console.log('coreWovenSpeech.smoke.test.ts OK');
