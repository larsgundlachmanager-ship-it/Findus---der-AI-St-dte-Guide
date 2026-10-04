/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/concierge/eventDateWindow.smoke.test.ts
 */
import {
  normalizeEventRangeText,
  parseEventDateWindow,
  isOpenWhatsOnAsk,
} from './eventDateWindow';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const now = new Date(2026, 8, 6, 12, 0, 0, 0).getTime(); // 6. Sep 2026

assert(
  /bis/i.test(normalizeEventRangeText('vom 16. BSI 20 Oktober')),
  'BSI→bis',
);

const w1 = parseEventDateWindow('was geht vom 16. bis 20 Oktober in Korbach', now);
assert(!!w1, 'window1');
assert(w1!.fromIso === '2026-10-16', `from ${w1!.fromIso}`);
assert(w1!.toIso === '2026-10-20', `to ${w1!.toIso}`);

const w2 = parseEventDateWindow(
  'was vom 16. September bis 20. Oktober in Korbach geht',
  now,
);
assert(!!w2, 'window2');
assert(w2!.fromIso === '2026-09-16', `sep from ${w2!.fromIso}`);
assert(w2!.toIso === '2026-10-20', `oct to ${w2!.toIso}`);

const w3 = parseEventDateWindow('vom 16. BSI 20 Oktober Korbach', now);
assert(!!w3, 'stt bsi window');
assert(w3!.fromIso === '2026-10-16', `bsi from ${w3!.fromIso}`);

const wMaerz = parseEventDateWindow(
  'Ich brauche einen Flieger vom 27. März bis zum 10. April. Such mir einen Flug von Hamburg nach Split raus.',
  new Date(2026, 2, 1, 12, 0, 0, 0).getTime(),
);
assert(!!wMaerz, 'maerz-april window');
assert(wMaerz!.fromIso === '2026-03-27', `maerz from ${wMaerz!.fromIso}`);
assert(wMaerz!.toIso === '2026-04-10', `april to ${wMaerz!.toIso}`);

assert(parseEventDateWindow('was geht heute Abend?', now) == null, 'heute null');

assert(
  isOpenWhatsOnAsk('was vom 16. BSI 20 Oktober in Korbach geht'),
  'open whats-on with range',
);

const { looksLikeDateWindowWhatsOnAsk } = require('./eventDateWindow') as {
  looksLikeDateWindowWhatsOnAsk: (s: string) => boolean;
};
assert(
  looksLikeDateWindowWhatsOnAsk(
    'Wir sind vom 16. bis 20. in Korbach — was für Events gibt es?',
  ),
  'stay window + events',
);
assert(
  looksLikeDateWindowWhatsOnAsk('was geht vom 16. bis 20 Oktober in Korbach'),
  'was geht window',
);
assert(
  !looksLikeDateWindowWhatsOnAsk(
    'Plane mir einen Wochenendurlaub nach Lissabon mit Flug',
  ),
  'booking trip not whats-on',
);

console.log('eventDateWindow.smoke.test.ts ok');

