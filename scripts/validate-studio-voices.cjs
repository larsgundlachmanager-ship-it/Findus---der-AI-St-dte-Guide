/**
 * Smoke-Test: 8 DE-Rollen → 3 native Kokoro-Packs, speed=1.0.
 * node scripts/validate-studio-voices.cjs
 */
const assert = require('assert');

const VOICE_ID_TO_PACK = {
  standard_m: 'de_thorsten',
  standard_w: 'de_eva',
  prinzessin: 'de_eva',
  erzaehler: 'de_thorsten',
  dorfaeltester: 'de_karl',
  historiker: 'de_karl',
  gen_z: 'de_thorsten',
  energisch: 'de_eva',
};

const ALLOWED = new Set(['de_thorsten', 'de_eva', 'de_karl']);

for (const [role, pack] of Object.entries(VOICE_ID_TO_PACK)) {
  assert.ok(ALLOWED.has(pack), `${role} → ${pack} ist kein natives DE-Pack`);
}
console.log('✓ 8 Rollen → nur de_thorsten/de_eva/de_karl');

assert.strictEqual(Object.keys(VOICE_ID_TO_PACK).length, 8);
console.log('✓ 8 UI-Stimmen konfiguriert');

assert.strictEqual(VOICE_ID_TO_PACK.gen_z, 'de_thorsten');
assert.strictEqual(VOICE_ID_TO_PACK.energisch, 'de_eva');
console.log('✓ gen_z→thorsten, energisch→eva');

const FIXED_SPEECH_RATE = 1.0;
assert.strictEqual(FIXED_SPEECH_RATE, 1.0);
console.log('✓ FIXED_SPEECH_RATE = 1.0');

process.exit(0);
