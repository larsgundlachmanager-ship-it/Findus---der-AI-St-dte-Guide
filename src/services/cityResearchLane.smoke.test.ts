/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/cityResearchLane.smoke.test.ts
 * Pure helpers — kein cityCatalog / softWorkingCity (RN).
 */
import * as fs from 'fs';
import * as path from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function ghostCityIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return slug || 'unknown';
}

function isTravelPlanExemptQuery(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(flug|fliegen|flieger|flughafen|boarding|abflug|ankunft\s+flug)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(wann|ab\s*wann).{0,48}\b(los|aufbrechen|abreisen|losfahren|losfliegen|hin)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  const venueAsk =
    /\b(frühstück|fruehstueck|essen|restaurant|café|cafe|bar|hotel|übernacht|uebernacht|übernachten|wo\s+kann|suche|spot|sehenswürdig|museum|kino|brunch|mittag|abendessen|dining)\b/iu.test(
      t,
    );
  if (
    !venueAsk &&
    /\b(nach|richtung)\s+[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-']{2,}/iu.test(t)
  ) {
    return true;
  }
  return false;
}

assert(ghostCityIdFromName('Paris') === 'paris', 'paris id');
assert(ghostCityIdFromName('Bad Homburg').includes('homburg'), 'bad homburg');

assert(
  isTravelPlanExemptQuery('Ich möchte nach Lissabon fliegen'),
  'fliegen nach = travel',
);
assert(
  isTravelPlanExemptQuery('Wann muss ich nach Lissabon'),
  'wann nach = travel',
);
assert(
  !isTravelPlanExemptQuery('Wo kann ich in Lissabon frühstücken'),
  'frühstück ≠ travel',
);
assert(
  !isTravelPlanExemptQuery('Hotel in Lissabon unter 100 Euro'),
  'hotel in city ≠ travel exempt',
);

const src = fs.readFileSync(
  path.join(__dirname, 'cityResearchLane.ts'),
  'utf8',
);
assert(/requires_download/.test(src), 'requires_download lane');
assert(/kind: 'ghost'/.test(src) || /"ghost"/.test(src), 'ghost lane');
assert(/isReisebueroActive|reisebuero/.test(src), 'reisebuero exempt');
assert(/ensureBrowse|ghostCityIdFromName/.test(src), 'ghost id helper');

console.log('cityResearchLane.smoke.test.ts ok');
