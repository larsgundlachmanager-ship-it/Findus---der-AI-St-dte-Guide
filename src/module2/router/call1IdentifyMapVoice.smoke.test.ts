/**
 * Identify-Nearby / Map-Pin / Voice-Device Worker Smokes (ohne Netz/GPS-API).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1IdentifyMapVoice.smoke.test.ts
 */

import assert from 'node:assert/strict';
import {
  executionFromWorkers,
  workerToExecutionHint,
} from './call1CapabilityMap';
import { wantsIdentifyNearby } from './call1IdentifyNearbyWorker';
import {
  extractMapPinSubject,
  wantsMapPin,
} from './call1MapPinWorker';
import {
  wantsDeviceTravelMode,
  wantsVoiceSettings,
} from './call1VoiceDeviceWorker';
import { buildCall1TaskBrief } from './call1TaskBrief';
import { emptyTurnFrame } from './turnFrame';
import type { ManagerAnalysis } from './types';

assert.equal(wantsIdentifyNearby('Was ist das?'), true);
assert.equal(wantsIdentifyNearby('Wo bin ich hier gerade?'), true);
assert.equal(wantsIdentifyNearby('SUP auf der Alster'), false);

assert.equal(wantsMapPin('Zeig den Michel auf der Karte'), true);
assert.equal(extractMapPinSubject('Zeig den Michel auf der Karte'), 'Michel');
assert.equal(
  extractMapPinSubject('Wo ist das Marinedenkmal auf der Karte?'),
  'Marinedenkmal',
);
assert.equal(wantsMapPin('Bring mich zum Michel'), false);

assert.equal(wantsVoiceSettings('Stimme von Alina'), true);
assert.equal(wantsVoiceSettings('Stimme ändern'), true);
assert.equal(wantsVoiceSettings('Wie ist das Wetter?'), false);

assert.equal(wantsDeviceTravelMode('Ich bin mit dem Fahrrad'), true);
assert.equal(wantsDeviceTravelMode('Ich bin zu Fuß unterwegs'), true);
assert.equal(wantsDeviceTravelMode('Wo waren wir gestern?'), false);

assert.equal(workerToExecutionHint('identify_nearby'), 'task_fanout');
assert.equal(workerToExecutionHint('map_pin'), 'task_fanout');
assert.equal(workerToExecutionHint('voice_settings'), 'task_fanout');
assert.equal(workerToExecutionHint('device_action'), 'task_fanout');
assert.equal(executionFromWorkers(['identify_nearby']), 'task_fanout');
assert.equal(executionFromWorkers(['map_pin']), 'task_fanout');
assert.equal(executionFromWorkers(['m1_poi']), 'm1_poi');

const analysis: ManagerAnalysis = {
  intentSummary: 'test',
  route: 'blueprint',
  blueprintId: null,
  blueprintStage: null,
  session: 'new',
  threadMatchId: null,
  subject: null,
  bridge: 'Kurz.',
  lanePlan: 'fast_only',
  pace: 'standard',
  bridgeMaxWords: 36,
  fastDeadlineMs: 8000,
  latencyHintSec: null,
  tasks: [],
  openLoops: [],
  nameAllowed: false,
  jobHint: null,
  chatLane: 'chat',
  frame: emptyTurnFrame(),
};

assert.ok(
  buildCall1TaskBrief({
    analysis,
    userText: 'Was ist das für ein Turm?',
  }).work.some((w) => w.worker === 'identify_nearby'),
  'brief injects identify_nearby',
);

assert.ok(
  buildCall1TaskBrief({
    analysis,
    userText: 'Zeig den Michel auf der Karte',
  }).work.some((w) => w.worker === 'map_pin'),
  'brief injects map_pin',
);

assert.ok(
  buildCall1TaskBrief({
    analysis,
    userText: 'Stimme von Lukas',
  }).work.some((w) => w.worker === 'voice_settings'),
  'brief injects voice_settings',
);

assert.ok(
  buildCall1TaskBrief({
    analysis,
    userText: 'Ich bin mit dem Rad unterwegs',
  }).work.some((w) => w.worker === 'device_action'),
  'brief injects device_action',
);

console.log('call1IdentifyMapVoice.smoke.test.ts OK');
