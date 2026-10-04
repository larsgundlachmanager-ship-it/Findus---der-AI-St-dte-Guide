# Manuell testen — Stand nach Night-QA-Fixes

App neu gestartet gegen Metro (aktuelles Bundle). Owner-Gold frisch published.
Einmal App in den Vordergrund / kurz warten, damit Gold gezogen wird.

## Pflicht-Checks (die 6 kritischen)

1. **Flug Süden**  
   „Hey Yorro, ich will morgen fliegen — guck bei Hamburg Flüge, was geht so Richtung Süden, und ob ich noch Tickets kriege“  
   Erwartung: 2–3 Städte + Ticket/Suche-Buttons — **nicht** nur „Wohin? Ab HAM“.

2. **Taxi vorbestellen**  
   „Reserviere morgen früh um 7 Uhr ein Taxi zum Flughafen Hamburg“  
   Erwartung: Taxi/Uber mit Zeit + Link — **kein** Leave-by/ÖPNV, **kein** Wecker.

3. **Theater**  
   „Welche Theaterstücke oder Vorstellungen laufen heute oder die Tage in der Nähe?“  
   Erwartung: Theater/Spielplan (nicht Kino), Programm/Ticket/Route.

4. **Gastro Aussicht/Flair**  
   „Restaurant mit schöner Aussicht, gemütlichem Ambiente und gutem Flair — am besten Terrasse“  
   Erwartung: 1–2 Orte + Route/Speisekarte — **kein** „Kein Treffer: besten Terrasse…“.

5. **Boutique-Hotel**  
   „Boutique-Hotel mit Spa oder Sauna und Frühstück“  
   Erwartung: benannte Hotels + Buchungs-Link.

6. **Zahnbürste**  
   „Was brauche ich noch — eine Zahnbürste. Kannst du mich daran erinnern, die mitzunehmen?“  
   Erwartung: echte Erinnerung/Todo, kurze Bestätigung — **kein** Wecker.

## Extra (kurz)

- Wecker: „Ich werde um 9:30 Uhr geweckt werden“ → Titel Wecker, ein Stichpunkt, System-Wecker.
- Speisekarte-FU nach Steak-Pitch: „Zeig mir die Speisekarte vom ersten Restaurant“.
- Vegan: „Kein Fleisch bitte, ich will vegan essen“ → kein Biergarten/Steakhouse-Ersatz.
- Papst / Michel-Höhe: knappe Zahl, kein „wen meinst du?“.

## Tipps

- Metro muss laufen (Port 8081); USB + Debugging an.
- Nach Gold: App kurz in den Hintergrund und wieder öffnen.
- Bei Fail: Frage + Screenshot / Stichpunkte / Buttons schicken.
