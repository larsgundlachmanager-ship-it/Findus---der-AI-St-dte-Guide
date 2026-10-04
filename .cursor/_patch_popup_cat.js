const fs = require('fs');
const p = 'src/components/homeMap/HomeMapPlacePopup.tsx';
let s = fs.readFileSync(p, 'utf8');
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
if (!s.includes(oldBlock)) {
  console.error('title/cat block not found');
  process.exit(1);
}
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(p, s);
console.log('ok');
