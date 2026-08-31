/**
 * Run: npx --yes tsx src/services/ui/liveHudAmenityPitch.smoke.test.ts
 */
import {
  buildParkRestHudCard,
  buildPhotoSpotHudCard,
  isVagueRestOrPhotoName,
} from './liveHudAmenityPitch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const parkCard = buildParkRestHudCard({
  name: 'Stadtpark Altona',
  distanceM: 420,
  walkMin: 5,
  lat: 53.55,
  lng: 9.93,
});
assert(
  /Erholung/i.test(parkCard.title) && !/Park\?/i.test(parkCard.title),
  'park: Erholungs-Opener, keine Kategorie-Frage',
);
assert(
  /Stadtpark Altona/i.test(parkCard.meta) && /5 Min/i.test(parkCard.meta),
  'park: Name + Gehzeit in Meta',
);
assert(parkCard.navDest?.name === 'Stadtpark Altona', 'park: navDest');

const photoCard = buildPhotoSpotHudCard({
  name: 'Tele-Michel',
  distanceM: 280,
  walkMin: 3,
  lat: 53.56,
  lng: 9.98,
});
assert(
  /angucken|anschauen|Blick/i.test(photoCard.title) &&
    !/Foto-Spot\?/i.test(photoCard.title),
  'photo: Einladung, keine Kategorie-Frage',
);
assert(
  /Tele-Michel/i.test(photoCard.meta) && /3 Min/i.test(photoCard.meta),
  'photo: Name + Min',
);
assert(/was für dich/i.test(photoCard.tellMorePrompt), 'photo: Wahl-Frage');

assert(isVagueRestOrPhotoName('Park', 'park_rest'), 'vague park');
assert(!isVagueRestOrPhotoName('Stadtpark Altona', 'park_rest'), 'named park ok');
assert(isVagueRestOrPhotoName('Foto-Spot', 'photo_spot'), 'vague photo');

console.log('liveHudAmenityPitch.smoke.test.ts ok');
