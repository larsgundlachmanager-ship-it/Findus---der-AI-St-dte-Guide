/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/spickzettelTitle.smoke.test.ts
 */
import { deriveSpickzettelTitle } from './spickzettelTitle';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  deriveSpickzettelTitle({
    userText: 'Wie wird das Wetter morgen in Hamburg?',
    speech: 'Morgen wechselhaft, Temperaturen um die 20 Grad.',
    bullets: ['Wechselhaft', '20°', 'Regenschirm'],
  }) === 'Wetter in Hamburg',
  'weather city title',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Was essen wir?',
    speech: 'Zwei Optionen in der Nähe.',
  }) === 'Essen',
  'dining title',
);

assert(
  !/^yorro/i.test(
    deriveSpickzettelTitle({
      explicit: 'Yorro',
      speech: 'Regen in Berlin',
      userText: 'Wetter?',
    }),
  ),
  'never yorro title',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie ist das Wetter gerade hier?',
    speech:
      'Also, in Sechzehn sieht es so aus: Gerade liegst du bei 16 Grad, bewölkt.',
    bullets: ['16–20°'],
    cityHint: 'Prisdorf',
  }) === 'Wetter in Prisdorf',
  'GPS cityHint beats speech „in Sechzehn Grad“',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie ist das Wetter gerade hier?',
    speech: 'Gerade liegst du bei sechzehn Grad, bewölkt — Richtung zwanzig.',
    bullets: ['16–20°'],
  }) === 'Wetter',
  'number-words never become weather city',
);

console.log('spickzettelTitle.smoke.test.ts OK');
