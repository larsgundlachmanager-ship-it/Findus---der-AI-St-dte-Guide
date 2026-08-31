/**
 * Flug-Job-Backend: unklar → welcher Flug; sonst Tafel-Felder.
 * Live-Fetch bleibt in flightAdvisor.prepareFlightFollowUp (nicht hier importieren — RN).
 */

export type FlightBoardFields = {
  terminal?: string | null;
  checkin?: string | null;
  gate?: string | null;
  boarding?: string | null;
  security?: string | null;
  leaveBy?: string | null;
  deeplink?: string | null;
};

const FLIGHT_HINT =
  /\b(flug|flieger|flughafen|abflug|gate|boarding|check-?in|terminal|leave-?by)\b/iu;

const FLIGHT_CODE = /\b((?:LH|LX|OS|BA|AF|KL|EW|U2|FR|W6|SK|AY|IB|TP|AZ|SN|DE|XQ|PC)\s?\d{1,4}[A-Z]?)\b/i;

export function needsWhichFlight(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!FLIGHT_HINT.test(t)) return false;
  if (FLIGHT_CODE.test(t)) return false;
  return !/\b(inselflieger|wangerooge|harle)\b/iu.test(t);
}

export function flightClarifySpeech(): string {
  return 'Welcher Flug genau — Nummer oder Uhrzeit und Ziel, dann hole ich Gate, Terminal und Leave-by.';
}

export function emptyFlightBoard(): FlightBoardFields {
  return {
    terminal: null,
    checkin: null,
    gate: null,
    boarding: null,
    security: null,
    leaveBy: null,
    deeplink: null,
  };
}
