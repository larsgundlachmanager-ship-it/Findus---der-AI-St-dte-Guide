/**
 * Smoke: Mid-nav Mode-Switch Intent (ÖPNV → Fuß) — source + pure regex checks.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/switchActiveNavTravelMode.smoke.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const switchSrc = fs.readFileSync(
  path.join(process.cwd(), 'src/services/navigation/switchActiveNavTravelMode.ts'),
  'utf8',
);
const turnSrc = fs.readFileSync(
  path.join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);

assert(
  switchSrc.includes('trySwitchActiveNavTravelMode'),
  'exports trySwitchActiveNavTravelMode',
);
assert(
  switchSrc.includes('clearMultiStopTour'),
  'tears down multi-stop journey',
);
assert(
  switchSrc.includes('clearRememberedJourney'),
  'clears remembered ÖPNV journey',
);
assert(
  switchSrc.includes('commitMode: mode'),
  'restarts with commitMode foot/bike',
);
assert(
  switchSrc.includes('Ankunft gegen'),
  'announces arrival clock',
);

assert(
  switchSrc.includes('previewActiveNavModeSwitchBridge'),
  'preview for early bridge',
);
assert(
  switchSrc.includes('beende die ÖPNV-Route') ||
    switchSrc.includes('ÖPNV-Route'),
  'bridge confirms ending transit',
);
assert(
  switchSrc.includes('formatActiveNavCall1Flag'),
  'Call-1 FLAG helper',
);
assert(
  turnSrc.includes('previewActiveNavModeSwitchBridge'),
  'runConciergeTurn early bridge preview',
);
assert(
  turnSrc.includes('earlyNavModeSwitchPromise') ||
    turnSrc.includes('earlyNavModeSwitchBridge'),
  'early mode-switch state',
);
assert(
  turnSrc.includes('trySwitchActiveNavTravelMode'),
  'runConciergeTurn wires mid-nav switch',
);

// Pure intent heuristics (spiegeln travelModeContext + switchActiveNavTravelMode)
function detectFootOrBike(t: string): 'foot' | 'bike' | null {
  const s = t.trim().toLowerCase();
  if (
    /\b(ich\s+bin\s+)?(mit\s+dem\s+)?(fahrrad|rad|bike)\s*(unterwegs)?\b/i.test(
      s,
    ) ||
    (/\b(fahrrad|mit\s+dem\s+rad)\b/i.test(s) &&
      /\b(nach|zu|wie\s+lange|route)\b/i.test(s))
  ) {
    return 'bike';
  }
  // ß ist in JS kein \w — kein `\bfuß\b`; Lookahead nach ß / Fallback laufen+zu
  if (
    /\b(ich\s+bin\s+)?(zu\s+fu(?:ss|ß|ße)|laufend)\s*(unterwegs)?(?:\b|(?=\s|$))/i.test(
      s,
    ) ||
    /\bich\s+(geh|gehe|laufe|lauf)\s+(zu\s+fu(?:ss|ß)|jetzt)\b/i.test(s) ||
    (/\b(zu\s+fu(?:ss|ß|ße)|laufen|gehend)(?:\b|(?=\s|$))/i.test(s) &&
      /\b(nach|zu|wie\s+lange|brauch|dauer|minuten|route|weg|lieber|doch|möchte|moechte|will|starte?)\b/i.test(
        s,
      ))
  ) {
    return 'foot';
  }
  return null;
}

function isSwitch(text: string): 'foot' | 'bike' | null {
  const mode = detectFootOrBike(text);
  if (!mode) return null;
  const hasSwitchVerb =
    /\b(lieber|doch|statt|umstell|wechsel|änder|aender|starte?|neu\s+planen|abbrechen|möchte|moechte|will|lass\s+uns)\b/iu.test(
      text,
    ) ||
    /\b(zu\s+fu[sß]|zu\s*fuss)\s*(laufen|gehen)\b/iu.test(text) ||
    /\bich\s+bin\s+.{0,24}(zu\s+fu[sß]|mit\s+dem\s+(fahrrad|rad))\b/iu.test(
      text,
    );
  const etaOnly =
    /\b(wie\s+lange|noch\s+wie\s+lange|brauch(?:e|)\s+ich\s+noch)\b/iu.test(
      text,
    ) && !hasSwitchVerb;
  if (etaOnly || !hasSwitchVerb) return null;
  return mode;
}

assert(
  isSwitch('ah ich möchte doch lieber zu Fuß laufen') === 'foot',
  'lieber zu Fuß → switch',
);
assert(
  isSwitch('Starte eine Route zu Fuß') === 'foot',
  'starte Route zu Fuß → switch',
);
assert(isSwitch('wie lange noch zu Fuß?') === null, 'ETA-only no switch');
assert(
  isSwitch('ich bin mit dem Fahrrad unterwegs') === 'bike',
  'bike claim → switch',
);
assert(
  isSwitch('wie lange mit dem Fahrrad nach Pinneberg') === null,
  'bike ETA ask no switch',
);

console.log('switchActiveNavTravelMode.smoke.test.ts OK');
