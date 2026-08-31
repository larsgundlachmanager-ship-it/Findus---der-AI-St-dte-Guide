/**
 * Bridge darf nicht aus Parser-Slots geklebt sein.
 * Run: npx --yes tsx src/module2/chat/bridgeGlue.smoke.test.ts
 */
import { looksLikeSlotGluedBridge, sanitizeBridgeText } from './bridgeGlue';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeSlotGluedBridge('nach Antalya muss klingt richtig gut') === true,
  'dest+muss+klingt',
);
assert(
  looksLikeSlotGluedBridge(
    'Antalya wann muss klingt richtig gut — ich mach dir den Flieger klar.',
  ) === true,
  'klingt richtig gut',
);
assert(
  looksLikeSlotGluedBridge(
    'Genau das setz ich jetzt um — die konkreten Zahlen kommen direkt hinterher.',
  ) === false,
  'emergency complete sentence',
);
assert(
  looksLikeSlotGluedBridge(
    'Bei dem Wetter ist Spaghetti-Eis genau die richtige Wahl.',
  ) === false,
  'conceived ice intro',
);

assert(
  sanitizeBridgeText('Ich schau mal kurz') === null,
  'wait floskel killed',
);
assert(
  sanitizeBridgeText('Bei dem Wetter ist Spaghetti-Eis genau die richtige Wahl.')
    != null,
  'content sentence kept',
);
assert(
  sanitizeBridgeText('nach Antalya muss klingt richtig gut') === null,
  'glued bridge killed',
);

console.log('bridgeGlue.smoke.test.ts OK');
