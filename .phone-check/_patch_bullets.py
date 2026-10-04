# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\homeMapPlaceBullets.ts")
text = p.read_text(encoding="utf-8")

old_facet = '''/** Facet-/Specialty-Stichpunkt aus tags_json bauen ("Gäste nennen oft: …"). */
function facetBulletFromPoi(poi: Poi | null | undefined): string | null {
  const raw = poi?.tags_json ?? '';
  if (!raw) return null;
  let tags: string[] = [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) tags = arr.map((t) => String(t).toLowerCase().trim());
  } catch {
    return null;
  }
  if (!tags.length) return null;
  const fromReviews = tags.includes('review_facet');
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (FACET_META_TAGS.has(t)) continue;
    const label = FACET_LABELS[t];
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 3) break;
  }
  if (!labels.length) return null;
  const lead = fromReviews ? 'Gäste nennen oft' : 'Bekannt für';
  let line = `${lead}: ${labels.join(', ')}`;
  // Bei Überlänge Tags reduzieren statt mitten im Wort schneiden.
  while (line.length > 72 && labels.length > 1) {
    labels.pop();
    line = `${lead}: ${labels.join(', ')}`;
  }
  return line.length <= 74 ? line : null;
}'''

new_facet = '''/** Facet-/Specialty-Stichpunkt — klar, ohne „Gäste nennen oft“. */
function facetBulletFromPoi(poi: Poi | null | undefined): string | null {
  const raw = poi?.tags_json ?? '';
  if (!raw) return null;
  let tags: string[] = [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) tags = arr.map((t) => String(t).toLowerCase().trim());
  } catch {
    return null;
  }
  if (!tags.length) return null;
  const nameCat = `${poi?.name ?? ''} ${poi?.category ?? ''}`.toLowerCase();
  // Bahnhof/Halt: keine Review-Facets („ruhig“ verwirrt).
  if (/\\bbahnhof\\b|haltepunkt|haltestelle|\\böpnv\\b/.test(nameCat)) return null;
  if (/\\btoilette\\b|\\bwc\\b|geldautomat|\\batm\\b|parkplatz|p\\+r/.test(nameCat)) {
    return null;
  }
  const wineBeerGarden =
    /\\bbiergarten|weingarten|wein[-\\s]*&\\s*bier|weinbar\\b/.test(nameCat) ||
    tags.includes('biergarten');
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (FACET_META_TAGS.has(t)) continue;
    if (t === 'ruhig' && labels.length === 0) continue;
    if (
      wineBeerGarden &&
      /^(pizza|asiatisch|burger|sushi|döner|doener|pasta)$/.test(t)
    ) {
      continue;
    }
    const label = FACET_LABELS[t];
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 3) break;
  }
  if (!labels.length) return null;
  let line = labels.join(' · ');
  while (line.length > 72 && labels.length > 1) {
    labels.pop();
    line = labels.join(' · ');
  }
  return line.length <= 74 ? line : null;
}

/** Wenn Pack-Fakten fehlen/leer: Typ-Stichpunkte statt leeres Popup. */
function categoryFallbackBullets(poi: Poi | null | undefined): string[] {
  if (!poi) return [];
  const name = (poi.name ?? '').trim();
  const blob = `${name} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
  if (/\\btoilette\\b|\\bwc\\b|restroom/.test(blob)) {
    return ['Öffentliche Toilette', 'Zum kurzen Stopp'];
  }
  if (/\\bgeldautomat\\b|\\batm\\b|bankomat/.test(blob)) {
    return ['Geldautomat', 'Bargeld abheben'];
  }
  if (/\\bkindergarten\\b|\\bkita\\b|krippe/.test(blob)) {
    return ['Kindergarten / Kita', 'Früher Dorfschule — heute Betreuung'];
  }
  if (/feuerlösch|feuerloesch|gemeindeteich/.test(blob)) {
    return [
      'Feuerlösch- und Gemeindeteich',
      'Jugendfeuerwehr übt hier im Sommer',
    ];
  }
  if (/\\bbahnhof\\b|haltepunkt/.test(blob)) {
    return ['Haltepunkt', 'Regionalzüge Richtung Hamburg und Elmshorn'];
  }
  if (/\\bhotel\\b|motel|pension|unterkunft/.test(blob)) {
    return ['Hotel', 'Übernachtung vor Ort'];
  }
  if (/supermarket|supermarkt|edeka|rewe|aldi|lidl|frischecenter|marktkauf/.test(blob)) {
    return ['Supermarkt', 'Einkaufen in der Nähe'];
  }
  if (/tankstelle|fuel|petrol/.test(blob)) {
    return ['Tankstelle', 'Tanken und Shop'];
  }
  if (/aussicht|viewpoint|blitzblick|panorama/.test(blob)) {
    return ['Aussichtspunkt', 'Kurzer Stopp mit Blick'];
  }
  if (/biergarten|weingarten|restaurant|gasthof/.test(blob)) {
    return ['Gastronomie', 'Essen und Trinken vor Ort'];
  }
  const cat = categoryLabelForPoi(poi);
  if (cat && cat !== 'Ort') return [cat];
  return [];
}'''

# Fix double-escaping: the new_facet used \\ for regex because of raw string confusion.
# Write with single backslashes as in TypeScript source.
new_facet = new_facet.replace("\\\\", "\\")

if old_facet not in text:
    raise SystemExit("old facet block not found")
text = text.replace(old_facet, new_facet)

old_end = """  if (facetBullet) return [facetBullet];
  const parkHint = poi ? parkingCostHintFromPoi(poi) : null;
  if (parkHint) return [compactLine(parkHint, WHAT_MAX)];
  return [];
}"""

new_end = """  if (facetBullet) return [facetBullet];
  const parkHint = poi ? parkingCostHintFromPoi(poi) : null;
  if (parkHint) return [compactLine(parkHint, WHAT_MAX)];
  return categoryFallbackBullets(poi);
}"""

if old_end not in text:
    raise SystemExit("old end not found")
text = text.replace(old_end, new_end)
p.write_text(text, encoding="utf-8")
print("ok")
