# Manuelle Live-QA — Open-World / Dual-Pitch / Sticky (selbst testen)

Ziel: Du prüfst auf dem Handy. Agent nur bei FAIL fixen — spart Zeit/API.

Gerät: QA-Handy (nicht Nothing), App frisch geöffnet, GPS/Stadt mit Pack.

## A — Dual-Pitch (≥2 Optionen)

1. „Ich will heute Abend essen, kein Asiatisch.“  
   Erwartung: Bridge kurz → **zwei** passende Orte. Speech nennt Orte/Warum. **Kein** „leider keine Preise / zu dünn / in X nichts“. Buttons still (Route/Karte), nicht ansagen.
2. „All you can eat, aber kein Asiatisch.“  
   Erwartung: nur AYCE-Fit; Asiatisch raus. Zwei Optionen wenn möglich.
3. Wenn nur ein Pack-Treffer: App darf nachschärfen — am Ende trotzdem Ziel **zwei** Must-Fits oder **eine** ehrliche nächste Alternative (nicht 8× „nichts“).

## B — Pack first / kein Endlos-Loop

4. Ort mit gutem Pack (z. B. bekannte Stadt): einfache Gastro-Frage.  
   Erwartung: schnell, zwei Optionen aus Pack/nahe — kein langes Web-Theater in der Speech.
5. „Gibt’s hier eine Seilbahn?“ (Ort ohne Seilbahn)  
   Erwartung: **eine** klare Antwort („hier nicht → nächste Option Ort X“). Kein Ringsuch-Vortrag.

## C — Situation ohne Wunsch-Floskel

6. „Reifen platt“  
   Erwartung: hilft (Pitch/Web), kein „was meinst du genau?“
7. „Schlüssel in der Tiefgarage“  
   Erwartung: sticky Lösungspfad, nicht Trivia.
8. Optional: „Akku ist leer“ / „Akku leer, Termin in 20 Minuten“  
   Erwartung: als Problem erkannt (Laden/Powerbank), nicht Smalltalk.

## D — Sticky / Kill-Resume

9. „Bestell Taxi zum Flughafen, Flug um 14 Uhr.“ → Slot/Gepäck klären.  
   App **komplett zu** (Force-Stop) → neu öffnen → „Bestell wieder Taxi“ (**ohne** Flughafen-Wort).  
   Erwartung: Root Flughafen/Slots wieder da, kein blindes „Wohin?“
10. Compound: „Tisch reservieren und Taxi zum Flughafen.“  
    Dann nur Steak klären → Taxi-Root bleibt.

## E — Prefill still

11. Taxi vorbestellen mit Zeit → Button da.  
    Speech: Angebot/Zeit, **kein** „Link bereit / Formular / vorausgefüllt“.
12. Tisch-Reservierung → Button ok; leeres TheFork-Formular ok, **nicht** ansprechen.

## Bewertung

| Ergebnis | Aktion |
|----------|--------|
| PASS | nichts |
| FAIL | Screenshot + genauer Satz + was falsch war → Agent |

Kein Night-QA-Marathon nötig, wenn diese 12 Fälle grün sind.
