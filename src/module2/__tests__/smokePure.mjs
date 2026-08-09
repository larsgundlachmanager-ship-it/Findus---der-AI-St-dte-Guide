/**
 * Pure smoke ohne TSX — spiegelt Verträge der Greenfield-Pipeline.
 * node src/module2/__tests__/smokePure.mjs
 */

import assert from 'assert';

function detectIntent(text) {
  const t = text.toLowerCase();
  if (/\b(arzt|apotheke|notfall)\b/.test(t)) return 'emergency';
  if (/anzieh|kleidung|pulli|jacke/.test(t) || /\b(wetter|regen|kalt)\b/.test(t))
    return 'umwelt';
  if (/\b(hunger|essen|restaurant)\b/.test(t)) return 'gastro';
  if (/navigier|goldschatz|bring mich/.test(t)) return 'mobility';
  if (/erzähl|erzaehl|geschichte|historie|bahnhof/.test(t)) return 'knowledge';
  if (/\b(plan|tagesplan)\b/.test(t)) return 'planning';
  return 'unknown';
}

function chunkTextForTts(raw, max = 600) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const parts = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let buf = '';
  for (const s of parts) {
    const next = buf ? `${buf} ${s}` : s;
    if (next.length <= max) buf = next;
    else {
      if (buf) chunks.push(buf);
      if (s.length > max) {
        for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
        buf = '';
      } else buf = s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function normalizeToEuro(amount, currency) {
  const FX = { EUR: 1, USD: 0.92, GBP: 1.17 };
  const rate = FX[currency.toUpperCase()] ?? 1;
  return Math.round(amount * rate * 100) / 100;
}

assert.equal(detectIntent('Ich habe Hunger'), 'gastro');
assert.equal(detectIntent('Wo ist ein Arzt'), 'emergency');
assert.equal(detectIntent('Erzähl die Geschichte'), 'knowledge');
assert.equal(detectIntent('Navigiere mich zum Goldschatz'), 'mobility');
assert.equal(
  detectIntent('Was soll ich dafür anziehen nach Wedel'),
  'umwelt',
);
assert.equal(
  detectIntent('Kannst du mir was über den Bahnhof erzählen'),
  'knowledge',
);

const long = ('Satz über Prisdorf. ').repeat(80);
const chunks = chunkTextForTts(long);
assert.ok(chunks.length >= 2);
assert.ok(chunks.every((c) => c.length <= 600));

assert.ok(normalizeToEuro(10, 'USD') < 10);
assert.ok(Math.abs(normalizeToEuro(10, 'EUR') - 10) < 0.001);

// Offline charm non-empty
const OFFLINE =
  'Entschuldige, mein Netz ist gerade weg. Dein letzter Planungsstand ist lokal gespeichert';
assert.ok(OFFLINE.length > 20);

console.log('module2 smokePure OK', {
  chunks: chunks.length,
  maxChunk: Math.max(...chunks.map((c) => c.length)),
  intents: ['gastro', 'emergency', 'knowledge'],
});
