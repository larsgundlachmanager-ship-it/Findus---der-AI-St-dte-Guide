/**
 * Modul 5 — Smoke-Checks (ohne LLM): Speech, Bullets, Task-Ableitung, Opfer-Prio.
 * Run: node scripts/test-modul5-stations.mjs
 */
import assert from 'node:assert/strict';

// Inline mirrors of sanitize / bullets (keep in sync with planSpeechSanitize.ts)
const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g;
const PHONE_RE = /(?:\+|00)?\d[\d\s/().-]{6,}\d/g;

function sanitize(text) {
  return String(text)
    .replace(EMAIL_RE, '')
    .replace(PHONE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function bullets(raw, max = 3) {
  const cleaned = raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  const score = (s) => {
    let n = 0;
    if (/\d/.test(s)) n += 3;
    if (/€|eur|stern|bewert|min|km/i.test(s)) n += 2;
    return n;
  };
  return [...cleaned].sort((a, b) => score(b) - score(a)).slice(0, max);
}

function sacrificeOrder(prio) {
  // returns action
  if (prio === 6) return 'drop';
  if (prio === 5) return 'ask_delete';
  if (prio === 4) return 'shift_only';
  if (prio === 3) return 'ask';
  return 'sacred';
}

function reminderLeads(prio, isTransitLeg) {
  if (isTransitLeg) return [10];
  if (prio === 5 || prio === 6) return [];
  if (prio === 1 || prio === 2 || prio === 3) return [30, 5];
  if (prio === 4) return [5];
  return [5];
}

assert.equal(sanitize('Ruf an +49 40 12345678 und mail@test.de').includes('@'), false);
assert.ok(!/\d{5,}/.test(sanitize('Tel 04012345678 passt')));
assert.deepEqual(bullets(['Fluff', '22 €', 'Top bewertet', 'noch was']), [
  '22 €',
  'Top bewertet',
  'Fluff',
].slice(0, 3));
assert.equal(sacrificeOrder(6), 'drop');
assert.equal(sacrificeOrder(5), 'ask_delete');
assert.equal(sacrificeOrder(4), 'shift_only');
assert.equal(sacrificeOrder(3), 'ask');
assert.equal(sacrificeOrder(1), 'sacred');
assert.deepEqual(reminderLeads(1, false), [30, 5]);
assert.deepEqual(reminderLeads(3, false), [30, 5]);
assert.deepEqual(reminderLeads(4, false), [5]);
assert.deepEqual(reminderLeads(5, false), []);
assert.deepEqual(reminderLeads(6, false), []);
assert.deepEqual(reminderLeads(4, true), [10]);

console.log('modul5 stations smoke OK');
