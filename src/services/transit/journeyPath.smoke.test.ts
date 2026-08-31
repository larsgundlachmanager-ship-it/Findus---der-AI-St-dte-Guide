/**
 * Run: npx --yes tsx src/services/transit/journeyPath.smoke.test.ts
 */
import { decodeMotisPolyline, decodePolylineFactor } from './journeyPath';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const prisdorf = { lat: 53.6769, lng: 9.7633 };
const pinneberg = { lat: 53.654, lng: 9.796 };

const pts5 = decodePolylineFactor('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 1e5);
assert(pts5.length >= 2, 'Google-Precision-5 decodiert');

const bogus = decodeMotisPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 6, prisdorf, pinneberg);
assert(bogus.length === 0, 'falsche Präzision wird verworfen (nicht neben der Karte malen)');

const chainOk = decodeMotisPolyline('', 6, prisdorf, pinneberg);
assert(chainOk.length === 0, 'leer → kein Fake-Pfad');

console.log('journeyPath.smoke.test.ts OK');
