from pathlib import Path

# proactiveHudEngine: disable battery tips
hud = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\proactiveHudEngine.ts")
ht = hud.read_text(encoding="utf-8")
old = """const produceBatteryCharge: TipProducer = () => {
  refreshBatteryCache();
  const bat = getCachedBatteryLevel01();
  if (bat == null || !Number.isFinite(bat)) return [];
  const pct = Math.round(bat * 100);
  // HUD vor Survival-Speech (15 %): ab 25 % fragen
  if (pct > 25) return [];
  const critical = pct <= 15;
  return [
    {
      id: `battery-${pct}`,
      kind: 'battery_charge',
      text: critical
        ? `🔋 Akku ${pct} % — Powerbank?`
        : '🔋 Brauchst du mehr Akku?',
      meta: critical
        ? 'Nächste Station ansteuern?'
        : `Noch ${pct} % — Station suchen?`,
      tellMorePrompt:
        'Akku wird knapp — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.',
      score: critical ? 97 : pct <= 18 ? 93 : 80,
    },
  ];
};"""
new = """const produceBatteryCharge: TipProducer = () => {
  // Keine ungefragten Akku-/Steckdosen-Vorschläge — nur wenn der User danach fragt.
  return [];
};"""
if old not in ht:
    raise SystemExit("produceBatteryCharge not found")
hud.write_text(ht.replace(old, new, 1), encoding="utf-8")
print("hud battery disabled")

# contextTriggerMatrix: remove low_battery block
ctx = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\contextTriggerMatrix.ts")
ct = ctx.read_text(encoding="utf-8")
old_ctx = """  if (bat != null && bat < 0.25) {
    push({
      id: 'low_battery_charge',
      score: bat < 0.18 ? 96 : bat < 0.2 ? 92 : 80,
      title: 'Brauchst du mehr Akku?',
      prompt:
        'Akku wird knapp — such Powerbank-Automaten oder Café mit Steckdosen in der Nähe und gib mir Route-Buttons.',
    });
  }

"""
if old_ctx not in ct:
    raise SystemExit("low_battery block not found")
ctx.write_text(ct.replace(old_ctx, "", 1), encoding="utf-8")
print("context low_battery removed")

# FINDUS_CHARGE_SURVIVAL_BLOCK
pol = Path(r"c:\Users\larsf\Findus 2.0\src\services\concierge\findusResponsePolicy.ts")
pt = pol.read_text(encoding="utf-8")
old_pol = """/** Akku / Handy laden — nie Fake-Läden, Speech = Stichpunkte = Buttons. */
export const FINDUS_CHARGE_SURVIVAL_BLOCK = `HANDY LADEN / AKKU (SSOT — Struktur, Wortlaut frei):
- Ab ≤ 20 % Akku: proaktiv Audio-first. Primär Powerbank-Automat (OSM/Nearby, nur mit Evidenz), dann Café/Restaurant mit Steckdose, dann öffentliche Einrichtung mit belegter Steckdose.
- NIEMALS Heimatmuseum, Heimathof, Heimathaus, Heimatbroschüre, Tourist-Info, Spielstadt, Souvenirladen oder generisches „Ort mit Steckdose“ als Lade-Spot — auch nicht „besser als nichts“.
- DE-Wort „laden“ = Geschäft, nicht aufladen. Pack-POIs nicht als Steckdose verkaufen.
- Speech, Stichpunkte und Route-Buttons nennen DIESELBEN 1–2 Orte (Name + Distanz + Art). Kein Kartentitel als Stichpunkt, keine Extra-Orte in der UI.
- Solange der Akku niedrig bleibt: erneut erinnern (nicht einmal sagen und 4 h schweigen). Geladen → Ruhe.
- Geschlossen oder Öffnung unbekannt → nicht vorschlagen. Lieber ehrlich „keinen glaubwürdigen Spot“ + Nochmal-Button.
${FINDUS_FEW_SHOT_DISCLAIMER}`;"""

new_pol = """/** Akku / Handy laden — nie Fake-Läden, Speech = Stichpunkte = Buttons. Nur auf Nachfrage. */
export const FINDUS_CHARGE_SURVIVAL_BLOCK = `HANDY LADEN / AKKU (SSOT — Struktur, Wortlaut frei):
- NUR wenn der User danach fragt (Steckdose / Powerbank / Akku laden). Keine ungefragten Lade-Vorschläge, kein Auto-Pitch bei niedrigem Akku.
- Reihenfolge: Powerbank-Automat (Evidenz) → Handy-Ladestation → Café/Bibliothek mit belegter Steckdose (OSM socket=* o. ä.). Soft-Fallback Café/Bäckerei nur wenn nichts Belegtes da ist — und ehrlich: „oft möglich, nicht garantiert“ (Bäckerei: „beim Bäcker oft kurz laden möglich“).
- NIEMALS Heimatmuseum, Heimathof, Heimathaus, Heimatbroschüre, Tourist-Info, Spielstadt, Souvenirladen oder generisches „Ort mit Steckdose“ als Lade-Spot — auch nicht „besser als nichts“.
- DE-Wort „laden“ = Geschäft, nicht aufladen. Pack-POIs nicht als Steckdose verkaufen.
- Speech, Stichpunkte und Route-Buttons nennen DIESELBEN 1–2 Orte (Name + Distanz + Art). Kein Kartentitel als Stichpunkt, keine Extra-Orte in der UI.
- Geschlossen oder Öffnung unbekannt → nicht vorschlagen. Lieber ehrlich „keinen glaubwürdigen Spot“ + Nochmal-Button.
${FINDUS_FEW_SHOT_DISCLAIMER}`;"""

if old_pol not in pt:
    raise SystemExit("policy block not found")
pol.write_text(pt.replace(old_pol, new_pol, 1), encoding="utf-8")
print("policy updated")
