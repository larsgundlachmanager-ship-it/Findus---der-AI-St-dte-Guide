from pathlib import Path

# --- parentBrief briefkasten ---
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\parentBrief.ts")
t = p.read_text(encoding="utf-8")
if "text: 'briefkasten'" not in t:
    needle = """  if (
    /\\b(toilette|klo|\\bwc\\b|apotheke|geldautomat|\\batm\\b|ladestation|powerbank)\\b/iu.test(
      t,
    )
  ) {"""
    insert = """  if (
    /\\b(briefkasten|postkasten|packstation|postfiliale|mailbox|post_box)\\b/iu.test(t)
  ) {
    pushMust({
      text: 'briefkasten',
      hardness: 'must',
      kind: 'amenity',
    });
  }
""" + needle
    if needle not in t:
        raise SystemExit("parentBrief needle missing")
    t = t.replace(needle, insert, 1)
    p.write_text(t, encoding="utf-8")
    print("parentBrief: briefkasten amenity added")
else:
    print("parentBrief: already has briefkasten")

# --- euro harden in prepareAudioText ---
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\services\g2p\phoneticTransformer.ts")
t2 = p2.read_text(encoding="utf-8")
old = """export function prepareAudioText(text: string): string {
  let s = prepareDisplayText(text);
  if (!s) return s;
  const { expandRomanNumeralsForSpeech } = require('./romanNumeralsSpeech') as {
    expandRomanNumeralsForSpeech: (t: string) => string;
  };
  s = expandRomanNumeralsForSpeech(s);
  s = stripArtificialBreathPauses(s);
  return s.replace(/\\s+/g, ' ').trim();
}"""
new = """export function prepareAudioText(text: string): string {
  let s = prepareDisplayText(text);
  if (!s) return s;
  const { expandRomanNumeralsForSpeech } = require('./romanNumeralsSpeech') as {
    expandRomanNumeralsForSpeech: (t: string) => string;
  };
  s = expandRomanNumeralsForSpeech(s);
  // Cartesia liest restliches € oft als „O“ — immer aussprechen
  s = s.replace(/\\u20ac/g, ' Euro').replace(/\\bEUR\\b/gi, 'Euro');
  s = s.replace(/\\bEuro\\s*[Oo]\\b/g, 'Euro');
  s = stripArtificialBreathPauses(s);
  return s.replace(/\\s+/g, ' ').trim();
}"""
if "Cartesia liest restliches" not in t2:
    if old not in t2:
        raise SystemExit("prepareAudioText block missing")
    t2 = t2.replace(old, new, 1)
    p2.write_text(t2, encoding="utf-8")
    print("phoneticTransformer: euro harden ok")
else:
    print("phoneticTransformer: already hardened")

# smoke snippet for euro
smoke = Path(r"c:\Users\larsf\Findus 2.0\src\services\g2p\euroSpeech.smoke.test.ts")
smoke.write_text(
    """/**
 * Euro darf nie als „O“ gesprochen werden.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/g2p/euroSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { prepareAudioText } from './phoneticTransformer';

const a = prepareAudioText('Ticket nur 5€');
assert.match(a, /Euro/i, '€ → Euro');
assert.doesNotMatch(a, /€/, 'kein €-Symbol im Audio');
assert.doesNotMatch(a, /\\bEuro\\s+O\\b/i, 'kein Euro O');

const b = prepareAudioText('Eintritt liegt bei 5 Euro O');
assert.equal(b.includes('Euro O'), false, 'Euro O bereinigt');
assert.match(b, /Euro/i);

console.log('euroSpeech.smoke: ok');
""",
    encoding="utf-8",
)
print("smoke written")
