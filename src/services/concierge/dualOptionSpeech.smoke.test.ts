/**
 * Dual-Option Fließtext — Struktur, kein Script.
 * Run: npx --yes tsx src/services/concierge/dualOptionSpeech.smoke.test.ts
 */
import { weaveDualOptionSpoken, stripLeadingPlaceName } from './dualOptionPolicy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

{
  const t = weaveDualOptionSpoken({
    intro: 'Bei dem Wetter passt ein Eis richtig gut — zwei Orte.',
    aName: 'Eisdiele Nord',
    aPitch: 'Spaghetti-Eis für 3,80 €, fünf Minuten zu Fuß.',
    bName: 'Café Hafen',
    bPitch: 'Café Hafen: Becher mit Meerblick, etwas weiter.',
  });
  assert(/Entweder Eisdiele Nord/.test(t), `either missing: ${t}`);
  assert(/Oder Café Hafen/.test(t), `or missing: ${t}`);
  assert(/Was hört sich für dich besser an\?/.test(t), `ask missing: ${t}`);
  assert(!/Und falls der nicht sitzt/i.test(t), `list stitch leaked: ${t}`);
  assert(!/Erstens/i.test(t), `erstens leaked: ${t}`);
  assert(/3,80/.test(t) && /Meerblick/.test(t), `facts not packed: ${t}`);
  assert(/Bei dem Wetter/.test(t), `intro dropped: ${t}`);
}

{
  const t = weaveDualOptionSpoken({
    continueFromBridge: true,
    intro: 'Bei dem Wetter passt ein Eis.',
    aName: 'Eisdiele Nord',
    aPitch: 'Spaghetti-Eis für 3,80 €.',
    bName: 'Café Hafen',
    bPitch: 'Becher mit Meerblick.',
  });
  assert(!/Bei dem Wetter/.test(t), `bridge intro must not repeat: ${t}`);
  assert(/Entweder Eisdiele Nord/.test(t), `body missing: ${t}`);
}

{
  const stripped = stripLeadingPlaceName(
    'Café Hafen: Becher mit Meerblick.',
    'Café Hafen',
  );
  assert(stripped.startsWith('Becher'), `strip name: ${stripped}`);
}

console.log('[ok] dualOptionSpeech weave');
