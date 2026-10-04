/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/navDestSpeechName.smoke.test.ts
 */
import {
  looksLikeNavAddressLabel,
  resolveNavDestSpeechName,
} from './navDestSpeechName';
import { resolveNavSpeechEtaMin } from './navHudEta';
import {
  buildExplicitNavBridgeSpeech,
  speechSafeNavDestName,
} from './navStartSpeech';
import {
  extractMailboxAmenityWish,
  extractNamedOnRoutePlace,
  isMailboxAmenityIntent,
  isOnRouteZwischenstoppIntent,
  isResumeOriginalDestIntent,
} from './onRouteZwischenstopp';
import {
  buildFinalCueText,
  destSideFromManeuver,
  isFinalApproachTurn,
} from './handsFreeNav/cueScheduler';
import type { NavWaypoint } from './navigationTypes';
import { resolveFollowupThread } from '../../module2/reboot/pipeline/followupThread';
import { shouldHandoffToPitchModule } from '../../module2/pitch/shouldHandoffPitch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  looksLikeNavAddressLabel('Ahrenloheweg 2, 25497 Prisdorf, Deutschland'),
  'address label detected',
);
assert(
  !looksLikeNavAddressLabel('Tennis-Club Prisdorf TCP'),
  'poi name not address',
);

const spoken = resolveNavDestSpeechName({
  query: 'Tennis Club',
  geoLabel: 'Ahrenloheweg 2, 25497 Prisdorf, Deutschland',
});
assert(!/25497|Ahrenloheweg\s+2/i.test(spoken), 'no street+PLZ in speech name');
assert(/Tennis/i.test(spoken), 'keeps query name');

const bridge = buildExplicitNavBridgeSpeech(
  'Ahrenloheweg 2, 25497 Prisdorf, Deutschland',
);
assert(/navigiere dich|Alles klar/i.test(bridge), 'bridge zusagt');
assert(!/25497/i.test(bridge), 'bridge ohne PLZ');
assert(!/Deutschland/i.test(bridge), 'bridge ohne Land');
// Reine Adress-Ziele (User sagte Straße+Nr): kurz behalten — kein PLZ-Müll.

assert(
  speechSafeNavDestName('Kindergarten Sonnenschein') ===
    resolveNavDestSpeechName({ query: 'Kindergarten Sonnenschein' }),
  'speechSafe alias',
);

assert(resolveNavSpeechEtaMin({ storeEtaMin: 15 }) === 15, 'store ETA 15');
assert(resolveNavSpeechEtaMin({ storeEtaMin: 13 }) === 13, 'store ETA 13');

assert(
  isOnRouteZwischenstoppIntent(
    'Können wir vorher bitte noch an einem Briefkasten vorbeifahren?',
    true,
  ),
  'briefkasten vorher zwischenstopp',
);
assert(
  extractNamedOnRoutePlace(
    'Können wir vorher bitte noch an einem Briefkasten vorbeifahren?',
  ) == null,
  'briefkasten → top2 nicht unique venue',
);
assert(
  isMailboxAmenityIntent(
    'Können wir vorher bitte noch an einem Briefkasten vorbeifahren?',
  ),
  'mailbox intent',
);
assert(
  extractMailboxAmenityWish(
    'Können wir vorher bitte noch an einem Briefkasten vorbeifahren?',
  ) === 'briefkasten',
  'mailbox wish',
);

assert(
  isOnRouteZwischenstoppIntent(
    'Können wir vorher nochmal zum Kindergarten gehen?',
    true,
  ),
  'vorher zwischenstopp',
);
assert(
  !isOnRouteZwischenstoppIntent('Wo ist ein Café?', false),
  'no nav → no zwischenstopp',
);
assert(
  extractNamedOnRoutePlace(
    'Können wir vorher nochmal zum Kindergarten in Prisdorf gehen?',
  ) === 'Kindergarten',
  'named kindergarten',
);
assert(
  extractNamedOnRoutePlace('Können wir vorher noch Eis essen?') == null,
  'vague eis → top2',
);
assert(
  isResumeOriginalDestIntent('danach zum Tennis Club'),
  'resume original dest',
);

const wps: NavWaypoint[] = [
  {
    lat: 1,
    lng: 1,
    maneuver: 'turn-left',
    roadName: 'Hauptstraße',
  },
  {
    lat: 1.01,
    lng: 1,
    maneuver: 'arrive',
    roadName: null,
  },
];
assert(isFinalApproachTurn({ waypoints: wps, turnIndex: 0 }), 'final approach');
assert(destSideFromManeuver('turn-right') === 'right', 'dest side');
assert(
  /Ziel rechts/i.test(
    buildFinalCueText({
      maneuver: 'turn-right',
      landmark: null,
      roadName: 'Zielstraße',
      distanceM: 30,
      isFinalApproach: true,
      destSide: 'right',
    }),
  ),
  'ziel rechts cue',
);

const waterFollow = resolveFollowupThread('Kann ich da SUP fahren?', [
  { role: 'user', text: 'Wie groß ist die Alster?' },
  { role: 'assistant', text: 'Die Alster hat mehrere Quadratkilometer.' },
]);
assert(waterFollow.inherit === 'water_activity', 'water sticky inherit');
assert(waterFollow.thread === 'continue', 'water sticky continue');

assert(
  shouldHandoffToPitchModule('Ich möchte auf der Alster SUP fahren — geht das?') ===
    false,
  'SUP water not pitch',
);

console.log('navDestSpeechName.smoke.test.ts OK');
