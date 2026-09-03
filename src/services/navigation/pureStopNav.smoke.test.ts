/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/pureStopNav.smoke.test.ts
 *
 * „beende Navigation“ darf keinen Folgestart (Sticky/STT-Noise/In-flight) auslösen.
 * Kein RN-Import — nur die pure Intent-Helfer (Regex-Logik inline gespiegelt + Source-Gate).
 */
import fs from 'node:fs';
import path from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const CLEAR_ROUTE_RE =
  /\b((?:beende?|beenden|stopp(?:e|en)?|stop|abbrechen)\s+(?:bitte\s+)?(?:die\s+)?(?:navigation|navi|route)|(?:navigation|navi|route)\s+(?:bitte\s+)?(?:löschen|loeschen|abbrechen|beenden|aus|stopp|stoppen)|stopp\s+(?:die\s+)?(?:route|navigation)|navi\s+(?:aus|stopp|stop|beenden)|ziel\s+(?:löschen|loeschen|vergessen)|clear\s+route)\b/iu;

const HARD_DEST_RE =
  /\b(?:bring\s+mich\s+(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+|navigier(?:e|en|t)?\s+(?:mich\s+)?(?:jetzt\s+)?(?:zum|zur|nach|zu)\s+)\s*([A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*(?:\s+[A-ZÄÖÜa-zäöüß0-9][\wÄÖÜäöüß\-&.']*){0,4})/iu;

const EXPLICIT_NAV_RE =
  /\b(?:bring\s+mich|führ\s+mich|fuehr\s+mich|navigier(?:e|en|t)?(?:\s+(?:mich|werden))?)\b/iu;

function isClear(text: string): boolean {
  return CLEAR_ROUTE_RE.test(text.replace(/\s+/g, ' ').trim());
}

function stripContinue(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!CLEAR_ROUTE_RE.test(t)) return null;
  let rest = t.replace(CLEAR_ROUTE_RE, ' ').replace(/\s+/g, ' ').trim();
  rest = rest.replace(/^(?:[,.!\s]|und|aber|dann|bitte)+/giu, '').trim();
  if (!rest || rest.length < 4) return null;
  if (/^(bitte|danke|ok|okay|mal|jetzt|einmal)[.!]?$/iu.test(rest)) return null;
  if (EXPLICIT_NAV_RE.test(rest)) return rest;
  if (HARD_DEST_RE.test(rest) || /\b(?:bring|führ|fuehr|navigier|nimm|nehm)\b/iu.test(rest)) {
    return rest;
  }
  return null;
}

function isPure(text: string): boolean {
  return isClear(text) && stripContinue(text) == null;
}

assert(isClear('beende Navigation'), 'beende Navigation = clear');
assert(isPure('beende Navigation'), 'pure stop');
assert(
  isPure('beende Navigation Sporthalle Pristafkin'),
  'STT-Noise Ortsname nach Stop = pure',
);
assert(
  stripContinue('beende Navigation Sporthalle Pristafkin') == null,
  'kein Continue auf Bloß-Ortsname',
);

const compound = stripContinue(
  'beende Navigation und bring mich zum Tennisclub',
);
assert(
  compound != null && /bring mich zum Tennisclub/i.test(compound),
  `compound continue, got: ${compound}`,
);
assert(
  !isPure('beende Navigation und bring mich zum Tennisclub'),
  'compound is not pure',
);

const srcDir = path.join(process.cwd(), 'src/services/navigation');
const hard = fs.readFileSync(path.join(srcDir, 'hardNavOverride.ts'), 'utf8');
const voice = fs.readFileSync(
  path.join(process.cwd(), 'src/hooks/useVoiceInput.ts'),
  'utf8',
);
const turn = fs.readFileSync(
  path.join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
const resolve = fs.readFileSync(path.join(srcDir, 'resolveNavTarget.ts'), 'utf8');
const navSvc = fs.readFileSync(path.join(srcDir, 'navigationService.ts'), 'utf8');

assert(hard.includes('isPureStopNavigationIntent'), 'hardNav exports pure stop');
assert(hard.includes('stripStopNavigationForContinue'), 'hardNav strip continue');
assert(hard.includes('bumpNavCommitGeneration'), 'clear bumps commit gen');
assert(voice.includes('isPureStopNavigationIntent'), 'voice early pure stop');
assert(turn.includes('isPureStopNavigationIntent'), 'concierge pure stop gate');
assert(navSvc.includes('bumpNavCommitGeneration'), 'nav gen token');
assert(navSvc.includes('commitGeneration'), 'start checks commitGeneration');
assert(resolve.includes('getNavCommitGeneration'), 'resolve captures gen');
assert(resolve.includes('pendingResolveCommitGeneration'), 'resolve pending gen');

console.log('pureStopNav.smoke.test.ts OK');
