const fs = require('fs');
const path = require('path');

const popupPath = path.join('src', 'components', 'homeMap', 'HomeMapPlacePopup.tsx');
let s = fs.readFileSync(popupPath, 'utf8');
if (!s.includes('shouldShowHomeMapPopupCategory')) {
  s = s.replace(
    'export type HomeMapPopupPlace = MapPlacePreview;\n\nfunction listedPopupUrl',
    `export type HomeMapPopupPlace = MapPlacePreview;

/** Gelbe Rubrik nur wenn sie wirklich hilft — nicht bei Amenity-Duplikaten. */
function shouldShowHomeMapPopupCategory(
  category: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const cat = String(category || '').trim();
  if (!cat || /^ort$/i.test(cat)) return false;
  if (
    /^(Packstation|Toilette|Briefkasten|Geldautomat|Parkplatz|Bushaltestelle|ÖPNV|Supermarkt|Tankstelle|Apotheke|Kiosk)$/i.test(
      cat,
    )
  ) {
    return false;
  }
  const n = String(name || '').toLowerCase();
  if (n && cat.toLowerCase() && n.includes(cat.toLowerCase())) return false;
  return true;
}

function listedPopupUrl`,
  );
}
const oldBlock = `        <Text style={styles.title} numberOfLines={2}>
          {place.name}
        </Text>
        <Text style={styles.cat}>{place.category}</Text>`;
const newBlock = `        <Text style={styles.title} numberOfLines={2}>
          {place.name}
        </Text>
        {shouldShowHomeMapPopupCategory(place.category, place.name) ? (
          <Text style={styles.cat}>{place.category}</Text>
        ) : null}`;
if (s.includes(oldBlock)) s = s.replace(oldBlock, newBlock);
const tmp = popupPath + '.tmp';
fs.writeFileSync(tmp, s);
fs.renameSync(tmp, popupPath);
console.log('popup ok');

const packPath = path.join('data', 'staedte', 'prisdorf.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const STRIP = new Set([
  'story_enriched',
  'module1',
  'quiz',
  'cta',
  'faq',
  'user_question',
  'story',
]);
let n = 0;
for (const spot of p.spots) {
  const blob = `${spot.name} ${spot.category} ${(spot.tags || []).join(' ')}`.toLowerCase();
  const dir =
    spot.pack_role === 'directory' ||
    spot.place_tier === 4 ||
    (spot.tags || []).includes('directory') ||
    (spot.tags || []).includes('tier4');
  const everyday =
    /supermarket|supermarkt|edeka|marktkauf|tankstelle|fuel|packstation|dhl|ernsting|toilette|apotheke|fris[oö]r|kiosk|bakerei|bäck/.test(
      blob,
    );
  if (!(dir || everyday)) continue;
  const before = JSON.stringify(spot.tags || []);
  spot.tags = (spot.tags || []).filter((t) => !STRIP.has(String(t).toLowerCase()));
  if (!(spot.tags || []).includes('directory')) spot.tags.push('directory');
  if (!(spot.tags || []).includes('tier4')) spot.tags.push('tier4');
  spot.pack_role = 'directory';
  spot.place_tier = 4;
  if (/toilette|\bwc\b/.test(blob)) {
    spot.bullets = [
      'Öffentliche Toilette im Marktkauf / Center',
      'Öffnung über den Button — Sauberkeit wenn belegt',
    ];
    spot.category = 'toilette';
  }
  if (/packstation|parcel/.test(blob)) {
    spot.bullets = (spot.bullets || [])
      .map((b) =>
        String(b)
          .replace(/\s*[—–-]\s*OSM.*/i, '')
          .replace(/parcel_locker/gi, '')
          .trim(),
      )
      .filter(Boolean);
    if (!spot.bullets.length) {
      spot.bullets = ['Paketautomat · Abholen & Einliefern'];
    }
  }
  if (JSON.stringify(spot.tags || []) !== before) n += 1;
}
p.data_version = (p.data_version || 0) + 1;
p.updated_at = new Date().toISOString();
const packTmp = packPath + '.tmp';
fs.writeFileSync(packTmp, JSON.stringify(p, null, 2));
fs.renameSync(packTmp, packPath);
console.log('prisdorf cleaned', n, 'v', p.data_version);
