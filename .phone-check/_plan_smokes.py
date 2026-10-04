# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# package.json
p = ROOT / "package.json"
t = p.read_text(encoding="utf-8")
needle = '"city:review-facets": "node scripts/cityPack/enrichReviewFacets.mjs",'
insert = needle + '\n    "city:enrich-facets-budget": "node scripts/cityPack/enrichFacetsBudgetPass.mjs",'
if "city:enrich-facets-budget" not in t:
    p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
    print("ok pkg")
else:
    print("skip pkg")

# live smoke
p = ROOT / "src/services/homeMap/mapPlaceLiveActions.smoke.test.ts"
t = p.read_text(encoding="utf-8")
block = r'''
// Kino → Kinoprogramm; Café nicht.
{
  const k = ids('CinemaxX', 'Kino', 'cinema');
  assert(k.includes('cinema_program'), 'Kino hat Kinoprogramm');
  assert(!k.includes('theater_program'), 'Kino ohne Theaterprogramm');
}
{
  const th = ids('Stadttheater', 'Theater', 'theater');
  assert(th.includes('theater_program'), 'Theater hat Theaterprogramm');
}
{
  const c = ids('Café Sonne', 'Café', 'cafe');
  assert(!c.includes('cinema_program') && !c.includes('theater_program'), 'Café ohne Programm-Buttons');
}
'''
if 'Kino hat Kinoprogramm' not in t:
    t = t.replace(
        "console.log('mapPlaceLiveActions.smoke.test.ts OK');",
        block + "\nconsole.log('mapPlaceLiveActions.smoke.test.ts OK');",
        1,
    )
    p.write_text(t, encoding="utf-8")
    print("ok live smoke")
else:
    print("skip live smoke")

# basemap smoke
b = ROOT / "src/services/homeMap/basemapFeatureQuery.smoke.test.ts"
bt = b.read_text(encoding="utf-8")
if "park-label" not in bt:
    bt = bt.replace(
        "{ id: 'poi-label', type: 'symbol' },\n    { id: 'place-city', type: 'symbol' },",
        "{ id: 'poi-label', type: 'symbol' },\n    { id: 'park-label', type: 'symbol' },\n    { id: 'place-city', type: 'symbol' },",
        1,
    )
    bt = bt.replace(
        "poiIds.includes('poi-label') && poiIds.includes('place-city'),\n  'poi/place label layer erkannt',",
        "poiIds.includes('poi-label') &&\n    poiIds.includes('place-city') &&\n    poiIds.includes('park-label'),\n  'poi/place/park label layer erkannt',",
        1,
    )
    b.write_text(bt, encoding="utf-8")
    print("ok basemap smoke")
else:
    print("skip basemap smoke")

# bullets smoke
hb = ROOT / "src/services/homeMap/homeMapPlaceBullets.smoke.test.ts"
ht = hb.read_text(encoding="utf-8")
extra = r'''
{
  const park = buildHomeMapPlaceBullets(
    {
      id: 11,
      name: 'Haun Gehege',
      lat: 53.67,
      lng: 9.76,
      radius_meters: 40,
      category: 'park',
      tags_json: '["park","wood"]',
      facts: [],
    },
    'park',
  );
  assert(park.length >= 1, 'Park/Basemap: Fallback-Stichpunkt');
  assert(/park|grün|gehege|spazier/i.test(park.join(' ')), 'Park-Identität');
}
{
  const shop = buildHomeMapPlaceBullets(
    {
      id: 12,
      name: 'Food Plus',
      lat: 53.67,
      lng: 9.76,
      radius_meters: 30,
      category: 'supermarket',
      tags_json: '["supermarket"]',
      facts: [],
    },
    'supermarket',
  );
  assert(shop.length >= 1, 'Supermarkt-Fallback');
  assert(/supermarkt|einkauf/i.test(shop.join(' ')), 'Supermarkt-Text');
}
'''
if "Haun Gehege" not in ht:
    ht = ht.replace(
        "console.log('homeMapPlaceBullets.smoke.test.ts OK');",
        extra + "\nconsole.log('homeMapPlaceBullets.smoke.test.ts OK');",
        1,
    )
    hb.write_text(ht, encoding="utf-8")
    print("ok bullets smoke")
else:
    print("skip bullets smoke")

# facet self-test laut
rf = ROOT / "scripts/cityPack/reviewFacetTags.mjs"
# ensure self-test still works - run later

print("smokes patched")
