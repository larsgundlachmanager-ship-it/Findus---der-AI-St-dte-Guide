import { packPlaceNameScore } from './src/services/navigation/packPlaceNameScore';
import { canonicalizeLandmarkQuery } from './src/services/navigation/landmarkAliases';

const poi = 'Tennis-Club Prisdorf TCP';
for (const q of [
  'Tennis Club Prisdorf',
  'Tennis-Club Prisdorf',
  'Tennisclub Prisdorf',
  'Tennis Club prsidorf',
  'Tennis Club prisodrf',
  'zum Tennis Club',
  'Tennis Club',
  'TCP Prisdorf',
  'Navigier mich zum Tennis Club Prisdorf',
]) {
  const c = canonicalizeLandmarkQuery(q);
  const scoreRaw = packPlaceNameScore(poi, q);
  const scoreCanon = packPlaceNameScore(poi, c.query);
  console.log(
    JSON.stringify({
      q,
      scoreRaw,
      scoreCanon,
      canon: c.query,
      matched: c.matchedLandmark,
      city: c.preferredCityId,
    }),
  );
}
