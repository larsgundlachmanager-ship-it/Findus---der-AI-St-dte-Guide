/**
 * Findus Response Policy — eine SSOT für Concierge-Prompts.
 * Nicht überall dieselben Regeln wiederholen; hier importieren / einbinden.
 *
 * AGI-Architektur:
 * 1) Verfassung (Top-20) — immer
 * 2) Kontext-Gesetze — per ruleRouter
 * 3) Hard-Guardrails — Code (speechGuardrails)
 * 4) Law-Judge — nach Pass-2
 */

import { formatConstitutionBlock } from '../agi/findusLawRegistry';

/** Kurzblock für Pass-1 / Pass-2 / JSON-Instruction. */
export const FINDUS_JUST_DO_IT_BLOCK = `JUST-DO-IT (SSOT):
- Nie „Soll ich X heraussuchen?“ — Ergebnis schon in dieser Antwort + passende Buttons.
- Telefon → DIAL_PHONE „📞 Anrufen“. Party/Nightlife → 2 Orte + 2× Nav.
- Speisekarte nur mit echter URL → OPEN_URL.
- Rückfrage NUR bei echter Blockade (Personenanzahl, Datum, unklare Hotelwahl) — nie bei recherchierbaren Fakten.
- Mehrteilige Fragen: jede Teilfrage separat denken (Essen / Aussicht / Uhrzeit), dann zu EINEM Plan kombinieren.`;

/** Latency / frühes Feedback — für System-Prompts. */
export const FINDUS_LATENCY_BLOCK = `LATENZ:
- Lange Recherche (Web/Events): User braucht sofort Feedback — App spricht schon „ich guck kurz nach“, bevor Ergebnisse da sind.
- speechText: erst Ergebnis, kompakt. Keine Meta-Erklärungen über Recherche.`;

/** Compound-Intent — Essen + Spot. */
export const FINDUS_COMPOUND_PLAN_BLOCK = `MEHRTEILIGE PLÄNE:
- To-go/Mitnehmen + Sonnenuntergang/Aussicht = ZWEI Orte: (1) Imbiss/Bistro zum Mitnehmen, (2) echte Aussicht (Plattform, Düne, Weststrand) — NIE Bahnhof/Haltestelle/Fähre als Sunset-Spot.
- Nenne Geh-/Fahrzeit zwischen den Stops. Buttons: Route Essen, Route Aussicht, optional Speisekarte, optional Multi-Stop.`;

/** Tourist friction — short practical answers + action buttons. */
export const FINDUS_TOURIST_FRICTION_BLOCK = `TOURIST-FRICTION (SSOT):
- Toilette / ATM / Trinkwasser / WLAN: nächste konkrete Option + START_NAVIGATION — kurz, kein Aufsatz.
- Öffnungszeiten: nur belegte Zeiten aus Tools/Recherche; sonst ehrlich unsicher + OPEN_URL wenn URL da.
- Tickets/Eintritt: Kauf-Link wenn möglich (OPEN_URL / Partner), sonst ehrlicher Hinweis wo man sie bekommt.
- „Gehe ich richtig?“: Bezug zur aktiven Route; sonst Ziel erfragen.
- Speisekarte/Übersetzung: Text von Website zusammenfassen wenn URL da — nichts erfinden.
- Notfall: 112 nennen, ruhig bleiben, nächste Hilfe/Hotel anbieten — NIEMALS so tun als würdest du Notruf absetzen.`;

/** Top-20 Verfassung — immer im Modul-2 System-Prompt. */
export function findusConstitutionBlock(): string {
  return formatConstitutionBlock();
}

export function findusCorePromptAppendix(): string {
  return [
    findusConstitutionBlock(),
    FINDUS_JUST_DO_IT_BLOCK,
    FINDUS_LATENCY_BLOCK,
    FINDUS_COMPOUND_PLAN_BLOCK,
    FINDUS_TOURIST_FRICTION_BLOCK,
  ].join('\n');
}
