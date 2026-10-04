# -*- coding: utf-8 -*-
"""Patch: no search-process speech + stronger spell traps + gold."""
from pathlib import Path
import json

ROOT = Path(r"c:\Users\larsf\Findus 2.0")

# --- pitchSpeech strip ---
ps = ROOT / "src/module2/pitch/pitchSpeech.ts"
s = ps.read_text(encoding="utf-8")
old_strip = """/** Such-Prozess-Meta nie vorlesen — nur finale Antwort. */
export function stripSearchProcessFromSpeech(text: string): string {
  let s = String(text || '');
  s = s.replace(/\\bOnline erweitert\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\bnicht nur Datensatz\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\bringweise\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(
    /\\bin\\s+(?:ca\\.?\\s*)?\\d{1,3}\\s*km\\b[^.!?]{0,40}\\b(?:nichts|kein(?:e|en)?|keine Treffer|leer)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\b(?:im Umkreis|innerhalb)\\s+(?:von\\s+)?\\d{1,3}\\s*km\\b[^.!?]{0,40}\\b(?:nichts|kein)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\bsoll(?:en)?\\s+ich\\s+weiter\\s+(?:suchen|gucken|schauen)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(/\\bPerfect-Strang\\b[^.!?]*[.!?]?/giu, ' ');
  return s.replace(/\\s+/g, ' ').trim();
}"""

new_strip = """/** Such-Prozess-Meta nie vorlesen — nur finale Antwort. */
export function stripSearchProcessFromSpeech(text: string): string {
  let s = String(text || '');
  s = s.replace(/\\bOnline erweitert\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\bnicht nur (?:im )?Datensatz\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\bringweise\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(
    /\\bin\\s+(?:ca\\.?\\s*)?\\d{1,3}\\s*km\\b[^.!?]{0,80}\\b(?:nichts|kein(?:e|en)?|keine Treffer|leer|gefunden)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\b(?:im Umkreis|innerhalb|unter|bis)\\s+(?:von\\s+)?\\d{1,3}\\s*km\\b[^.!?]{0,80}\\b(?:nichts|kein|leer|gefunden)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  // „bei 10 km nichts, bei 20 km …“ / „erst ab 20 km“
  s = s.replace(
    /\\b(?:bei|ab|erst ab|nach)\\s+(?:ca\\.?\\s*)?\\d{1,3}\\s*km\\b[^.!?]{0,60}[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\b(?:Umkreis|Radius)\\s+(?:auf|auf ca\\.?|auf zirka)?\\s*\\d{1,3}\\s*km\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\b\\d{1,3}\\s*\\/\\s*\\d{1,3}\\s*(?:\\/\\s*\\d{1,3})?\\s*km\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\bsoll(?:en)?\\s+ich\\s+weiter\\s+(?:suchen|gucken|schauen)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(
    /\\b(?:weiter\\s+(?:suchen|gucken|schauen)|noch\\s+weiter\\s+suchen)\\b[^.!?]*[.!?]?/giu,
    ' ',
  );
  s = s.replace(/\\bPerfect-Strang\\b[^.!?]*[.!?]?/giu, ' ');
  s = s.replace(/\\b(?:Such[- ]?Prozess|Recherche[- ]?Log)\\b[^.!?]*[.!?]?/giu, ' ');
  return s.replace(/\\s+/g, ' ').trim();
}"""

if old_strip not in s:
    raise SystemExit("pitchSpeech strip block mismatch")
s = s.replace(old_strip, new_strip, 1)

# Soft-fail prompt nudge
old_sf = "opts.softFail ? `SOFT_FAIL: ${opts.softFailReason ?? 'yes'}` : '',"
new_sf = """opts.softFail
          ? `SOFT_FAIL (intern): ${opts.softFailReason ?? 'yes'}\\nSpeech = nur finale Option(en). VERBOTEN vorlesen: km-Ringe, „nichts in X km“, Expand/Datensatz/ringweise, „weiter suchen?“.`
          : '',"""
if old_sf not in s:
    raise SystemExit("softFail prompt line missing")
s = s.replace(old_sf, new_sf, 1)

# Also strip each card speech before join
old_join = """    spokenText: stripSearchProcessFromSpeech(parts.join(' ').replace(/\\s+/g, ' ').trim()),"""
new_join = """    spokenText: stripSearchProcessFromSpeech(
      parts.map((p) => stripSearchProcessFromSpeech(p)).join(' ').replace(/\\s+/g, ' ').trim(),
    ),"""
if old_join not in s:
    raise SystemExit("spokenText join missing")
s = s.replace(old_join, new_join, 1)

tmp = ps.with_suffix(".ts.patching")
tmp.write_text(s, encoding="utf-8")
tmp.replace(ps)
print("pitchSpeech ok")

# --- criteriaCascade honesty ---
cc = ROOT / "src/module2/pitch/criteriaCascade.ts"
c = cc.read_text(encoding="utf-8")
c = c.replace(
    """      `Kernwunsch noch nicht belegt (${misses.slice(0, 3).join(', ')})${
        radius != null && radius >= 40
          ? ' — nächste größere Stadt / Web weiter prüfen.'
          : ' — Radius und Stadt erweitern.'
      }`""",
    """      `Kernwunsch noch nicht belegt (${misses.slice(0, 3).join(', ')}) — beste belegte Alternative pitchen (ohne Such-Prozess/km-Ringe vorlesen).`""",
)
c = c.replace(
    """        `${cheap} — ehrlich sagen und fragen, ob das passt oder weiter suchen.`""",
    """        `${cheap} — ehrlich nennen; keine „weiter suchen?“-Nachfrage, finale Option pitchen.`""",
)
c = c.replace(
    "'Speech: Lücke ehrlich nennen, dann Option(en); kein Technik-Jargon, keine Intern-Keys, keine km-Technik vorlesen.'",
    "'Speech: Lücke kurz (Preis/Blick), dann Option(en). VERBOTEN: km-Ringe, Datensatz/Expand-Meta, „nichts in 10 km“, „weiter suchen?“.'",
)
# silence unused radius warning if any - keep approxRadiusKm call or remove
if "const radius = approxRadiusKm(pool);" in c and "radius !=" not in c.split("const radius = approxRadiusKm(pool);")[1][:800]:
    c = c.replace("  const radius = approxRadiusKm(pool);\n", "  void approxRadiusKm(pool);\n")
tmp = cc.with_suffix(".ts.patching")
tmp.write_text(c, encoding="utf-8")
tmp.replace(cc)
print("criteriaCascade ok")

# --- phonetic ZWSP / dotted letters ---
pt = ROOT / "src/services/g2p/phoneticTransformer.ts"
p = pt.read_text(encoding="utf-8")
needle = "  // Kleinbuchstaben-Buchstabierfallen:"
if needle not in p:
    raise SystemExit("klein traps missing")
if "Zero-width" not in p:
    insert = """  // Zero-width / Soft-Hyphen zwischen Buchstaben → Wort (sonst Cartesia buchstabiert)
  s = s.replace(/([\\p{L}])[\\u200b\\u200c\\u200d\\ufeff\\u00ad]+([\\p{L}])/gu, '$1$2');
  s = s.replace(/([\\p{L}])(?:[\\u200b\\u200c\\u200d\\ufeff\\u00ad]+([\\p{L}]))+/gu, (m) =>
    m.replace(/[\\u200b\\u200c\\u200d\\ufeff\\u00ad]/g, ''),
  );

  // Punkt-/Mittelpunkt-Buchstabieren: R.e.s.t / R·e·s·t
  s = s.replace(/\\b(?:[\\p{L}][.·•]){2,}[\\p{L}]\\b/gu, (m) =>
    m.replace(/[.·•]/g, ''),
  );

"""
    p = p.replace(needle, insert + needle, 1)
    tmp = pt.with_suffix(".ts.patching")
    tmp.write_text(p, encoding="utf-8")
    tmp.replace(pt)
    print("phonetic zwsp ok")
else:
    print("phonetic zwsp already")

# --- owner gold ---
gold_path = ROOT / "src/module2/blueprints/ownerGold.pack.json"
data = json.loads(gold_path.read_text(encoding="utf-8"))
updates = {
    "dining::cascade_backtrack_honest_v1": (
        "Cascade <2 Perfect: eine passende Option trotzdem pitchen; Soft-Filter intern zurücknehmen. "
        "Speech = nur finale Antwort (Ort + Beleg). VERBOTEN: Such-Prozess, km-Ringe („nichts in 10 km / in 20 km“), "
        "Datensatz/ringweise/Expand-Meta, „weiter suchen?“. Distanz nur als kurze Lage am Ort."
    ),
    "dining::criteria_cascade_v1": (
        "Multi-Wunsch-Gastro: Cascade Perfect+Backtrack intern. Soft leer → Filter weglassen UND online erweitern (Backend). "
        "Call 2: nur finale Option(en) + kurze Lücke (Preis/Blick). Nie km-Ringe oder „weiter suchen?“ vorlesen."
    ),
    "dining::dataset_city_first_v1": (
        "Specialty-Gastro ohne genannte Stadt: Call 1 setzt researchCity/Datensatz (Metro wenn Specialty nicht am GPS-Heimatort). "
        "Leer lokal → nächste Packs, dann Live/Places-Expand (Ringe) nur intern. Speech: finale Treffer; Distanz nur als Lage, nie Recherche-Log."
    ),
    "events::radius_expand_honest_v1": (
        "Events leer am Ort: intern Umkreis erweitern bis Treffer. Speech: 1–2 passende Alternativen als finale Antwort. "
        "Nie „lokal nichts, deshalb 20 km“-Prozess vorlesen; Distanz nur nebenbei als Lage."
    ),
    "activity_poi::interest_activity_expand_v1": (
        "Lust auf Thema: Pitch Top-2. Pack lokal zuerst; leer → Umkreis intern (50–100 km). "
        "Speech: Ort + Preis/Ticket + Anreise-Lage — kein Expand-Log. Outdoor/Kleidung/Wetter nur wenn’s passt."
    ),
}
n = 0
for e in data["blueprints"]:
    sk = e.get("situationKey")
    if sk in updates:
        e["summary"] = updates[sk]
        avoid = list(e.get("avoid") or [])
        for a in ("search_process_meta", "permission_questions", "vague_filler"):
            if a not in avoid:
                avoid.append(a)
        e["avoid"] = avoid
        n += 1
gold_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"gold updated {n}")
