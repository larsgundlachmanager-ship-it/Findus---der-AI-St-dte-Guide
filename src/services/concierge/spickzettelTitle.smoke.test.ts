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

assert(
  deriveSpickzettelTitle({
    userText: 'Wie alt ist der Papst?',
    speech: 'Papst Leo XIV. ist 70 Jahre alt.',
    bullets: ['Namen', '70 Jahre', 'Chicago'],
  }) === 'Alter vom Papst Leo XIV',
  'papst age title with Leo from speech',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie alt ist der Past Leo der 14?',
    speech: '70 Jahre alt.',
    bullets: ['70 Jahre alt'],
  }) === 'Alter vom Papst Leo XIV',
  'past STT age title',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie alt ist Manuel Neuer?',
    speech: 'Manuel Neuer ist 39 Jahre alt.',
    bullets: ['39 Jahre'],
  }) === 'Alter von Manuel Neuer',
  'age trivia person title',
);

assert(
  /königin.*england|england.*königin/i.test(
    deriveSpickzettelTitle({
      userText: 'Wer ist die aktuelle Königin von England?',
      speech: 'England hat seit 1707 keine eigene Königin mehr.',
      bullets: ['Charles III.', 'seit 1707'],
    }),
  ),
  'who-is title from question topic',
);

assert(
  !/^wetter/i.test(
    deriveSpickzettelTitle({
      userText: 'Wer ist die aktuelle Königin von England?',
      speech: 'Charles III. ist König — Camilla Queen Consort.',
      bullets: ['Charles III.', 'Camilla'],
      cityHint: 'Prisdorf',
      explicit: 'Wetter in Prisdorf',
    }),
  ),
  'trivia never sticky weather title',
);

assert(
  /papst/i.test(
    deriveSpickzettelTitle({
      userText: 'Wie heißt der Papst?',
      speech: 'Der aktuelle Papst heißt Leo XIV.',
      bullets: ['Leo XIV.', 'Robert Prevost'],
      cityHint: 'Prisdorf',
    }),
  ),
  'wie heißt papst title',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie groß ist ein Tennisplatz?',
    speech: 'Im Doppel 23,77 × 10,97 Meter.',
    bullets: ['Doppelfeld: 23,77×10,97 m', 'Einzelfeld: 23,77×8,23 m'],
  }) === 'Größe eines Tennisplatzes',
  'size ask title not first bullet',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie groß ist ein Tennisplatz?',
    speech: 'Im Doppel 24 × 11 Meter.',
    bullets: ['Doppelfeld: 24×11 m'],
  }) !== 'Doppelfeld: 24×11 m',
  'dimension bullet never becomes title',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wird es heute noch regnen?',
    speech: 'Heute bleibt es trocken, kein Regen mehr.',
    bullets: ['Heute kein Regen', '18°'],
    cityHint: 'Prisdorf',
  }) === 'Regen',
  'rain ask title Regen not weather essay',
);


assert(
  deriveSpickzettelTitle({
    userText: 'wie alt heute das wetter wird',
    speech: 'Gerade 14 Grad, bewölkt — bleibt trocken.',
    bullets: ['14°', 'Heute kein Regen'],
    cityHint: 'Prisdorf',
  }) === 'Wetter in Prisdorf',
  'STT wie-alt+wetter never title Alter',
);

assert(
  deriveSpickzettelTitle({
    userText: 'Wie wird heute das Wetter?',
    speech: 'Mal schauen, wie es heute so aussieht: 14 Grad.',
    bullets: ['Bewölkt · 14°', 'Heute kein Regen'],
    explicit: 'Alter',
    cityHint: 'Prisdorf',
  }) === 'Wetter in Prisdorf',
  'explicit Alter never sticks on weather',
);

console.log('spickzettelTitle.smoke.test.ts OK');
