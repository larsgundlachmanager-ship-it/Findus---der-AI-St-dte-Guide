/**
 * Briefkasten Zwischenstopp + Insert-not-Replace wiring.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/onRouteMailbox.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractMailboxAmenityWish,
  extractNamedOnRoutePlace,
  isMailboxAmenityIntent,
  isOnRouteZwischenstoppIntent,
} from './onRouteZwischenstopp';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const q =
  'Können wir vorher bitte noch an einem Briefkasten vorbeifahren?';

assert(isMailboxAmenityIntent(q), 'mailbox intent');
assert(extractMailboxAmenityWish(q) === 'briefkasten', 'wish briefkasten');
assert(isOnRouteZwischenstoppIntent(q, true), 'on_route unter Nav');
assert(!isOnRouteZwischenstoppIntent(q, false), 'ohne Nav kein zwischenstopp');
assert(extractNamedOnRoutePlace(q) == null, 'kein Unique-Venue');

const qHold =
  'Können wir vor nochmal an einem Briefkasten halten?';
assert(isMailboxAmenityIntent(qHold), 'halten mailbox intent');
assert(isOnRouteZwischenstoppIntent(qHold, true), 'halten on_route unter Nav');
assert(extractNamedOnRoutePlace(qHold) == null, 'halten → Top-2');

const parent = readFileSync(
  join(process.cwd(), 'src/module2/pitch/parentBrief.ts'),
  'utf8',
);
assert(
  parent.includes('extractMailboxAmenityWish') &&
    /briefkasten|postkasten|mailbox|packstation/.test(parent) &&
    parent.includes('vorbeifahren'),
  'parentBrief mailbox + on_route',
);

const handoff = readFileSync(
  join(process.cwd(), 'src/module2/pitch/shouldHandoffPitch.ts'),
  'utf8',
);
assert(/briefkasten|mailbox|packstation|vorbeifahren/.test(handoff), 'handoff regex');

const pool = readFileSync(
  join(process.cwd(), 'src/module2/pitch/candidatePool.ts'),
  'utf8',
);
assert(
  /briefkasten\|postkasten\|post_box\|mailbox/.test(pool) &&
    pool.includes("placeType: 'post_box'"),
  'candidatePool OSM post_box',
);

const wishRank = readFileSync(
  join(process.cwd(), 'src/module2/pitch/wishFilterRank.ts'),
  'utf8',
);
assert(
  /briefkasten\|postkasten\|post_box\|mailbox/.test(wishRank),
  'wishFilterRank mailbox score',
);

const pitchNav = readFileSync(
  join(process.cwd(), 'src/module2/pitch/pitchStartNav.ts'),
  'utf8',
);
assert(
  pitchNav.includes('addOptimizedTourStop') && pitchNav.includes('insertStop'),
  'pitch insert wiring',
);

const discovery = readFileSync(
  join(process.cwd(), 'src/services/navigation/contextualDiscovery.ts'),
  'utf8',
);
assert(discovery.includes('insertStop?: boolean'), 'insertStop opt');
assert(discovery.includes('addOptimizedTourStop'), 'discovery optimized insert');
assert(
  !/longWalk[\s\S]{0,200}setMultiStopTour\(null\)/.test(discovery),
  'kein longWalk-Replace mehr',
);

const gold = readFileSync(
  join(process.cwd(), 'src/module2/blueprints/ownerGold.pack.json'),
  'utf8',
);
assert(
  gold.includes('navigation::on_route_mailbox_top2_v1'),
  'owner gold mailbox situation',
);

console.log('onRouteMailbox.smoke.test.ts OK');
