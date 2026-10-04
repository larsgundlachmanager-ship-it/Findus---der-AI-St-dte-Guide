# Reisebüro — Fragenkatalog (Soll + Ist)

**Code-SSOT heute:** `src/reisebuero/questionCatalog.ts`  
**Wortlaut:** immer frei (Speech/LLM). Hier nur Struktur/Themen.

**Steuerung:** Master-Hart → aktive Branches → Rest Master → dynamische Extras → Tiefe 2.  
Branches nur, wenn der User die Richtung öffnet (oder Prefs aus früheren Trips).

**Härte / Ranking (Ledger):**

| Stufe | Bedeutung | Research |
|-------|-----------|----------|
| `must` / Erstspur | Muss sitzen | Ohne das keine Option |
| `wish` / Geilste | Stark gewollt | Primärspur suchen; wenn zu teuer/leer → ehrlich droppen oder Zweitspur |
| `optional` / Nice | Schön wenn da | Bonus; fehlt → still weglassen |
| `fallback` / Notfall | Zweit-Spur | Parallel suchen (z. B. Apartment wenn AI leer) |
| `nope` | No-Go | Nie vorschlagen |

Amenities parallel: `mustHaves` · `wishHaves` · `niceHaves`  
**Flipchart-Labels:** nur LLM (`llmFlipchartNotes`). Code führt aus, schreibt keine Sticker-Texte.

**Abhaken:** Schon in früheren Reisebüro-Trips beantwortet → Wert auf Shelf → nächster Trip Apply + nicht nochmal fragen (Taste/Shelf), Flipchart-Chips „✓ Thema“. Außer User öffnet neu / überschreibt.

---

## Master (Standard — fast immer)

| ID | Thema | Struktur-Seed | Wann / Regel | Status |
|----|--------|---------------|--------------|--------|
| `purpose` | Reise-Idee | Entspannen, Party, Spa, Event, Stadt, Familie…? | bis Richtung klar | ✅ da |
| `adults` | Gruppe | Allein / zu mehreren — wie viele? | | ✅ |
| `when` | Zeitraum | Monat / Fenster / konkrete Tage; Ferien selbst auflösen | | ✅ (Ferien härten) |
| `whenFlex` | Flex + Prefer | „Am liebsten Fr; Do ab 13 Uhr ok“ · „Rück Di schöner als Mi“ · frühestens/spätestens | soft vs prefer getrennt | ❌ neu (kritisch) |
| `budget` | Budget | Grob p.P.; Korrektur überschreibt | | ✅ |
| `origin` | Startort | Von wo? | außer Daytrip | ✅ |
| `lodging` | Unterkunft-Art | Hotel / Fewo / Apartment + Ranking Erst/Zweit | bei Übernachtung; skip wenn Stay gebucht | ✅ (Ranking-Frage 🔶) |
| `lodgingRank` | Erst-/Zweit-Spur | Geilste = AI-Hotel? Notfall = Apartment? | nach lodging/meals | ❌ neu |
| `bookedBits` | Inventar | Schon gebucht / was fehlt | Teil-Plan | ✅ |
| `needCar` | Mietwagen | Noch Mietwagen vor Ort? | nach Anreise/Stay klar | ✅ |
| `mode` | Anreise-Art | Flug / Bahn / Auto / egal+günstig | | ✅ |
| `surfacePref` | FlixTrain vs FlixBus | Bei Spar-Anreise: Train ok, Bus eher nicht? | wenn günstig/Bahn/Bus im Spiel | ❌ neu |
| `bags` | Gepäck | Hand / Aufgabe — Stückzahl | nur Flug, nicht gebucht | ✅ |
| `meals` | Verpflegung | Selbst / Frühstück / HP / AI + Härte | | ✅ |
| `localMove` | Vor Ort | Fuß / ÖPNV / Rad / E-Scooter / Mietwagen / Hop-on | | 🔶 erweitern |
| `ages` | Alter einzeln | Alter je Person | Gruppe / Spar / Familie | 🔶 (Slot da) |
| `bahncard` | Bahncard | Nur wenn Bahn/ICE/FlixTrain wirklich im Plan | Mode train/surface | 🔶 Gate härten |
| `geo` | Lage | Zentral / ruhig / nah am Spot/Event | | ✅ |
| `dest` | Ziel / offen | Stadt, Region oder noch offen | | ✅ |
| `accessNeeds` | Zugang / Alter | 70+/80+, Rollstuhl, Mobilität — was brauchen wir? | wenn Alter hoch / erwähnt | ❌ neu |
| `cityExplore` | Stadt-Erwartung | Viel erkunden? Zentrum wohnen oder reinfahren? Tag/Abend? Museen/Kirchen/Geschichte? Rad/Scooter/Hop-on? | Städtetrip / dest klar | ❌ neu |
| `tripShapeAsk` | Form | Ein Hub / Multi-City-Hop / Roadtrip / Cruise | wenn mehrere Orte oder Rundreise | 🔶 Slot da, Frage dünn |
| `hopStops` | Hop-Stops | Reihenfolge Städte + Nächte je Stop | tripShape=hop | ❌ neu |

---

## Branch: Party (wenn Party/Clubs)

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `partyGrain` | Setting | Privat / Bars / Clubs | ✅ |
| `partyMusic` | Richtung | Techno, Schlager, Rock, Metal, Live, Mixed… | ❌ neu |
| `partyRhythm` | Intensität | Viel ausgehen? Vortrinken? Wie lange die Nacht? | 🔶 (depth dünn) |
| `partyDrinks` | Drinks | Günstige Drinks wichtig? | 🔶 |
| `partyDepth` | Nachziehen | Details wenn noch unklar | ✅ seed |

## Branch: Spa / Erholung

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `spaIntent` | Intensität | Nur liegen/Erholen, oder Wellness aktiv nutzen? | ❌ neu |
| `spaStyle` | Kern | Pool, Meer, Sauna, Massage, Therme… | ✅ grob |
| `spaInclude` | Inklusive? | Massage/Sauna schon im Preis / extra / egal | ❌ neu |
| `spaVsBeach` | Mix | Hauptsächlich Spa, oder Strand+liegen, oder beides | ❌ neu |
| `spaDepth` | Tiefe | Hotel-Spa am Stück vs. Tages-Therme | ✅ |

## Branch: Event / Festival

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `eventCore` | Welches Event / Richtung | Name oder Typ; Pflicht-Tage | ✅ |
| `eventDepth` | Tickets / Nähe Stay | Schon Tickets? Nah am Gelände? | ✅ |
| `eventRole` | Was macht ihr dort | Nur Hauptact, ganze Tage, Camping… | ❌ neu |

## Branch: Turnier / Sport

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `tournamentCore` | Sportart + Event | Fußball, Basketball, Tennis/Grand Slam… Datum | ✅ erweitern |
| `tournamentDepth` | Spieltag vs. länger | Nur Match oder Mehrtage; Anreise Stadion | ✅ |

## Branch: Kreuzfahrt

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `cruiseCore` | Region / Nächte | Wohin, wie lang | ✅ |
| `cruiseLine` | Reederei | Speziell oder egal | 🔶 Slot teils |
| `cruiseEmbark` | Start / sehen | Hafen, was an Land, Polarlichter… | 🔶 |
| `cruiseSeaDays` | Seetage vs. Häfen | Viele Seetage oder viele Orte / „halbe Welt“ | 🔶 Slot |
| `cruiseFare` | An Bord | All Inclusive / Getränke / was inkl. | 🔶 |
| `cruiseCabin` | Kabine | Innen / Meerblick / Suite | 🔶 |
| `cruiseDoneBefore` | Erfahrung | Schon mal Kreuzfahrt? | ❌ neu |
| `cruiseAllergy` | Allergien / Bord | Essen, Zugang | ❌ neu |
| `cruiseDepth` | Sammel-Tiefe | Einschiff/Kabine nachziehen | ✅ grob |

## Branch: Familie

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `kidsAges` | Alter Kinder | Einzeln | 🔶 |
| `kidsStyle` | Pref | Kids-Club „abschieben“ vs. kindergerecht zusammen | 🔶 präzisieren |
| `kidsPace` | Tempo | Animation, Strand, Ruhe | ✅ seed |

## Branch: Mode-Tiefe (Anreise) — **einzeln merken**

| ID | Thema | Struktur | Status |
|----|--------|----------|--------|
| `maxDriveH` | Max. Auto | Stunden | ✅ als driveTime |
| `maxRailH` | Max. Bahn | Stunden | ❌ getrennt |
| `maxFlightH` | Max. Flug | Stunden | 🔶 flightHours |
| `maxLayoverH` | Max. Umstieg | Stunden | 🔶 flightComfort |
| `directFlight` | Direktflug | Pflicht / ok | ✅ |
| `departWindow` | Los / Ankunft | Ab wann / bis wann; mehrere Tage ok | ✅ härten |
| `bags_deep` | Gepäck | Nachschärfen | ✅ |
| `transfer` | Hub→Stay | Taxi / ÖPNV / klar | ✅ |

---

## Dynamische Extras (KI darf Katalog ergänzen)

Wenn Antwort vage oder Branch neu → Extra-Frage, z. B.:

- Zeitfenster / Ferien nachschärfen  
- Budget-Rahmen  
- Anreise-Grenzen pro Modus  
- Ranking „geilste vs. Notfall“  
- Stadt: Museen/Kirchen/Geschichte ja/nein  
- Zugang/Mobilität  

---

## Partner-Web-Felder (Brief muss füttern)

Was Recherche-Sites typisch brauchen — Katalog/Ledger muss abdecken:

| Domäne | Felder |
|--------|--------|
| Flug | Datum(e), pax, Alter, Kabine Bags, Direkt, max Layover, from/to |
| Bahn | Datum, Alter, Bahncard, Sparpreis-Flex, max Dauer |
| Flix | Train vs Bus Pref, Datum, pax |
| Stay | Check-in/out, pax, lodging, AI/HP, Lage, Amenities, Budget |
| Mietwagen | Pickup Ort/Datum, Alter Fahrer |
| Kreuzfahrt | Reederei, Route, Seetage, Kabine, Fare, Embark, Pax/Alter |
| Events/Tickets | Datum, Venue, Kategorie |
| Aktivitäten | Typ (Rad, Museum…), Datum, pax |

---

## Unterpfade (Personas)

Siehe `REISEBUERO_TOURIST_SUBPATHS.md` (~30 Typen). Katalog öffnet nur passende Branches.

## Partner-Felder

Siehe `REISEBUERO_PARTNER_FIELDS.md`.

---

## Legende Status

- ✅ im Code als Frage/Slot  
- 🔶 teilweise / zu grob  
- ❌ fehlt — im Umbau-Masterplan
