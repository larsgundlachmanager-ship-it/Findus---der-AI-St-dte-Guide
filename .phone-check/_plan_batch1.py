# -*- coding: utf-8 -*-
"""Apply basemap bullets, live program, facets, polish wire, rating UI."""
from pathlib import Path
import re

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def patch(path: Path, old: str, new: str, label: str) -> None:
    t = path.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"MISSING: {label} in {path}")
    path.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("ok", label)


# --- basemap layers ---
patch(
    ROOT / "src/services/homeMap/basemapFeatureQuery.ts",
    """/** POI-/Place-Label-Layer der Basiskarte (für Screen-Tap-Auflösung). */
export function listBasemapPoiLayerIds(style: BasemapStyleLike): string[] {
  const ids: string[] = [];
  for (const layer of styleLayers(style)) {
    const id = typeof layer.id === 'string' ? layer.id : '';
    const type = typeof layer.type === 'string' ? layer.type : '';
    if (!id) continue;
    const lid = id.toLowerCase();
    const isPoiLike = lid.includes('poi') || lid.includes('place');
    const isLabel = type === 'symbol' || lid.includes('label') || lid.includes('name');
    if (isPoiLike && isLabel) ids.push(id);
  }
  return ids;
}""",
    """/** POI-/Place-/Park-Label-Layer der Basiskarte (für Screen-Tap-Auflösung). */
export function listBasemapPoiLayerIds(style: BasemapStyleLike): string[] {
  const ids: string[] = [];
  for (const layer of styleLayers(style)) {
    const id = typeof layer.id === 'string' ? layer.id : '';
    const type = typeof layer.type === 'string' ? layer.type : '';
    if (!id) continue;
    const lid = id.toLowerCase();
    if (
      /road|street|highway|waterway|boundary|admin|housenumber|address|transport/.test(
        lid,
      ) &&
      !/poi|place|amenity|shop/.test(lid)
    ) {
      continue;
    }
    const isLabel =
      type === 'symbol' || lid.includes('label') || lid.includes('name');
    if (!isLabel) continue;
    const isPoiLike =
      lid.includes('poi') ||
      lid.includes('place') ||
      lid.includes('park') ||
      lid.includes('wood') ||
      lid.includes('forest') ||
      lid.includes('landuse') ||
      lid.includes('leisure') ||
      lid.includes('amenity') ||
      lid.includes('shop') ||
      lid.includes('natural');
    if (isPoiLike) ids.push(id);
  }
  return ids;
}""",
    "basemap layers",
)

# --- categoryFallbackBullets expand ---
patch(
    ROOT / "src/services/homeMap/homeMapPlaceBullets.ts",
    """/** Wenn Pack-Fakten fehlen/leer: Typ-Stichpunkte statt leeres Popup. */
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
    return ['Haltepunkt', 'Live-Abfahrten über den Button'];
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
}""",
    """/** Wenn Pack-Fakten fehlen/leer: Typ-Stichpunkte statt leeres Popup. */
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
    return ['Kindergarten / Kita', 'Betreuung vor Ort'];
  }
  if (/feuerlösch|feuerloesch|gemeindeteich/.test(blob)) {
    return [
      'Feuerlösch- und Gemeindeteich',
      'Jugendfeuerwehr übt hier im Sommer',
    ];
  }
  if (/\\bbahnhof\\b|haltepunkt/.test(blob)) {
    return ['Haltepunkt', 'Live-Abfahrten über den Button'];
  }
  if (/bus_stop|\\bbus\\b|bushaltestelle/.test(blob) && !/bahnhof|haltepunkt/.test(blob)) {
    return ['Bushaltestelle', 'Live-Abfahrten über den Button'];
  }
  if (/\\bhotel\\b|motel|pension|unterkunft/.test(blob)) {
    return ['Hotel', 'Übernachtung vor Ort'];
  }
  if (
    /supermarket|supermarkt|edeka|rewe|aldi|lidl|frischecenter|marktkauf|food\\s*plus|netto|penny/.test(
      blob,
    )
  ) {
    return ['Supermarkt', 'Einkaufen in der Nähe'];
  }
  if (/convenience|kiosk|späti|spaeti/.test(blob)) {
    return ['Kiosk / Nahversorgung', 'Kurzer Einkaufsstopp'];
  }
  if (/mcdonald|burger\\s*king|fast.?food|imbiss/.test(blob)) {
    return ['Schnellimbiss', 'Essen to go'];
  }
  if (/tankstelle|fuel|petrol/.test(blob)) {
    return ['Tankstelle', 'Tanken und Shop'];
  }
  if (/aussicht|viewpoint|blitzblick|panorama/.test(blob)) {
    return ['Aussichtspunkt', 'Kurzer Stopp mit Blick'];
  }
  if (/\\bpark\\b|stadtpark|volkspark|grünanlage|gruenanlage|gehege|wald|forest|wood/.test(blob)) {
    return ['Park / Grünfläche', 'Zum Spazieren und Durchatmen'];
  }
  if (/\\bkino\\b|cinema|filmtheater/.test(blob)) {
    return ['Kino', 'Programm über den Button laden'];
  }
  if (/theater|theatre|schauspiel|oper/.test(blob)) {
    return ['Theater', 'Programm über den Button laden'];
  }
  if (/museum|galerie|kunsthalle/.test(blob)) {
    return ['Museum', 'Ausstellung und Eintritt prüfen'];
  }
  if (/café|cafe|kaffee|coffee/.test(blob)) {
    return ['Café', 'Kaffee und Pause'];
  }
  if (/biergarten|weingarten|restaurant|gasthof|bistro|pizzeria/.test(blob)) {
    return ['Gastronomie', 'Essen und Trinken vor Ort'];
  }
  if (/briefkasten|post_box|mailbox/.test(blob)) {
    return ['Briefkasten', 'Briefe einwerfen'];
  }
  if (/packstation|parcel|paketautomat/.test(blob)) {
    return ['Paketautomat', 'Pakete abholen oder einliefern'];
  }
  if (/apotheke|pharmacy/.test(blob)) {
    return ['Apotheke', 'Medikamente und Beratung'];
  }
  if (/bank|sparkasse/.test(blob) && !/geldautomat|atm/.test(blob)) {
    return ['Bank', 'Filiale vor Ort'];
  }
  const cat = categoryLabelForPoi(poi);
  if (cat && cat !== 'Ort') return [cat, 'Mehr Infos und Route im Popup'];
  if (name) return [name.length > 40 ? name.slice(0, 37) + '…' : name, 'Ort auf der Karte'];
  return ['Ort auf der Karte', 'Route starten möglich'];
}""",
    "category fallbacks",
)

# categoryFromName extras
patch(
    ROOT / "src/services/homeMap/homeMapPlaceBullets.ts",
    """  if (/gasthof|restaurant/.test(t)) return 'Restaurant';
  return null;
}""",
    """  if (/gasthof|restaurant|bistro|pizzeria/.test(t)) return 'Restaurant';
  if (/supermarket|supermarkt|edeka|rewe|aldi|lidl|frischecenter|food\\s*plus/.test(t)) {
    return 'Supermarkt';
  }
  if (/\\bpark\\b|gehege|stadtpark|wald|forest/.test(t)) return 'Park';
  if (/\\bkino\\b|cinema/.test(t)) return 'Kino';
  if (/theater|theatre/.test(t)) return 'Theater';
  if (/mcdonald|burger\\s*king|fast.?food/.test(t)) return 'Imbiss';
  if (/café|cafe|kaffee/.test(t)) return 'Café';
  return null;
}""",
    "categoryFromName",
)

# FACET_LABELS add laut skip (don't show laut as marketing) + all_you_can_eat + we already have afterwork
# Add to FACET_LABELS
patch(
    ROOT / "src/services/homeMap/homeMapPlaceBullets.ts",
    """  afterwork: 'Afterwork',
  after_work: 'Afterwork',
  gemütlich: 'gemütlich',
  gemuetlich: 'gemütlich',""",
    """  afterwork: 'Afterwork',
  after_work: 'Afterwork',
  gemütlich: 'gemütlich',
  gemuetlich: 'gemütlich',
  all_you_can_eat: 'All you can eat',
  allyoucaneat: 'All you can eat',
  // 'laut' absichtlich ohne Label — nur Filter, kein Werbe-Stichpunkt""",
    "facet labels ayce",
)

print("batch1 done")
