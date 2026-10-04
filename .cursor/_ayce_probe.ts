import { extractNamedRestaurantWish } from '../src/module2/pitch/namedVenueIntent';
import { looksLikeAyceQuery, normalizeAyceStt } from '../src/module2/pitch/ayceIntent';
import { pitchHeadlineFromContext } from '../src/module2/pitch/pitchHeadline';
import { deriveSpickzettelTitle } from '../src/services/concierge/spickzettelTitle';
import { scoreAyceEvidence } from '../src/module2/pitch/hardMatchVerify';
import { parseWishesFromText } from '../src/module2/pitch/parentBrief';

const qs = [
  'All you can eat, kein Asiatisch',
  'all you can eat kein asiatisch',
  'Ken Eat kein Asiatisch',
  'Oyukin-Eat kein Asiatisch',
  'All you can eat',
  'Ich möchte all you can eat essen gehen',
  'Fahr mich zum Goldschätzchen',
];

for (const q of qs) {
  console.log('---', JSON.stringify(q));
  console.log('ayce', looksLikeAyceQuery(q), 'norm', normalizeAyceStt(q));
  console.log('namedWish', extractNamedRestaurantWish(q));
  console.log(
    'headline',
    pitchHeadlineFromContext({ userText: q, city: 'Prisdorf' }),
  );
  const wishes = parseWishesFromText(q);
  console.log(
    'wishes',
    wishes.map((w) => `${w.kind}:${w.text}:${w.hardness}`).join(' | '),
  );
  console.log(
    'spick_cityGold',
    deriveSpickzettelTitle({
      userText: q,
      cityHint: 'Goldschätzchen',
      bullets: ['Abendkarte'],
    }),
  );
  console.log(
    'spick_speech',
    deriveSpickzettelTitle({
      userText: q,
      cityHint: 'Prisdorf',
      speech: 'Abendkarte & Kulinarik im Restaurant Goldschätzchen',
      bullets: ['📍 Goldschätzchen'],
    }),
  );
  console.log(
    'spick_inGold',
    deriveSpickzettelTitle({
      userText: q,
      speech: 'Essen in Goldschätzchen passt gut.',
      bullets: [],
    }),
  );
  console.log(
    'spick_explicit_headline',
    deriveSpickzettelTitle({
      userText: q,
      explicit: pitchHeadlineFromContext({
        userText: q,
        city: 'Goldschätzchen',
      }),
      cityHint: 'Prisdorf',
    }),
  );
}

console.log(
  'gold ayce score',
  scoreAyceEvidence(
    'Goldschätzchen Wein- & Biergarten Abendkarte Kulinarik restaurant biergarten',
  ),
);
console.log(
  'gold buffet',
  scoreAyceEvidence('Goldschätzchen Frühstücksbuffet'),
);
console.log(
  'headline city gold',
  pitchHeadlineFromContext({
    userText: 'All you can eat',
    city: 'Goldschätzchen',
  }),
);
