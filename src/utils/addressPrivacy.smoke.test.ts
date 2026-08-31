/**
 * Run: npx --yes tsx src/utils/addressPrivacy.smoke.test.ts
 */
import {
  noteUserTextForAddressPrivacy,
  userAskedForAddressOrCoords,
  lastUserAskedForAddressOrCoords,
} from './addressPrivacy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  !userAskedForAddressOrCoords('Was geht heute Abend für ein Weinfest?'),
  'no address ask on event query',
);
assert(
  userAskedForAddressOrCoords('Wie ist die Adresse?'),
  'explicit adresse',
);
assert(
  userAskedForAddressOrCoords('Welche Straße ist das?'),
  'welche straße',
);
assert(
  !userAskedForAddressOrCoords('Die Straße war voll.'),
  'bare straße not enough',
);

noteUserTextForAddressPrivacy('Erzähl mir vom Weinfest');
assert(!lastUserAskedForAddressOrCoords(), 'last not asked');
noteUserTextForAddressPrivacy('Schick mir die Adresse');
assert(lastUserAskedForAddressOrCoords(), 'last asked');

console.log('addressPrivacy.smoke.test.ts OK');
