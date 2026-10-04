# Reisebüro — Perfect-Trip Vision (Stand 17.09.2026 spät)

**Ziel:** Profi-Gespräch → Brief mit Ranking + Zeitfenster-Wertigkeit → Research offen→eng (Theater = Live-Fortschritt) → **mind. 2 / offen 4** Magazin-Optionen mit Tages-Timetable + Karte → Mic → Timeline.

Wortlaut frei. Stadt-agnostisch.

Doks: `REISEBUERO_FRAGENKATALOG.md` · `REISEBUERO_TOURIST_SUBPATHS.md` · `REISEBUERO_REBUILD_MASTERPLAN.md` · `REISEBUERO_PARTNER_FIELDS.md`

---

## Theater ≠ Timeline (klar)

| Begriff | Wann | Was |
|---------|------|-----|
| **Theater (Akt 3)** | Während der Suche | Warte-UI: Checkliste „was gerade läuft“ (Region scannen → Flüge → Stays → Vergleich…). **Kein** Reise-Tagesplan. |
| **Tages-Timetable (Akt 4 Magazin)** | Nach der Suche | Pro Kalendertag: Datum + Wochentag + Uhrzeiten + was passiert (Anreise Fr, Samstag Programm, So Rück…). Multi-City: Tag 1 Mailand, Tag 3 Verona… |
| **Yorro-Timeline (Akt 5)** | Commit | Derselbe Timetable als App-Stops **mit Links** (Flug, Hotel, Tickets, Events). |

---

## Zeitfenster-Wertigkeit (Beispiel)

User: „Am liebsten Freitag los; **Donnerstag ab 13 Uhr geht auch**. Rück **Dienstag schöner als Mittwoch**.“

Ledger merkt:
- Prefer outbound: Fr · Soft-ok: Do ≥13:00  
- Prefer return: Di · Soft-ok: Mi  

Score: gleicher Preis + Prefer-Tag = höher.  
Aber: Di 06:00-Rück vs. Mi 14:00 → Mi kann gewinnen (mehr Zeit am Ziel) — Speech erklärt den Trade-off.  
Unsicher → **zwei Flug-/Paket-Optionen** im Magazin (nicht nur eine).

---

## Optionen-Anzahl (Akt 4)

| Brief | Min. Optionen | Typisch |
|-------|---------------|---------|
| Sehr offen (warm+günstig, egal wohin) | **4** | Verschiedene Städte/Regionen |
| Mittel (Richtung klar, Lodging flex) | 2–4 | Städte oder Lodging-Spuren |
| Sehr spez. (Prag dieses WE) | **mind. 2** | z. B. 2 Hotels **oder** 2 Flugfenster (Do/Fr) |

Gleich teuer + Prefer-Tag → Prefer gewinnt; sonst beide zeigen und User wählen lassen („zweites Magazin“ / zweite Karte).

---

## Multi-City / Hop (Norditalien-Beispiel)

Brief: Mailand → Verona (Zug) → Venedig.  
Research: pro Stop Stay + Zug dazwischen + Tage nummerieren.  
Magazin-Timetable: jeder Tag = Stadt + Datum + Wochentag + Blocks mit Links.

---

## Akt 1–5 (Kurz)

1. **Collect** — Katalog + Unterpfade (Personas) + Ranking + Zeitflex + Inventar; Flipchart nur LLM.  
2. **Confirm** — menschlicher Recap.  
3. **Research Theater** — Stages step-by-step (offen→eng).  
4. **Present** — 2–4 Optionen, Timetable/Tag, Karte mit Nummern, Mic-Feinschliff.  
5. **Commit** — Timeline mit allen Links.

---

## LLM vs Code

LLM: verstehen, Härte, Labels, Recap, Research-Plan-Text, Trade-off-Erklärung.  
Code: Katalog-Keys, Ledger, APIs, Score-Zahlen, Magazin/Timeline/Karte ausführen.
