/**
 * Euro darf nie als „O“ gesprochen/angezeigt werden.
 * Live-Pfad = AudioVoiceService.prepareAudioText (nicht nur g2p-Alias).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/g2p/euroSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const voice = readFileSync(join(root, 'src/services/AudioVoiceService.ts'), 'utf8');
const g2p = readFileSync(join(root, 'src/services/g2p/phoneticTransformer.ts'), 'utf8');
const guard = readFileSync(join(root, 'src/services/agi/speechGuardrails.ts'), 'utf8');

assert.match(voice, /export function expandEuroCurrencySymbols/, 'live euro helper');
assert.match(voice, /expandEuroCurrencySymbols\(out\)/, 'display expands euro');
assert.match(voice, /expandEuroCurrencySymbols\(t\)/, 'audio expands euro');
assert.match(voice, /Euro\\s\*\[Oo\]/, 'Euro O cleanup in live path');
assert.match(g2p, /Cartesia liest restliches/, 'g2p euro harden');
assert.match(guard, /\\u20ac/, 'guardrails bare euro');
assert.match(guard, /Euro\\s\*\[Oo\]/, 'guardrails Euro O cleanup');

/** Spiegel von expandEuroCurrencySymbols (ohne RN-Imports). */
function expandEuroForSpeech(text: string): string {
  let t = text;
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*[-–—]?\s*\u20ac/g, '$1 Euro');
  t = t.replace(/\u20ac\s*(\d+(?:[.,]\d+)?)/g, '$1 Euro');
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*EUR\b/gi, '$1 Euro');
  t = t.replace(/\u20ac/g, ' Euro');
  t = t.replace(/\bEUR\b/gi, 'Euro');
  t = t.replace(/\bEuro(?:\s+Euro)+\b/gi, 'Euro');
  t = t.replace(/\bEuro\s*[Oo]\b/g, 'Euro');
  return t.replace(/\s+/g, ' ').trim();
}

const samples: Array<[string, RegExp]> = [
  ['Ticket ~5 €', /5 Euro/],
  ['5 Euro €', /^5 Euro$/],
  ['5,- €', /5.*Euro/],
  ['Eintritt €', /Euro/],
  ['5 Euro O', /^5 Euro$/],
  ['Kino kostet 5€.', /5 Euro/],
];

for (const [raw, re] of samples) {
  const out = expandEuroForSpeech(raw);
  assert.match(out, re, `expand: ${JSON.stringify(raw)} → ${JSON.stringify(out)}`);
  assert.equal(/\u20ac/.test(out), false, `no raw euro left: ${JSON.stringify(out)}`);
  assert.equal(/\bEuro\s+[Oo]\b/.test(out), false, `no Euro O: ${JSON.stringify(out)}`);
}

console.log('euroSpeech.smoke: ok');
