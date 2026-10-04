/**
 * Run: npx --yes tsx src/services/homeMap/splashReadyGate.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPLASH_HARD_FAILSAFE_MS,
  SPLASH_MAX_MS,
  SPLASH_MIN_BRANDING_MS,
  canLiftSplash,
  firstLookReady,
  noteSplashBootMinimal,
  noteSplashGpsLive,
  noteSplashMapCoreReady,
  noteSplashMapFogReady,
  noteSplashMapPlacesReady,
  noteSplashSkipMap,
  peekSplashSignals,
  resetSplashReadyGate,
} from './splashReadyGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(SPLASH_MAX_MS === 5_000, 'Splash Soft-Ziel 5 s');
assert(SPLASH_HARD_FAILSAFE_MS === 5_000, 'Splash Failsafe = Soft-Cap 5 s');

const splashUi = readFileSync(
  join(process.cwd(), 'src/components/SplashScreenController.tsx'),
  'utf8',
);
assert(
  splashUi.includes('remain <= 280') ||
    splashUi.includes('SPLASH_HARD_FAILSAFE_MS - elapsed'),
  'Curtain darf 5s-Cap nicht überschreiten',
);
assert(splashUi.includes('setBlockTouches(false)'), 'Touches vor Finish frei');

resetSplashReadyGate(1_000);
assert(!canLiftSplash(1_500), 'vor Boot nicht heben');
noteSplashBootMinimal();
assert(!canLiftSplash(1_500), 'Boot allein ohne Kern/Max noch nicht');

noteSplashMapCoreReady();
assert(!canLiftSplash(1_500), 'nur Kern → noch nicht (Fog+GPS fehlen)');
noteSplashMapFogReady();
assert(!canLiftSplash(1_500), 'Kern+Fog ohne GPS → noch nicht');
noteSplashGpsLive();
assert(firstLookReady(), 'First-Look = Kern+Fog+GPS');
assert(
  canLiftSplash(1_500),
  'First-Look ohne Places → sofort heben (Places optional)',
);

resetSplashReadyGate(1_000);
noteSplashBootMinimal();
noteSplashMapCoreReady();
noteSplashMapFogReady();
noteSplashGpsLive();
noteSplashMapPlacesReady();
assert(canLiftSplash(2_500), 'First-Look + Places → sofort heben');
assert(peekSplashSignals().mapPlacesReady, 'Places-Signal gesetzt');

resetSplashReadyGate(1_000);
noteSplashBootMinimal();
assert(!canLiftSplash(4_000), 'ohne First-Look vor Soft-Ziel noch nicht');
assert(
  canLiftSplash(1_000 + SPLASH_MAX_MS),
  'Max (5 s) ohne Kern → heben (kein längerer Vorhang)',
);
assert(
  canLiftSplash(1_000 + SPLASH_HARD_FAILSAFE_MS),
  'Hard-Failsafe ohne First-Look → notfalls heben',
);

resetSplashReadyGate(1_000);
noteSplashBootMinimal();
noteSplashMapFogReady();
noteSplashMapPlacesReady();
noteSplashGpsLive();
assert(!canLiftSplash(4_000), 'Fog+Places+GPS ohne Kern reichen nicht');
noteSplashMapCoreReady();
assert(canLiftSplash(4_000), 'First-Look → heben');

resetSplashReadyGate(1_000);
noteSplashBootMinimal();
noteSplashSkipMap();
assert(canLiftSplash(1_000 + SPLASH_MIN_BRANDING_MS), 'Onboarding ohne Karte nach Branding');

resetSplashReadyGate(1_000);
assert(
  canLiftSplash(1_000 + SPLASH_HARD_FAILSAFE_MS),
  'Hard-Failsafe ohne bootMinimal → heben (Boot darf Vorhang nicht >5 s halten)',
);

console.log('splashReadyGate.smoke.test.ts OK');
