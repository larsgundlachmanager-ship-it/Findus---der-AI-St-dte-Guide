/**
 * Live-HUD: keine Dauer-„Tippen“-Meta, Coach-Strip.
 */
import { stripHudCoachMeta } from './hudCoachMeta';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  stripHudCoachMeta('Geparkt seit 1 Std · 😊 Tippen') === 'Geparkt seit 1 Std',
  'strip tippen suffix',
);
assert(
  stripHudCoachMeta('😊 Tippen für Leave-by') === undefined,
  'strip tippen-only',
);
assert(
  stripHudCoachMeta('Goldschätzchen · 4 Min\n😊 Tippen = Pitch') ===
    'Goldschätzchen · 4 Min',
  'strip tippen line',
);
assert(
  stripHudCoachMeta('heute bis 22°') === 'heute bis 22°',
  'keep factual meta',
);

console.log('hudCoachMeta.smoke: ok');
