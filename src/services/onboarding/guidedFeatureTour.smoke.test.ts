/**
 * First-download App-Erklärung: lokale Begrüßung, keine Prefs/Wetter, App-Flow.
 */
import {
  buildGuidedFeatureTourSegments,
  createExplanationSpeechCursor,
  explanationPassportPlacesCueReached,
  explanationSegmentHoldMs,
  explanationSegmentIndexForSpoken,
  POST_EXPLANATION_SETTLE_MS,
  regionalGreeting,
} from './guidedFeatureTour';
import type { UserProfile } from '../../types/userProfile';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(regionalGreeting('London') === 'Hello', 'London → Hello');
assert(regionalGreeting('Paris') === 'Bonjour', 'Paris → Bonjour');
assert(regionalGreeting('Hamburg') === 'Moin', 'Hamburg → Moin');
assert(POST_EXPLANATION_SETTLE_MS === 2_000, '2s settle');

const profile = {
  firstName: 'Maria',
  cityName: 'London',
  cityId: 'london',
  characters: [],
  experiencePrefs: { museums: 'yes', nightlife: 'yes' },
  wantToExperience: 'Streetfood und Theater',
  avoidExperience: 'Massen',
  budgetCategory: 'mid',
} as unknown as UserProfile;

const segs = buildGuidedFeatureTourSegments({ profile });
const blob = segs.map((s) => s.text).join(' ');

assert(segs[0]?.text.includes('Hello Maria'), `greet: ${segs[0]?.text}`);
assert(blob.includes('London'), 'city name in tour');
assert(/Themse|Geschichte|Großstadt/.test(blob), 'city intro');
assert(blob.includes('Bevor wir richtig reinstarten'), 'app bridge');
assert(/grün/i.test(blob) && /lila/i.test(blob) && /blau/i.test(blob), 'map colors');
assert(blob.includes('Timeline'), 'timeline');
assert(/Einstellung/i.test(blob), 'settings');
assert(/Live-Anzeige/.test(blob), 'HUD');
assert(/Mikro/.test(blob), 'mic');
assert(/Eis/.test(blob) && /Hotel/.test(blob) && /Bahn/.test(blob), '3 mic examples');
assert(/Spaß in London/.test(blob), 'city closer');
assert(blob.length < 1600, `tour too long: ${blob.length}`);

assert(!/Wetter|Grad|Outfit|Kleidung/.test(blob), 'no weather in explanation');
assert(!/Streetfood|Theater|Massen/.test(blob), 'no pref recap');
assert(!/\b[Jj]o\b/.test(blob), 'no jo');
assert(!/Yorro geladen/.test(blob), 'no load recap');

const hints = segs.map((s) => s.hint);
assert(hints.includes('passport'), 'map/orte hint');
assert(hints.includes('actions'), 'place popup hint');
assert(hints.includes('timeline'), 'timeline hint');
assert(hints.includes('settings_panel'), 'settings panel hint');
assert(hints.includes('live_hud'), 'hud hint');
assert(hints.includes('mic'), 'mic hint');

const passIdx = segs.findIndex((s) => s.hint === 'passport');
assert(passIdx > 0, 'passport after intro');
const introOnly = segs.slice(0, passIdx).map((s) => s.text).join(' ');
assert(
  explanationSegmentIndexForSpoken(introOnly, segs) < passIdx,
  'map visual waits until passport speech starts',
);
const upToPassport = segs.slice(0, passIdx + 1).map((s) => s.text).join(' ');
assert(
  explanationSegmentIndexForSpoken(upToPassport, segs) === passIdx,
  'stays on passport until next segment starts',
);
assert(
  !explanationPassportPlacesCueReached(introOnly, segs),
  'orte sheet closed during intro',
);
{
  const mapOpen =
    introOnly + ' ' + (segs[passIdx]!.text.split('.')[0] ?? '');
  assert(
    !explanationPassportPlacesCueReached(mapOpen, segs),
    'karte/mikro first, orte sheet later',
  );
}
assert(
  explanationPassportPlacesCueReached(upToPassport, segs),
  'orte sheet opens when passport speech reaches unten/kategorien',
);
const hold = explanationSegmentHoldMs(segs[passIdx]!.text);
const oldCap = Math.min(18_000, Math.max(700, Math.round(segs[passIdx]!.text.length * 52)));
assert(hold > oldCap, `speech hold ${hold} must outlast old visual cap ${oldCap}`);

const cursor = createExplanationSpeechCursor(segs);
assert(cursor.segmentIndex() === 0, 'cursor starts at greeting');
cursor.pushChunk(segs[0]!.text);
assert(cursor.segmentIndex() === 0, 'full first chunk still greeting');
cursor.pushChunk(segs[1]!.text);
assert(cursor.segmentIndex() === 1, 'second chunk advances visual');

console.log('guidedFeatureTour.smoke.test.ts ok');
