/**
 * Flug-Advisor: Status & Airport-Pacing.
 * Flight codes are NEVER inferred from clock times („um 19:00“ ≠ UM19).
 * Prefer LLM router intent `flight_status`.
 * Inselflieger (Harle⇄Wangerooge) → eigene Preise/Zeiten, keine Flugnummer.
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import type { GeminiConciergeResponse } from '../../types/concierge';
import {
  buildAirportArrivalPlan,
  fetchFlightByIdent,
  hasFlightAwareKey,
  type AirportArrivalPlan,
} from './FlightTrackingService';
import {
  isInselfliegerQuery,
  prepareInselfliegerFollowUp,
} from './inselfliegerAdvisor';

const FLIGHT_CONTEXT =
  /\b(flug|flieger|fliegen|flieg(?:e|st)?|abflug|boarding|gate|gepäckband|gepaeckband|baggage|flugnummer|flugstatus|flughafen|airline)\b/iu;

const HARD_FLIGHT =
  /\b(flugstatus|gate|boarding|gepäckband|gepaeckband|baggage|verspätung|verspaetung|flugnummer|wann\s+(?:muss|soll)\s+ich\s+(?:zum\s+)?flughafen)\b/iu;

/** Strip clock phrases so „um 19:00“ / „19 Uhr“ cannot become flight codes. */
export function stripClockPhrases(text: string): string {
  return text
    .replace(/\bum\s+\d{1,2}([:.\s]\d{2})?\s*(uhr)?\b/giu, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\s*(uhr)?\b/giu, ' ')
    .replace(/\b\d{1,2}\s*uhr\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFlightQuery(text: string): boolean {
  if (isInselfliegerQuery(text)) return true;
  return FLIGHT_CONTEXT.test(text);
}

/**
 * Extract IATA-style flight ident.
 * @param requireContext default true — blocks „um 19“ → UM19 unless pure „LH400“.
 */
export function extractFlightCode(
  text: string,
  opts?: { requireContext?: boolean },
): string | null {
  // Island liner flights have no commercial IATA code the user would know
  if (isInselfliegerQuery(text)) return null;

  const requireContext = opts?.requireContext !== false;
  const trimmed = text.replace(/\s+/g, ' ').trim();

  if (requireContext && !FLIGHT_CONTEXT.test(trimmed)) {
    if (!/^[A-Za-z]{1,3}\s?\d{1,4}[A-Za-z]?$/i.test(trimmed)) {
      return null;
    }
  }

  const cleaned = stripClockPhrases(trimmed);
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();

  const known = upper.match(
    /\b((?:LH|LX|OS|BA|AF|KL|EW|U2|FR|W6|SK|AY|IB|TP|AZ|SN|DE|XQ|PC)\s?\d{1,4}[A-Z]?)\b/,
  );
  if (known?.[1]) return known[1].replace(/\s+/g, '');

  // German prepositions that become fake airline codes with a number
  if (/\b(UM|AM|IM|PM|ZM|NM|BIS|AB)\s?\d{1,4}\b/.test(upper)) {
    return null;
  }

  const generic = upper.match(/\b([A-Z]{2,3}\s?\d{2,4}[A-Z]?)\b/);
  if (generic?.[1]) {
    return generic[1].replace(/\s+/g, '');
  }
  return null;
}

/** Explicit Flug-Status — requires flight vocabulary, NOT a clock-derived code. */
export function isHardFlightQuery(text: string): boolean {
  return HARD_FLIGHT.test(text);
}

export async function prepareFlightFollowUp(
  text: string,
  opts?: { flightNumber?: string | null },
): Promise<{
  plan: AirportArrivalPlan | null;
  reply: string;
  offerReminder: boolean;
  concierge?: GeminiConciergeResponse;
} | null> {
  // Inselflieger first — never ask for a flight number
  const island = await prepareInselfliegerFollowUp(text);
  if (island) {
    return {
      plan: null,
      reply: island.reply,
      offerReminder: false,
      concierge: island.concierge,
    };
  }

  const explicit = (opts?.flightNumber ?? '').replace(/\s+/g, '').toUpperCase();
  const code =
    explicit ||
    extractFlightCode(text, { requireContext: true }) ||
    (FLIGHT_CONTEXT.test(text)
      ? extractFlightCode(text, { requireContext: false })
      : null);

  if (!explicit && !isFlightQuery(text) && !code) return null;

  if (!code) {
    // Personal „mein Flug morgen“ without number → clarify WHICH commercial flight
    if (
      /\b(mein(?:e[rn]?)?\s+flug|mein\s+flieger|ich\s+flieg)\b/iu.test(text) &&
      !isInselfliegerQuery(text)
    ) {
      return {
        plan: null,
        reply:
          'Welcher Flieger ist das genau — und wann fliegt er? Am besten mit Flugnummer, z. B. LH400, dann schau ich Gate und Verspätung.',
        offerReminder: false,
      };
    }
    return {
      plan: null,
      reply:
        'Meinst du den Inselflieger nach Wangerooge (Zeiten und Preise ohne Flugnummer), oder einen Linienflug mit Nummer — z. B. LH400?',
      offerReminder: false,
    };
  }

  if (!hasFlightAwareKey()) {
    return {
      plan: null,
      reply:
        `Für Flug ${code} brauche ich den FlightAware-Key (EXPO_PUBLIC_FLIGHTAWARE_API_KEY). ` +
        `Sobald der gesetzt ist, sag ich dir Gate, Verspätung und wann du zum Flughafen musst.`,
      offerReminder: false,
    };
  }

  const store = useFinnusStore.getState();
  const from =
    store.lastGpsLat != null && store.lastGpsLng != null
      ? { lat: store.lastGpsLat, lng: store.lastGpsLng }
      : null;

  const plan = await buildAirportArrivalPlan({
    flightCode: code,
    from,
    airportCoords: null,
  });

  if (!plan) {
    const raw = await fetchFlightByIdent(code);
    if (!raw) {
      return {
        plan: null,
        reply: `Zu Flug ${code} finde ich gerade keine Live-Daten. Prüfe die Schreibweise oder versuch es gleich nochmal.`,
        offerReminder: false,
      };
    }
    return {
      plan: null,
      reply: `Zu Flug ${code} finde ich gerade keine Live-Daten. Prüfe die Schreibweise oder versuch es gleich nochmal.`,
      offerReminder: false,
    };
  }

  return {
    plan,
    reply: plan.speechPreFlight.trim(),
    offerReminder: true,
  };
}
