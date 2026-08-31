/**
 * Run: npx --yes tsx src/services/homeMap/splashReadyGate.smoke.test.ts
 */

import {
  SPLASH_MAX_MS,
  SPLASH_MIN_BRANDING_MS,
  canLiftSplash,
  noteSplashBootMinimal,
  noteSplashMapInteractive,
  noteSplashSkipMap,
  resetSplashReadyGate,
} from './splashReadyGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

resetSplashReadyGate(1_000);
assert(!canLiftSplash(1_500), 'vor Branding-Min nicht heben');
noteSplashBootMinimal();
assert(!canLiftSplash(1_100), 'Boot allein reicht nicht vor Min');
assert(
  canLiftSplash(1_000 + SPLASH_MIN_BRANDING_MS),
  'Boot + Min → Vorhang weg (UI-first, ohne Map-Wait)',
);
noteSplashMapInteractive();
assert(canLiftSplash(1_000 + SPLASH_MIN_BRANDING_MS), 'Karte optional, bleibt heben');

resetSplashReadyGate(1_000);
noteSplashBootMinimal();
assert(canLiftSplash(1_000 + SPLASH_MAX_MS), 'hartes Max');

resetSplashReadyGate(1_000);
noteSplashBootMinimal();
noteSplashSkipMap();
assert(canLiftSplash(1_000 + SPLASH_MIN_BRANDING_MS), 'Onboarding ohne Karte nach Branding');

console.log('splashReadyGate.smoke.test.ts OK');
