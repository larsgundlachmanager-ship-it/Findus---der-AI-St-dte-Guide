import assert from 'node:assert/strict';
import { stripInternalWorkerSpeech } from './speechHumanOnly';
import { humanizeAgentDraft } from './draftToHumanSpeech';

const leaked =
  'Sticky-Auftrag[taxi_airport] · Wunsch=Flug · Gap=presence · OffeneTasks=taxi. Der Flug geht um achtzehn Uhr. Task-Loop: Ziel inventiere Tasks. Gap-Engine aktiv.';

const spoken = stripInternalWorkerSpeech(leaked);
assert.equal(spoken, 'Der Flug geht um achtzehn Uhr.');
assert.doesNotMatch(spoken, /Sticky-Auftrag|Task-Loop|Gap-Engine|OffeneTasks/);

const draft = humanizeAgentDraft(
  'FAKTEN: Sticky-Auftrag bleibt intern. Der Zug fährt in zwanzig Minuten.',
);
assert.match(draft, /Der Zug fährt/);
assert.doesNotMatch(draft, /Sticky-Auftrag/);

console.log('speechHumanOnly.smoke: ok');
