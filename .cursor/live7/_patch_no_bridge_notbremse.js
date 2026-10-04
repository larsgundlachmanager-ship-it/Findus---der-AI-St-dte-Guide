const fs = require('fs');
const path = require('path');

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}
function write(p, s) {
  const abs = path.resolve(p);
  const tmp = abs + '.tmpwrite';
  fs.writeFileSync(tmp, s, 'utf8');
  fs.renameSync(tmp, abs);
}

// 1) bridgeGlue: Call-1 Speech nie wegen 0815 killen / ersetzen
{
  const p = 'src/module2/chat/bridgeGlue.ts';
  let s = read(p);
  s = s.replace(
    `/**
 * Bridge behalten — Lexikon/Wait-Floskeln sind Call-1-Inhalt, kein Kill.
 * Ausnahme: alleinige 0815-Floskel ohne Wunsch-Bezug → null (Cover/Anker).
 * Nur leerer String, Slot-Kleber, Fake-„weiß ich nicht“ und interne Regie raus.
 */
export function sanitizeBridgeText(text: string | null | undefined): string | null {
  let t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t) return null;
  if (WEATHER_IGNORANCE_RE.test(t)) return null;
  if (looksLikeSlotGluedBridge(t)) return null;
  if (looksLikeSoleVagueFillerBridge(t)) return null;
  if (INTERNAL_BRIDGE_RE.test(t)) {`,
    `/**
 * Bridge behalten — Lexikon/Wait-Floskeln sind Call-1-Inhalt, kein Kill.
 * Keine 0815-Notbremse / kein Ersetzen durch Anker-Zusage — Call-1 liefert die Speech.
 * Nur leerer String, Slot-Kleber, Fake-„weiß ich nicht“ und interne Regie raus.
 */
export function sanitizeBridgeText(text: string | null | undefined): string | null {
  let t = (text || '').replace(/\\s+/g, ' ').trim();
  if (!t) return null;
  if (WEATHER_IGNORANCE_RE.test(t)) return null;
  if (looksLikeSlotGluedBridge(t)) return null;
  if (INTERNAL_BRIDGE_RE.test(t)) {`,
  );
  // Deprecate ensureBridgeAnchoredToAsk as no-op pass-through (Call-1 owns speech)
  s = s.replace(
    `/** Ersetzt reine Floskel-Bridge durch kurze Zusagen mit Wunsch-Bezug. */
export function ensureBridgeAnchoredToAsk(
  bridge: string | null | undefined,
  userText: string,
): string | null {
  const raw = (bridge || '').replace(/\\s+/g, ' ').trim();
  const user = (userText || '').replace(/\\s+/g, ' ').trim();
  if (!raw) return null;
  if (!looksLikeSoleVagueFillerBridge(raw)) return raw;
  const anchor = extractBridgeAskAnchor(user);
  if (!anchor) return null;
  return \`Alles klar — ich kümmere mich um \${anchor}.\`;
}`,
    `/**
 * @deprecated Keine Notbremse mehr — Call-1-Bridge unverändert durchreichen.
 * Bleibt exportiert für alte Imports; ersetzt nichts.
 */
export function ensureBridgeAnchoredToAsk(
  bridge: string | null | undefined,
  _userText?: string,
): string | null {
  const raw = (bridge || '').replace(/\\s+/g, ' ').trim();
  return raw || null;
}`,
  );
  write(p, s);
  console.log('bridgeGlue: no filler kill / no re-anchor');
}

// 2) runConciergeTurn: remove ensureBridgeAnchoredToAsk usage
{
  const p = 'src/module2/router/runConciergeTurn.ts';
  let s = read(p);
  const old = `    const {
      sanitizeBridgeText,
      ensureBridgeAnchoredToAsk,
      scrubBridgeCityLeak,
      scrubTriviaClarifyBridge,
      scrubPrematureTriviaFacts,
      scrubAffiliateMonetizationSpeech,
    } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      ensureBridgeAnchoredToAsk: (
        bridge: string | null | undefined,
        userText: string,
      ) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
      scrubTriviaClarifyBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubPrematureTriviaFacts: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubAffiliateMonetizationSpeech: (s: string | null | undefined) => string;
    };
    const beforeSanitize = t;
    t = sanitizeBridgeText(t) || '';
    if (!t && opts?.userText) {
      t = ensureBridgeAnchoredToAsk(beforeSanitize, opts.userText) || '';
    }`;
  const neu = `    const {
      sanitizeBridgeText,
      scrubBridgeCityLeak,
      scrubTriviaClarifyBridge,
      scrubPrematureTriviaFacts,
      scrubAffiliateMonetizationSpeech,
    } = require('../chat/butlerOfferBus') as {
      sanitizeBridgeText: (s: string | null) => string | null;
      scrubBridgeCityLeak: (o: {
        bridge: string;
        userText: string;
        gpsCities?: Array<string | null | undefined> | null;
      }) => string;
      scrubTriviaClarifyBridge: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubPrematureTriviaFacts: (o: {
        bridge: string;
        userText: string;
      }) => string | null;
      scrubAffiliateMonetizationSpeech: (s: string | null | undefined) => string;
    };
    // Call-1 Bridge 1:1 — keine Floskel-Notbremse / kein Ersatz-Text
    t = sanitizeBridgeText(t) || '';`;
  if (!s.includes(old)) {
    console.log('runConciergeTurn: block mismatch');
  } else {
    write(p, s.replace(old, neu));
    console.log('runConciergeTurn: notbremse removed');
  }
}

// 3) smoke update
{
  const p = 'src/module2/chat/bridgeGlue.smoke.test.ts';
  let s = read(p);
  s = s.replace(
    `assert(
  sanitizeBridgeText('Ich schau mal kurz') === null,
  'sole vague filler killed',
);
assert(
  looksLikeSoleVagueFillerBridge('Wissen kommt gleich') === true,
  'wissen kommt gleich is vague',
);
assert(
  /All-you-can-eat|All-you-can-eat/i.test(
    ensureBridgeAnchoredToAsk('Wissen kommt gleich', 'Morgen All you can eat kein asiatisch') || '',
  ),
  'vague bridge re-anchored to AYCE',
);`,
    `assert(
  sanitizeBridgeText('Ich schau mal kurz') != null,
  'Call-1 wait bridge kept — no filler Notbremse',
);
assert(
  looksLikeSoleVagueFillerBridge('Wissen kommt gleich') === true,
  'wissen kommt gleich is vague (detect only, no kill)',
);
assert(
  ensureBridgeAnchoredToAsk('Wissen kommt gleich', 'Morgen All you can eat kein asiatisch') ===
    'Wissen kommt gleich',
  'no re-anchor Notbremse — Call-1 text unchanged',
);`,
  );
  write(p, s);
  console.log('smoke updated');
}

console.log('done');
