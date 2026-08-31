/**
 * Taxi/Uber als neues Thema — kein Wien-Sticky, kein Nav/ÖPNV statt Taxi.
 * Run: npx --yes tsx src/services/mobility/taxiRideIntent.smoke.test.ts
 */

import {
  extractTaxiDestName,
  looksLikeNewConcreteDestination,
  wantsTaxiRide,
} from './taxiRideIntent';
import { classifyJob } from '../../module2/jobs/classifyJob';
import { rewriteQuery } from '../../module2/pipeline/queryRewriter';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const UTTER =
  'Ich möchte jetzt gerne zum Pinneberger Bahnhof. Kannst du ein Taxi dafür rufen?';
const SHORT = 'Kannst du ein Taxi dafür rufen?';

assert(wantsTaxiRide(UTTER), 'full utterance is taxi');
assert(wantsTaxiRide(SHORT), 'taxi dafür is taxi');
assert(!wantsTaxiRide('Uber Eats bestellen'), 'eats is not taxi ride');
assert(
  !wantsTaxiRide(
    'also ich fliege morgen nach Athen kannst du mir ein Taxi vorbestellen',
  ),
  'flight plus taxi is leave-by not hail',
);
assert(
  /pinneberger\s+bahnhof/i.test(extractTaxiDestName(UTTER)),
  `dest is Pinneberger Bahnhof, got: ${extractTaxiDestName(UTTER)}`,
);
assert(looksLikeNewConcreteDestination(UTTER), 'concrete dest');

const job = classifyJob(UTTER);
assert(job.jobId === 'taxi_rideshare', `job is taxi_rideshare, got ${job.jobId}`);
assert(job.jobId !== 'nav_route', 'taxi beats nav');
assert(job.jobId !== 'transit_live', 'taxi is not transit');

const rewritten = rewriteQuery(SHORT, {
  lastPlaceName: 'Wien',
  lastTopic: 'Flug nach Wien',
  lastAssistantSnippet: 'Nach Wien? Welcher Tag? Heute oder morgen reicht.',
});
assert(!/wien/i.test(rewritten.rewritten), `rewriter must not attach Wien: ${rewritten.rewritten}`);
assert(rewritten.changed === false, 'taxi query stays verbatim');

const addrRewrite = rewriteQuery('Ulmenallee 23 in Pinneberg', {
  lastPlaceName: 'Wien',
  lastTopic: 'Flug nach Wien',
  lastAssistantSnippet: 'Nach Wien? Welcher Tag?',
});
assert(
  !/wien/i.test(addrRewrite.rewritten),
  `street dest must not attach Wien: ${addrRewrite.rewritten}`,
);
assert(addrRewrite.changed === false, 'street address stays verbatim');

const cityCorrRewrite = rewriteQuery('Nein, Pinneberg', {
  lastPlaceName: 'Wien',
  lastTopic: 'Flug nach Wien',
  lastAssistantSnippet: 'Nach Wien? Welcher Tag?',
});
assert(
  !/wien/i.test(cityCorrRewrite.rewritten),
  `city corr must not attach Wien: ${cityCorrRewrite.rewritten}`,
);
assert(cityCorrRewrite.changed === false, 'city corr stays verbatim');

console.log('taxiRideIntent.smoke.test.ts OK');
