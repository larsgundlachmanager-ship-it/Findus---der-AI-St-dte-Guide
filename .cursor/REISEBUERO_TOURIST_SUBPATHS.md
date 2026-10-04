# Reisebüro — Touristen-Unterpfade (~30 Personas)

Hilft dem Katalog: **welche Extra-Fragen** nur bei welchem Typ. Keine Pflicht-Sätze — Struktur.

**SSOT Code:** `src/reisebuero/touristPersonas.ts` → `detectTouristPersonas` → `CatalogBranch` in `questionCatalog.ts`.  
**Gate:** `npx tsx src/reisebuero/touristPersonas.smoke.test.ts`

| # | Typ | Kern-Wunsch | Extra-Fragen / Unterpfad |
|---|-----|-------------|---------------------------|
| 1 | Party-Weekend Jungs | Clubs, Drinks | Musikrichtung, Vortrinken, wie lange Nacht, Lage laut ok |
| 2 | Paar romantisch | Ruhe, Dinner | ruhige Lage, Restaurant-Niveau, Spa light |
| 3 | Spa/Detox | Liegen, Wellness | spaIntent, inkl. Massage?, Strand vs. Hotel-Spa |
| 4 | All-Inclusive Sonne | Warm, AI, Pool | AI-Härte, Kinder?, Resort vs. Stadt |
| 5 | Städtetrip Kultur | Museen, Kirchen | cityExplore, Geschichte, Hop-on, Zentrum |
| 6 | Städtetrip Food | Essen, Märkte | Food-Niveau, Vegetarisch, Abend vs. Tag |
| 7 | Festival | Pflicht-Tage | Tickets schon?, Camping/Hotel, Nähe Gelände |
| 8 | Fußball-/Sport-Fan | Match-Tag | Sportart, nur Spieltag?, Stadion-Anreise |
| 9 | Grand-Slam / Tennis | Turnier-Fenster | Venue-Stadt, Ticket-Klasse, Mehrtage |
| 10 | Kreuzfahrt Erstling | Schiff, Häfen | schon mal?, Seetage vs. Land, Kabine, Allergie |
| 11 | Polarlicht-Kreuzfahrt | Region Nord | nur Nordroute, Jahresfenster, Seetage |
| 12 | Flusskreuzfahrt | Rhein/Donau… | embark, kurze Tage |
| 13 | Familie Kids-Club | Animation | Alter Kinder, „abschieben“ vs. zusammen |
| 14 | Familie ruhig | Strand, Tempo | Nickerchen, Kinderwagen, Nähe Strand |
| 15 | Senioren 70+ | Komfort, Tempo | Zugang, max Gehstrecke, Direktflug Pref |
| 16 | Senioren 80+ / Hilfe | Barrierefrei | Rollstuhl, Hilfe, Transfer door-to-door |
| 17 | Budget-Sparfüchse | Günstig | FlixTrain≠Bus, ÖPNV, Hostel ok?, Layover ok |
| 18 | Komfort-Business | Zeit, Direkt | max Layover, kein Nachtflug, Lounge egal |
| 19 | Roadtrip / Camper | Auto, Etappen | max Drive/Tag, Stellplätze, Fähre |
| 20 | Multi-City Hop | Mailand→Verona→Venedig | Städte-Reihenfolge, Nächte/Stop, Zug dazwischen |
| 21 | Wander-/Trek | Trails | Fitness, Hütten, Wetterfenster |
| 22 | Rad-/E-Bike | Touren | E-Bike Pref, Gepäck, Etappen-km |
| 23 | Strand + Party Mix | Tag Strand, Nacht Club | geo Mix, Transfer spät |
| 24 | Workation | WLAN, Ruhe | längerer Stay, Apartment must |
| 25 | Ski/Winter | Schnee, Skipass | Niveau, Nähe Lift, Mietwagen |
| 26 | Hochzeit/Event-Gast | Must-Da-Sein | Presence-Fenster, Anzug-Gepäck |
| 27 | Surfen/Wassersport | Spot, Wind | Spot-Name, Kurs vs. eigenes Board |
| 28 | LGBTQ+ Nightlife | Szene | Stadt-Szene, Safe Pref (ohne Stereotype-Hardcode) |
| 29 | Foto-/Architecture | Skyline, Spots | goldene Stunde, Aussicht must |
| 30 | „Egal wohin warm+günstig“ | Open Discover | Klima-Fenster, Deal-Lead, 4 Optionen Pflicht |

**Regel:** Branch nur öffnen, wenn Signal im Brief — nicht alle 30 abfragen.
