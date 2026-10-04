# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\homeMapPlaceBullets.ts")
t = p.read_text(encoding="utf-8")
old = "import { parkingCostHintFromPoi } from './homeMapMobilityAmenity';\n"
new = """/** Park-Hinweis (ohne Mobility-Store-Import — Smoke-tauglich). */
function parkingCostHintFromPoi(poi: Poi): string | null {
  const blob = `${poi.name ?? ''} ${poi.category ?? ''} ${poi.tags_json ?? ''}`.toLowerCase();
  if (!/\\b(parkplatz|parkhaus|parking|p\\+\\s*r)\\b/i.test(blob)) return null;
  if (/\\bkostenlos|gratis|free parking|ohne gebühr|ohne parkgebühr\\b/i.test(blob)) {
    return 'Kostenlos parken';
  }
  const hourly = blob.match(/(\\d+[,.]?\\d*)\\s*€\\s*(?:\\/|pro)\\s*stunde/i);
  if (hourly) {
    return `ca. ${hourly[1]!.replace('.', ',')} €/Std.`;
  }
  if (/\\bgebührenpflichtig|parkticket|parkgebühr|münze|automat\\b/i.test(blob)) {
    return 'Gebührenpflichtig';
  }
  if (/\\bp\\+r\\b|park\\s+and\\s+ride/i.test(blob)) {
    return 'P+R — oft günstiger fürs Pendeln';
  }
  return null;
}

"""
if old not in t:
    raise SystemExit("import missing")
p.write_text(t.replace(old, new, 1), encoding="utf-8")
print("ok")
