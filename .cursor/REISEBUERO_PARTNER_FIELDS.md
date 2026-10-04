# Reisebüro — Partner-Web-Felder (Brief muss füttern)

Was die wichtigsten Partner-Suchen typisch brauchen. Katalog/Ledger → Deeplink-Prefill.  
(Kein Scraping-Vertrag — nur bekannte Query-Felder / Deep-Link-Params aus unserem Affiliate-Code.)

## Flug (Kiwi / Airline / Meta)

| Feld | Ledger / Slot |
|------|----------------|
| from / to (IATA oder Stadt) | origin* , destination / place |
| outbound + return date | dateStart/End + whenFlex prefer |
| adults / children / infants | adults, children, ages |
| cabin bags / checked bags | cabinBags, checkedBags |
| direct / max stops | directFlight, maxFlightStops |
| max layover h | flightComfort.maxLayoverHours |
| no night / no early | flightComfort |
| currency / locale | app |

## Bahn (bahn.de)

| Feld | Slot |
|------|------|
| from / to station or city | origin, dest |
| date + time prefer | dateStart, departWindow |
| age / Bahncard | travelerAges, bahncard |
| class / flex | railFlex |
| max duration | maxRailH / maxDriveHours |

## FlixTrain / FlixBus (shop.flixbus.de)

| Feld | Slot |
|------|------|
| from / to | origin, dest |
| date | dateStart |
| pax | adults |
| **Train vs Bus** | surfacePref (neu) |

## Stay (Booking / Expedia / Airbnb / Stay22)

| Feld | Slot |
|------|------|
| city / lat-lng | place |
| checkin / checkout | stay window |
| adults / children | adults, children |
| rooms | inferred from adults |
| lodging type | lodgingKind + lodgingRank |
| AI / board | meals |
| amenities | must/wish/nice |
| budget | budgetEur |

## Mietwagen (Economybookings / CHECK24 Car)

| Feld | Slot |
|------|------|
| pickup location | Zielstadt / Airport |
| pickup / dropoff date | checkin/out |
| driver age | travelerAges min |

## Transfer / Taxi (Uber / Maps)

| Feld | Slot |
|------|------|
| from hub → stay | transferPref, coords |
| time | arriveAt |

## Kreuzfahrt (Partner / Meta)

| Feld | Slot |
|------|------|
| region / date | cruise* , dateWindow |
| nights | stayNights |
| line | cruiseLine |
| cabin | cruiseCabin |
| fare / AI | cruiseFare / meals |
| embark port | cruiseEmbark* |
| sea days bias | cruiseSeaDays |
| pax / age | adults, ages |
| allergy / access | cruiseAllergy, accessNeeds |

## Events / Tickets (Tiqets / Viator / Musement)

| Feld | Slot |
|------|------|
| city / q | dest / activity |
| date | dayKey |
| category | mustActivities / event |
| pax | adults |

## Aktivitäten / Tours

| Feld | Slot |
|------|------|
| type (bike, museum…) | cityExplore / mustActivities |
| date | day plan |
| pax | adults |

## eSIM (Airalo etc.)

| Feld | Slot |
|------|------|
| country | dest country |
| need | needEsim |

## Pauschal (CHECK24 Package) — nur bei Intent

| Feld | Slot |
|------|------|
| destination, dates, pax, board | nur wenn pauschal/AI-Resort Intent |

---

## Audit-Pflicht (Phase 1.x / 4.x)

Vor Deeplink-Go-Live je Partner: Landing einmal manuell öffnen → welche Filter-UI existiert → Slot-Mapping prüfen → Smoke Prefill.
