# Gemini Deep Research — Tettnang Follow-up (Findus)

Nur belegte Fakten mit Quelle. Keine erfundenen Preise/Öffnungszeiten als harte Wahrheit — volatile Dinge mit `LIVE:` markieren.  
Pro Ort: visueller Anker, GPS/Eingang, mind. 5 FAQ inkl. **„Woran erkenne ich diesen Ort?“**, 1 Querverbindung, kaskadierende Approaches (100/50/20 m wo sinnvoll).

---

```
Follow-up-Recherche Tettnang (Bodenseekreis, BW) für Offline-Audio-Stadtführer Findus.

Bereits gut abgedeckt (nur ergänzen wenn neue stabile Fakten): Neues Schloss, Torschloss/Montfort-Museum, St. Gallus, Bärenplatz/Kronenbrauerei, Hopfengut N°20/Hopfenmuseum, Stadtgeschichte Montfort→Hopfenstadt.

## A) Vertiefen — aktuelle Story-Lücken

1) Ehemaliges Schießhaus Tettnang
- Baujahr/Epoche, ursprüngliche Nutzung, heutige Nutzung (verein/kultur/privat?)
- Adresse + genauer Navigationspin
- Visueller Anker (Fassade, Lage zur Altstadt/Schloss)
- 5 FAQ inkl. Erkennungsfrage + Querverbindung zu einem Montfort-Ort

2) Dorfweiher Siggenweiler
- Entstehungsgeschichte / öffentliche Zugänglichkeit
- Was man dort typischerweise macht (Spaziern, Eis, Natur) — ohne Preise
- Bezug zu Hopfengut N°20 / Hopfenpfad
- GPS + visueller Anker + 5 FAQ

3) Tettnanger Hopfenpfad (Gesamtroute, nicht nur ein Aussichtspunkt)
- Offizielle Länge, Start/Ziel, Markierung, Schwierigkeit, barrierefrei?
- Wichtige Stationen/Infotafeln (Namen)
- Beste Panoramapunkte (Brünnensweiler Höhe, Irrmannsberg, …) mit groben Koordinaten
- Querverbindung Bärenplatz ↔ Hopfengut
- LIVE: was saisonal sperren kann

4) Tettnang Altstadt (als Raum, nicht ein Gebäude)
- Historische Kernachsen (Straßennamen), Stadtmauerreste falls vorhanden
- Typische Fußroute 30–60 Min: Reihenfolge der Anker
- Visuelle Erkennungsmerkmale des Stadtkerns
- 5 FAQ

5) Paintball Action Tettnang
- Stabil: Standort/Ortsteil, Art des Angebots (Outdoor/Halle), Zielgruppe
- Keine Preise; LIVE für Buchung
- Visueller Anker + 3 FAQ (inkl. Erkennung)

6) Kronenbrunnen (vertiefen)
- Wasserversorgungshistorie präzise (1904 → 1960 Umbau belegt?)
- Trinkwasserfreigabe / Refill-Kontext
- 5 FAQ

7) Elektronikmuseum im Torschloss-Ensemble
- Gründung, Träger, Schwerpunkte der Sammlung (stabil)
- Verhältnis zu Montfort-Museum/Stadtarchiv im selben Ensemble
- 5 FAQ

8) Fliegerdenkmal & Gedenkstein Rappertsweiler Haufen
- Wer/was wird erinnert, Errichtungsjahr, genauer Ort
- Visueller Anker + je 3–5 FAQ

9) Wildpark Sonnenhalde / Waldlehrpfad / LSG Birkenweiher
- Stabil: Lage, was erlebbar ist, Wege
- Keine Eintrittspreise hart; LIVE markieren
- Je kurzer Block + Erkennungs-FAQ

10) Loretokapelle / St.-Anna-Kapelle / Heilig-Kreuz am Torschloss
- Welche Kapellen sind öffentlich relevant für Trigger, welche nur Katalog?
- Kurze stabile Fakten + GPS

## B) Stadtweite Lücken (Audit)

11) Spectrum Kultur / Veranstaltungsorte außer Carl-Gührer-Halle — stabile Namen + Adressen
12) Montfortfest & Bähnlesfest — nur Struktur (wann typischerweise, was passiert); Termine = LIVE
13) ÖPNV: stabile Linienübersicht BODO ab ZOB Bärenplatz; Fahrpläne = LIVE
14) Trinkwasser/Toiletten/Refill — vollständige stabile Liste mit Orten (ohne Öffnungsfenster als Wahrheit)
15) Souvenir-/Andenkenläden in der Innenstadt — Namen + Adressen (Trigger-kurz, keine Historie-Romane)
16) Wochenmarkt Tettnang (nicht Meckenbeuren): Ort, typischer Wochentag — LIVE Zeiten
17) Ehem. Klinik Emil-Münch-Straße: bestätigter Status Notaufnahme/Nachnutzung — alles Aktuelle als LIVE
18) Ortsteile Laimnau/Argen-Ufer: lohnt ein Story-Spot oder nur Directory?

## C) Format

Antwort strukturiert als JSON-ähnlich oder klare Abschnitte pro Spot:
- name, adresse, lat,lng, category
- general_info (≥120 Wörter wo Kernort)
- facts.origin / architecture / now
- faqs[5]
- approaches[{m, text}]
- querverbindung
- live_hints[]

Keine generischen Tourismusfloskeln. Quellen am Ende je Abschnitt.
```
