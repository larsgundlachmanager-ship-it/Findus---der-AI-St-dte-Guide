# Gott-Zustand — Tabellenstand (Code vs. Illusion)

Ehrlich: **kein** Ein-Prompt-Gemini mit magischem Allwissen. Umgesetzt ist die härteste praktikable Version der Wunschliste.

| Wunsch | Stand jetzt |
|--------|-------------|
| Immer mitdenken, Erinnerungen/Trigger selbst anlegen, bei jeder Rückfrage besser lernen | **Härter:** AutoLearn Threshold 2, mehr Slots (Menü/Buchung/Öffnung), Sync → Collective Learning beim App-Start |
| Jede Frage so, dass nie Rückfrage nötig | **Härter:** Permission-Strip erweitert; Nav-Speech ohne „Wollen wir los?“; Just-Do-It Policy um ÖPNV/Uber/Eats/Portale |
| Beste Hotels/Restaurants + hart filtern + immer Live-Preise | **Härter:** günstig → Live-€ zuerst (Hotel Pflicht-Sort; Gastro wenn € aus Menü-Scrape). Restaurant-Partner-Livepreise gibt es weiterhin nicht (kein API) |
| Speisekarte / Theater-Programm + Preise + Buchungsbutton | **Härter:** Live Ticket/Programm-URLs → Modul-1-Buttons; Portale Eventim/GYG/Viator/Booking/… |
| Uber bestellen, ÖPNV Live + Verspätung, Nav+ÖPNV | **Härter:** Uber-Button bei ÖPNV-Strecken; Uber-Eats-Deep-Link bei Liefer-Intent; Verspätung bleibt in TransitAdvisor/Journey |
| Modul 1 weiß immer, wann Live-Preise | **Härter:** Venue-Program-Research vor Live-Card + Ticket-Buttons |
| Keine alten Probleme mehr im Code | **Nein** — Legacy bleibt; kritische Pfade gehärtet |

Feld-DoD bleibt manuell: `data/liveQuality/luebeck-altstadt-feld-playbook.md`
