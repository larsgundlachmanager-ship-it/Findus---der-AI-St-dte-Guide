/**
 * Stadt-Korrektur einer Straßen-Nav — nicht Lübeck behalten, nicht Wien-Thread.
 * Run: npx --yes tsx src/services/navigation/navDestCityCorrection.test.ts
 */

import {
  extractCorrectedCityName,
  looksLikeSpokenCityCorrection,
  placeCoreFromDestLabel,
  resolveNavDestCorrection,
  streetCoreFromDestLabel,
} from './navDestCityCorrection';
import { rememberStreetNavQuery } from './streetAddressQuery';
import { mergeCorrectionUtterance } from '../../module2/router/correctionMerge';
import { rewriteQuery } from '../../module2/pipeline/queryRewriter';
import { decideTopicCut, looksLikeExplicitNavOrAddress, shouldScrubDeadThread } from '../../module2/kernel/turnKernel';
import { fuzzyResolveCityName } from './fuzzyCityResolve';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(fuzzyResolveCityName('Pilleberg') === 'Pinneberg', 'Pilleberg→Pinneberg');
assert(extractCorrectedCityName('Nein, in Düsseldorf') === 'Düsseldorf', 'nein in Düsseldorf');
assert(extractCorrectedCityName('nein es ist Pilleberg') === 'Pinneberg', 'es ist Pilleberg');
assert(looksLikeSpokenCityCorrection('Nein, Pinneberg'), 'city corr cue');
assert(looksLikeSpokenCityCorrection('Ulmenallee 23 in Pilleberg'), 'addr+city');
assert(!looksLikeSpokenCityCorrection('Nein, das ist falsch'), 'falsch is not a city');

assert(
  streetCoreFromDestLabel('23, Ulmenallee, St. Gertrud, Lübeck') ===
    'Ulmenallee 23',
  'nominatim label',
);
assert(streetCoreFromDestLabel('Ulmenallee 23, Lübeck') === 'Ulmenallee 23', 'dest label');

const full = resolveNavDestCorrection({
  userText: 'Nein, das ist Ulmenallee 23 in Pilleberg',
});
assert(full != null && /pinneberg/i.test(full), `full corr dest, got ${full}`);
assert(!/lübeck|luebeck/i.test(full || ''), 'not Lübeck');

rememberStreetNavQuery('Ulmenallee 23');
const cityOnly = resolveNavDestCorrection({
  userText: 'Nein, Pinneberg',
  lastStreetQuery: 'Ulmenallee 23',
  currentDestName: '23, Ulmenallee, Lübeck',
});
assert(
  cityOnly != null && /ulmenallee\s+23/i.test(cityOnly) && /pinneberg/i.test(cityOnly),
  `city-only dest, got ${cityOnly}`,
);

const merged = mergeCorrectionUtterance({
  previousUserText: 'Ulmenallee 23',
  newUserText: 'Nein, es ist Pilleberg',
});
assert(merged.isCorrection, 'merge is correction');
assert(/pinneberg/i.test(merged.mergedUserText), `merged dest ${merged.mergedUserText}`);
assert(!/wien/i.test(merged.mergedUserText), 'merge no wien');

const rewritten = rewriteQuery('Nein, Pinneberg', {
  lastPlaceName: 'Wien',
  lastTopic: 'Flug nach Wien',
  lastAssistantSnippet: 'Nach Wien? Welcher Tag?',
});
assert(!/wien/i.test(rewritten.rewritten), `no wien glue: ${rewritten.rewritten}`);
assert(rewritten.changed === false, 'city corr stays verbatim');

const mode = decideTopicCut({
  userText: 'Nein, Pinneberg',
  foregroundLabel: 'Flug Wien',
  lastClosedTopic: 'Flug Wien',
  openLoop: 'Flug Wien',
});
assert(mode === 'new' || mode === 'closed_new', `topic cut ${mode}`);
assert(shouldScrubDeadThread(mode), 'scrub wien on city corr');
assert(looksLikeExplicitNavOrAddress('Nein, Pinneberg'), 'city corr is nav');

rememberStreetNavQuery('Steinstraße 1');
const duesseldorfCorr = resolveNavDestCorrection({
  userText: 'Nein, in Düsseldorf',
  lastStreetQuery: 'Steinstraße 1',
  currentDestName: 'Steinstraße 1, Hamburg',
});
assert(
  duesseldorfCorr != null &&
    /steinstraße\s+1/i.test(duesseldorfCorr) &&
    /d[üu]sseldorf/i.test(duesseldorfCorr),
  `Düsseldorf-Korrektur, got ${duesseldorfCorr}`,
);

assert(looksLikeSpokenCityCorrection('nee, meinst in Hamburg'), 'nee+meinst cue');
assert(extractCorrectedCityName('nee, meinst in Hamburg') === 'Hamburg', 'Hamburg aus nee');
assert(
  placeCoreFromDestLabel('Alsterhaus, Lübeck') === 'Alsterhaus',
  'Alsterhaus Kern',
);
const alster = resolveNavDestCorrection({
  userText: 'nee, meinst in Hamburg',
  currentDestName: 'Alsterhaus, Lübeck',
});
assert(
  alster != null && /alsterhaus/i.test(alster) && /hamburg/i.test(alster),
  `Alsterhaus Hamburg, got ${alster}`,
);
assert(!/lübeck|luebeck/i.test(alster || ''), 'nicht Lübeck behalten');

console.log('navDestCityCorrection.test.ts OK');
