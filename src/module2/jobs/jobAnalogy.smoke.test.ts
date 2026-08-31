/**
 * Analogical transfer: unknown access inherits transit; hike stays sport.
 * Run: npx --yes tsx src/module2/jobs/jobAnalogy.smoke.test.ts
 */

import { classifyJob } from './classifyJob';
import {
  analogJobHints,
  looksLikeHikeOnly,
  looksLikeMediaCatalogRequest,
  looksLikeTicketedPlaceAccess,
} from './jobAnalogy';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeTicketedPlaceAccess('Ich möchte irgendwo auf den Berg rauffahren'),
  'berg rauffahren = ticketed access',
);
assert(
  looksLikeTicketedPlaceAccess('Quiero subir a la montaña en Sierra Nevada'),
  'subir montaña = ticketed access (abroad)',
);
assert(
  !looksLikeHikeOnly('Ich möchte irgendwo auf den Berg rauffahren'),
  'rauffahren is not hike-only',
);
assert(
  looksLikeHikeOnly('Ich will auf den Berg wandern'),
  'wandern = hike',
);
assert(
  !looksLikeTicketedPlaceAccess('Ich will auf den Berg wandern'),
  'wandern is not ticketed access',
);
assert(
  !looksLikeTicketedPlaceAccess('Wo kann ich in Hamburg gut essen?'),
  'dining is not ticketed access',
);

const mountain = classifyJob('Ich möchte irgendwo auf den Berg rauffahren');
assert(
  mountain.jobId === 'transit_live',
  `mountain access job ${mountain.jobId} ≠ transit_live`,
);

const spain = classifyJob('Quiero subir a la montaña en Sierra Nevada');
assert(
  spain.jobId === 'transit_live',
  `spain mountain job ${spain.jobId} ≠ transit_live`,
);

const hike = classifyJob('Ich will auf den Berg wandern');
assert(
  hike.jobId === 'activity_sport',
  `hike job ${hike.jobId} ≠ activity_sport`,
);

const train = classifyJob('S-Bahn nach Hamburg, wann fährt der nächste?');
assert(train.jobId === 'transit_live', 'existing transit still transit_live');

assert(
  looksLikeMediaCatalogRequest('Ich möchte eine Spotify Playlist für den Abend'),
  'spotify playlist catalog',
);
assert(
  looksLikeTicketedPlaceAccess('Je veux monter à la montagne'),
  'monter montagne = ticketed access (FR)',
);
const playlist = classifyJob('Ich möchte eine Spotify Playlist für den Abend');
assert(
  playlist.jobId === 'shopping_errand',
  `playlist job ${playlist.jobId} ≠ shopping_errand`,
);

const VOLUME_RE =
  /\b(?:lauter|leiser|zu\s+laut|zu\s+leise|lautstärke|lautstaerke|volume|mach(?:e)?\s+(?:es\s+)?(?:lauter|leiser)|sprich\s+(?:lauter|leiser))\b/iu;
assert(VOLUME_RE.test('Mach mein Handy lauter'), 'handy lauter = volume');
assert(VOLUME_RE.test('Sprich lauter'), 'sprich lauter = volume');
assert(!VOLUME_RE.test('Wo kann ich essen?'), 'dining ≠ volume');

const hints = analogJobHints('Ich möchte irgendwo auf den Berg rauffahren');
assert(
  hints.some((h) => h.jobId === 'transit_live' && h.shape === 'ticketed_place_access'),
  'analog hint maps to transit_live',
);

console.log('jobAnalogy.smoke.test.ts OK');
