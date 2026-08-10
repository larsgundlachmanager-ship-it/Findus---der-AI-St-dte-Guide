/**
 * Hilfe-zuerst Monetisierung — Blaupausen für natürliche Partner-Momente.
 * User soll denken: „Danke, dass du mitdenkst.“ Provision = Nebenprodukt.
 * Keine Hardcode-Sätze — nur Struktur + Action-Hints.
 *
 * === AFFILIATE-ACTION-STRUKTUR (SSOT-Denkmodell) ===
 * 1) Moment erkennen (detectHelpFirstMoments) — nie Button ohne Hilfe-Kontext.
 * 2) Frühestmöglich Action bauen, sobald Ort/Intent klar ist:
 *    - Ort mit Koordinaten → immer Maps (OPEN_URL)
 *    - Hotel/Unterkunft → Expedia primär / Stay22 Backup (sofort, nicht erst am Ende)
 *    - Ticket/Attraction → preferTicketSource (Tiqets/GYG/…)
 *    - Flughafen/Roadtrip/explizit Mietwagen → DiscoverCars
 *    - Tour/Abend-Lücke → Tour-Booking wenn passend
 * 3) Max 1–2 Partner-Buttons pro Antwort + Maps; Hilfe-Ton, kein Pitch.
 * 4) Modul 5: mirroredActions beim Pitch; Modul 1: Maps+Hotel-Slot in Live-Card.
 */

import type { QuickAction } from '../../types/concierge';
import {
  buildBounceLuggageAction,
  buildCarRentalAction,
  buildExpediaAccommodationAction,
  buildTravelInsuranceAction,
  buildTravelpayoutsCategoryAction,
  buildTourBookingAction,
} from './affiliateService';
import { getCachedUserProfile } from '../userProfileService';

export type HelpFirstMomentKind =
  | 'airport_access'
  | 'hotel_night'
  | 'evening_free'
  | 'plan_gap_tour'
  | 'pre_flight_luggage'
  | 'abroad_esim'
  | 'travel_insurance'
  | 'roadtrip_car';

export type HelpFirstMoment = {
  kind: HelpFirstMomentKind;
  /** Prompt-Hint für die KI (Struktur, kein Script). */
  promptHint: string;
  /** Priority 1 = höchste (High-Ticket / starke Hilfe). */
  priority: number;
};

const AIRPORT_RE =
  /\b(flughafen|airport|abflug|boarding|gate\b|check[- ]?in\b|terminal)\b/iu;
const FLIGHT_RE = /\b(flug|flieger|fliegen|landung|ankunft\s+flug)\b/iu;
const CHECKOUT_RE =
  /\b(auscheck|check[- ]?out|zimmer\s+abgeb|hotel\s+verlass|noch\s+eine\s+nacht|übernacht|uebernacht)\b/iu;
const EVENING_RE =
  /\b(heute\s+abend|heut\s+abend|was\s+geht|nightlife|konzert|theater|show|veranstaltung)\b/iu;
const ABROAD_RE =
  /\b(ausland|roaming|esim|e-sim|kein\s+netz|daten\s+ausland)\b/iu;
const INSURANCE_RE =
  /\b(reiseversicherung|auslandsversicherung|travel\s*insurance)\b/iu;
const CAR_RE =
  /\b(mietwagen|leihwagen|auto\s+mieten|roadtrip|wagen\s+mieten)\b/iu;
const LUGGAGE_RE =
  /\b(gepäck|gepaeck|koffer|früheincheck|frueheincheck|spätabflug|spaetabflug)\b/iu;

/**
 * Kontext-Momente aus User-Text (+ optional Plan-Blob) erkennen.
 */
export function detectHelpFirstMoments(opts: {
  userText?: string | null;
  planBlob?: string | null;
  hasEveningGapHours?: number | null;
  hasLongGapHours?: number | null;
  flightOrAirportInPlan?: boolean;
  checkoutConflict?: boolean;
}): HelpFirstMoment[] {
  const blob = `${opts.userText ?? ''} ${opts.planBlob ?? ''}`.trim();
  const out: HelpFirstMoment[] = [];

  const airport =
    opts.flightOrAirportInPlan ||
    AIRPORT_RE.test(blob) ||
    FLIGHT_RE.test(blob);
  if (airport) {
    out.push({
      kind: 'airport_access',
      priority: 1,
      promptHint:
        'FLOW Anreise Flughafen: Problem lösen (wie kommt er hin / rechtzeitig) → ein klarer nächster Schritt + Button (Transfer und/oder Mietwagen). Hilfe-Ton, kein Partner-Pitch.',
    });
    if (LUGGAGE_RE.test(blob) || AIRPORT_RE.test(blob)) {
      out.push({
        kind: 'pre_flight_luggage',
        priority: 2,
        promptHint:
          'FLOW vor Flug/Früheinchecken: wenn Gepäck stört → Spot zum Abstellen anbieten + Button. Mitdenken, nicht verkaufen.',
      });
    }
  }

  if (opts.checkoutConflict || CHECKOUT_RE.test(blob)) {
    out.push({
      kind: 'hotel_night',
      priority: 1,
      promptHint:
        'FLOW Hotel-Nacht: Checkout/Abreise kollidiert mit späterem Plan → charmant klären ob noch eine Nacht sinnvoll ist → Expedia-Hotelsuche / Verlängerung. User soll Erleichterung spüren.',
    });
  }

  if (
    EVENING_RE.test(blob) ||
    (opts.hasEveningGapHours != null && opts.hasEveningGapHours >= 2)
  ) {
    out.push({
      kind: 'evening_free',
      priority: 2,
      promptHint:
        'FLOW Abend frei: 1–3 belegte Optionen was heute geht → kurz fragen ob etwas anspricht → Ticket/Route-Button nur zu Gesagtem. Kein Event-Spam.',
    });
  }

  if (opts.hasLongGapHours != null && opts.hasLongGapHours >= 2.5) {
    out.push({
      kind: 'plan_gap_tour',
      priority: 2,
      promptHint:
        'FLOW Plan-Lücke ≥ ~2–3 h: sinnvolle Füllung (Sight/Tour/Museum passend zur Zeit) → Ticket-Button wenn Kaufpfad existiert. Als Hilfe für tote Zeit, nicht als Upsell.',
    });
  }

  if (ABROAD_RE.test(blob)) {
    out.push({
      kind: 'abroad_esim',
      priority: 3,
      promptHint:
        'FLOW Ausland/Roaming: eSIM anbieten damit er erreichbar bleibt — Button BOOK_ESIM. Praktisch, nicht werblich.',
    });
  }

  if (INSURANCE_RE.test(blob)) {
    out.push({
      kind: 'travel_insurance',
      priority: 2,
      promptHint:
        'FLOW Absicherung: Reiseversicherung anbieten wenn Trip/Ausland im Kontext — Button TravelSecure. Kurz und hilfreich.',
    });
  }

  if (CAR_RE.test(blob) || (airport && /\b(weiter|mietwagen|auto)\b/iu.test(blob))) {
    out.push({
      kind: 'roadtrip_car',
      priority: 1,
      promptHint:
        'FLOW Flexibilität/Auto: Mietwagen nur wenn Strecke/Flughafen/Roadtrip es braucht — BOOK_CAR_RENTAL. Nicht in der Fußgängerzone.',
    });
  }

  out.sort((a, b) => a.priority - b.priority);
  // unique by kind
  const seen = new Set<string>();
  return out.filter((m) => {
    if (seen.has(m.kind)) return false;
    seen.add(m.kind);
    return true;
  });
}

/** Prompt-Block für Concierge / Planung (Hilfe zuerst). */
export function helpFirstMonetizationPromptBlock(
  moments: HelpFirstMoment[],
): string {
  if (moments.length === 0) return '';
  const lines = [
    '=== HILFE-ZUERST MONETARISIERUNG (SSOT) ===',
    '- User soll denken: „Mega danke, dass du mitdenkst.“ Provision ist Nebenprodukt — nie Pitch, nie Affiliate-Jargon.',
    '- Max. 1–2 Momente in dieser Antwort. Button = Hilfe, nicht Angebot.',
    '- Wortlaut frei aus Kontext; nur Struktur unten.',
  ];
  for (const m of moments.slice(0, 3)) {
    lines.push(`- [${m.kind}] ${m.promptHint}`);
  }
  return lines.join('\n');
}

/**
 * Plan-Final: passende Partner-Actions (max 2 extra), Hilfe-zuerst.
 */
export function buildHelpFirstPlanActions(opts: {
  planBlob: string;
  flightOrAirportInPlan: boolean;
  hasLongGapHours: number | null;
  hasEveningGapHours: number | null;
  cityName?: string | null;
  checkoutConflict?: boolean;
}): QuickAction[] {
  const moments = detectHelpFirstMoments({
    planBlob: opts.planBlob,
    flightOrAirportInPlan: opts.flightOrAirportInPlan,
    hasLongGapHours: opts.hasLongGapHours,
    hasEveningGapHours: opts.hasEveningGapHours,
    checkoutConflict: opts.checkoutConflict,
  });
  const city =
    opts.cityName?.trim() ||
    getCachedUserProfile()?.cityName?.trim() ||
    '';
  const actions: QuickAction[] = [];

  for (const m of moments) {
    if (actions.length >= 2) break;
    switch (m.kind) {
      case 'airport_access':
      case 'roadtrip_car':
        actions.push(buildCarRentalAction());
        if (m.kind === 'airport_access' && actions.length < 2) {
          actions.push(buildTravelpayoutsCategoryAction('transfer'));
        }
        break;
      case 'hotel_night':
        actions.push(
          buildExpediaAccommodationAction(city || 'Germany'),
        );
        break;
      case 'evening_free':
      case 'plan_gap_tour':
        actions.push(
          buildTourBookingAction({
            kind: 'tour',
            city: city || undefined,
            query: city || undefined,
          }),
        );
        break;
      case 'pre_flight_luggage': {
        const bounce = buildBounceLuggageAction();
        if (bounce) actions.push(bounce);
        else actions.push(buildTravelpayoutsCategoryAction('luggage'));
        break;
      }
      case 'abroad_esim':
        // BOOK_ESIM via presentConcierge — hier OPEN_URL Transfer skip
        break;
      case 'travel_insurance':
        actions.push(buildTravelInsuranceAction());
        break;
      default:
        break;
    }
  }

  // Dedup by type+url
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = `${a.type}:${a.payload.url ?? a.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Größte Zeitlücke zwischen Stops (Stunden), aus Start/End-Ms-Paaren. */
export function largestGapHours(
  intervals: Array<{ startMs: number; endMs: number }>,
): number | null {
  if (intervals.length < 2) return null;
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let max = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = (sorted[i + 1]!.startMs - sorted[i]!.endMs) / 3_600_000;
    if (gap > max) max = gap;
  }
  return max > 0 ? max : null;
}

/** Abendliche Lücke (ab 17 Uhr lokal) in Stunden. */
export function eveningGapHours(
  intervals: Array<{ startMs: number; endMs: number }>,
  dayKey: string,
): number | null {
  const [y, mo, d] = dayKey.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const eveningStart = new Date(y, mo - 1, d, 17, 0, 0, 0).getTime();
  const eveningEnd = new Date(y, mo - 1, d, 23, 0, 0, 0).getTime();
  const covering = intervals.some(
    (iv) => iv.startMs < eveningEnd && iv.endMs > eveningStart,
  );
  if (covering) {
    // free window = evening minus overlap — simplified: if last end before 20h
    const lastEnd = Math.max(...intervals.map((i) => i.endMs));
    if (lastEnd < eveningStart) return (eveningEnd - eveningStart) / 3_600_000;
    if (lastEnd < eveningEnd) return (eveningEnd - lastEnd) / 3_600_000;
    return null;
  }
  return (eveningEnd - eveningStart) / 3_600_000;
}
