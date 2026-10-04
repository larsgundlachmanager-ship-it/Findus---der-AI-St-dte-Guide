/**
 * Distinct bullets + sticky venue task — Live-Test Feedback.
 */
import assert from 'node:assert/strict';
import { diversifyPitchBullets } from './diversifyPitchBullets';
import { isStickyVenueTaskIntent } from './shouldHandoffPitch';

const cards = [
  {
    bullets: ['Steak', '3,8 km'],
    candidate: {
      softTags: ['Biergarten', 'Lava-Stein'],
      hookNotes: ['Filetpfännchen mit Charme'],
      dishPriceHint: null as string | null,
      distFromAnchorM: 3800,
      rating: 4.7,
    },
  },
  {
    bullets: ['Steak', '6,3 km'],
    candidate: {
      softTags: ['rustikal', 'Angus'],
      hookNotes: ['Argentinisches Angus auf Lava'],
      dishPriceHint: 'Steak ~28 €',
      distFromAnchorM: 6300,
      rating: 4.5,
    },
  },
];

diversifyPitchBullets(cards);
assert.notEqual(
  cards[0]!.bullets[0]!.toLowerCase(),
  cards[1]!.bullets[0]!.toLowerCase(),
  'bullets must differ after diversify',
);

assert.equal(
  isStickyVenueTaskIntent('Ich möchte gerne einen Tisch reservieren'),
  true,
);
assert.equal(
  isStickyVenueTaskIntent('Ich möchte doch lieber zu Fuß laufen'),
  true,
);
assert.equal(
  isStickyVenueTaskIntent('Ich möchte jetzt zum Rindox laufen'),
  true,
);
assert.equal(
  isStickyVenueTaskIntent('Wo kann ich heute Abend ein Steak essen?'),
  false,
);
assert.equal(
  isStickyVenueTaskIntent('Kannst du mir heute Abend um 19 Uhr ein Tisch im Rindox reservieren?'),
  true,
);
assert.equal(
  isStickyVenueTaskIntent('Zeig mir die Speisekarte vom ersten Restaurant'),
  true,
  'speisekarte first = sticky',
);

console.log('pitchStickyDistinct.smoke: ok');
