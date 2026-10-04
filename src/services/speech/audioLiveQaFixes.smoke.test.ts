/**
 * Mic permission / cinema force / STT silence floors.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/speech/audioLiveQaFixes.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { finalizeCall1Execution } from '../../module2/router/call1Dispatch';
import { emptyTurnFrame } from '../../module2/router/turnFrame';
import { resolveMobility } from '../../module2/tour/parentBrief';

const root = process.cwd();
const stt = readFileSync(join(root, 'src/services/sttService.ts'), 'utf8');
const voice = readFileSync(join(root, 'src/hooks/useVoiceInput.ts'), 'utf8');
const dispatch = readFileSync(
  join(root, 'src/module2/router/call1Dispatch.ts'),
  'utf8',
);

assert.match(stt, /isSpeechPermissionPromptOpen/, 'permission prompt flag');
assert.match(
  stt,
  /com\.google\.android\.tts/,
  'Google TTS recognition preferred on Android',
);
assert.match(stt, /EXTRA_PREFER_OFFLINE:\s*false/, 'prefer online recognition');
assert.match(stt, /start timeout/, 'start-timeout rotates dead engines');
assert.match(
  stt,
  /EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS:\s*3_000/,
  'longer silence possible',
);
assert.match(
  voice,
  /isSpeechPermissionPromptOpen|softMuteFindusForMic/,
  'permission/softMute path in voice input',
);
assert.match(
  voice,
  /next === 'background'/,
  'AppState abort only on background (not inactive/STT focus)',
);
assert.match(voice, /pressModeRef\.current = 'locked'/, 'post-grant lock');
assert.match(
  voice,
  /replaceActive:\s*true|softMuteFindusForMic|startListening/,
  'STT start / softMute path',
);
assert.match(
  voice,
  /softStopSpeakingForMic|softMuteFindusForMic/,
  'softMute uses softStop (no ambient restore race)',
);
assert.match(
  voice,
  /Soft-Mute VOR STT|await softMuteFindusForMic/,
  'softMute before STT (no ambient race)',
);

const voiceAudio = readFileSync(
  join(root, 'src/services/AudioVoiceService.ts'),
  'utf8',
);
assert.match(
  voiceAudio,
  /if \(recordingModeArmed\) return/,
  'ambient restore blocked while mic armed',
);
assert.match(
  voiceAudio,
  /Nothing\/OEM: setIsEnabledAsync\(false\)/,
  'no hard audio disable after mic',
);
assert.equal(
  /await Audio\.setIsEnabledAsync\(false\)/.test(voiceAudio),
  false,
  'setIsEnabledAsync(false) removed from ambient restore',
);
assert.match(
  voiceAudio,
  /recordingModeArmed = false;\s*\n\s*\/\/ Finish any in-flight restore|Mic\/STT darf Playback nicht blockieren/,
  'TTS clears recordingModeArmed before playback',
);
assert.match(
  voiceAudio,
  /recordingModeArmed = false;\s*\n\s*await restoreAmbientAudioMode/,
  'mic disarms before ambient restore after STT',
);
assert.match(
  voiceAudio,
  /isFusedTurnLive/,
  'nav defers while fused Call-1/Call-2 live',
);
assert.match(
  voiceAudio,
  /expandEuroCurrencySymbols/,
  'live TTS expands euro symbols',
);
assert.match(dispatch, /cinema_force/, 'cinema force override');

const cinemaQ =
  'Ich möchte heute Abend ins Kino gehen. Welche Filme laufen heute Abend?';
const exec = finalizeCall1Execution(
  {
    execution: 'tour_module',
    bridge: null,
    bridgeComplete: false,
    askBack: null,
    frame: emptyTurnFrame(),
    work: [],
    blueprintId: null,
    blueprintStage: null,
    chatLane: null,
    session: 'new',
  } as never,
  cinemaQ,
);
assert.equal(exec, 'pitch_module', 'cinema forces pitch not tour');
assert.equal(resolveMobility(cinemaQ), 'transit_ok', 'filme laufen ≠ walk');

console.log('audioLiveQaFixes.smoke: ok');
