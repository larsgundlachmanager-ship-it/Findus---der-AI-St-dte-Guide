/**
 * Smoke: Fake-Wake-Claims vs Native-Confirm erkennen.
 */
import {
  looksLikeFakeWakeClaim,
  looksLikeNativeWakeSpeech,
} from './ensureWakeNativePresent';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  looksLikeNativeWakeSpeech(
    'Alles klar, ich habe den Wecker auf 8 Uhr morgens gestellt. Gute Nacht.',
  ),
  'native confirm',
);
assert(
  looksLikeNativeWakeSpeech(
    'Alles klar, ich habe den Wecker auf 7:57 umgestellt.',
  ),
  'native replace',
);
assert(
  looksLikeNativeWakeSpeech(
    'Du hast schon einen Wecker auf 8 Uhr morgens gestellt. Willst du die Zeit aktualisieren oder einen zweiten Wecker auf 8:30 Uhr stellen?',
  ),
  'choice',
);
assert(
  looksLikeNativeWakeSpeech('Yo, hab den Wecker um 7:57 gestellt.'),
  'legacy yo',
);
assert(
  !looksLikeNativeWakeSpeech('Wecker gestellt auf 7:57 Uhr'),
  'llm fake not native',
);
assert(
  looksLikeFakeWakeClaim('Wecker gestellt auf 7:57 Uhr'),
  'llm fake detect',
);
assert(
  !looksLikeFakeWakeClaim(
    'Alles klar, ich habe den Wecker auf 8 Uhr morgens gestellt.',
  ),
  'confirm not fake',
);

console.log('ensureWakeNativePresent.smoke ok');
