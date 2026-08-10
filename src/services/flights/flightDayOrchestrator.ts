/**
 * Flight-Day Orchestrator — Abflug-Erinnerung mit vollem Tagesplan.
 *
 * Schritte (deterministisch, nicht nur Prompt):
 * 1) Abflugzeit speichern
 * 2) Flugplatz finden
 * 3) Hotel → Flugplatz ETA
 * 4) Ankunftspuffer (Sicherheit/Check-in) recherchieren oder Insel-Default
 * 5) Checkout + Frühstück live nachschlagen (wenn nicht in Memory)
 * 6) Leave-by berechnen + Session-Plan + Reminder
 * 7) Gepäck-Optionen + Zeitlücken-Frage
 */

import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { getCachedUserProfile } from '../userProfileService';
import {
  estimateTravelEta,
  isInsideWangeroogeIsland,
} from '../navigation/travelEta';
import { findAirportPoi, type AirportPoiHit } from './findAirportPoi';
import {
  type AirportBufferMins,
} from './FlightTrackingService';
import { parseDepartureMsFromText } from '../notifications/reminderMath';
import { scheduleFlightDepartureReminder } from '../notifications/notificationService';
import { registerDepartureWatch } from '../logistics/logisticsTriggerEngine';
import { runWebResearch } from '../research/webResearchService';
import {
  buildBounceLuggageAction,
  isBounceAvailableForCity,
} from '../affiliate/affiliateService';
import type { SessionPlan } from '../../runtime/sessionPlanTypes';
import { useOpenQuestionStore } from '../../store/useOpenQuestionStore';
import {
  assessTimeBuffer,
  detectCheckedLuggage,
  wantsMoreAirportBuffer,
  wantsLessAirportBuffer,
  parseExplicitBufferMinutes,
} from '../planning/timeBufferPolicy';

export type FlightDayPlan = {
  departureMs: number;
  departureLabel: string;
  airport: AirportPoiHit | null;
  hotelName: string | null;
  hotelLat: number | null;
  hotelLng: number | null;
  walkMinutes: number;
  arriveEarlyMin: number;
  leaveByMs: number;
  remindAtMs: number;
  checkoutLabel: string | null;
  breakfastUntil: string | null;
  gapMinutes: number;
  islandMode: boolean;
  footOnly: boolean;
  luggageOptions: Array<'hotel' | 'bounce' | 'carry'>;
  promptBlock: string;
  researchNotes: string[];
};

const FLIGHT_DAY_RE =
  /\b(flieg|flug|flieger|abflug|flughafen|flugplatz).{0,80}\b(erinner|pünktlich|puenktlich|los\s*geh|aufbruch|rechtzeitig)|(?:erinner|pünktlich|puenktlich).{0,60}\b(flieg|flug|flieger|abflug)\b/iu;

const CLOCK_RE =
  /\b(?:um\s+)?(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:uhr)?\b/iu;

export function isFlightDayReminderQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (FLIGHT_DAY_RE.test(t)) return true;
  // Soft: flight word + clock + erinnern/wann los
  if (
    /\b(flieg|flug|flieger|abflug)\b/iu.test(t) &&
    CLOCK_RE.test(t) &&
    /\b(erinner|los|wann|pünktlich|puenktlich|check.?in|gepäck|gepaeck)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Follow-up: Puffer anpassen (Abflug steht schon im Memory)
  if (
    wantsMoreAirportBuffer(t) ||
    wantsLessAirportBuffer(t) ||
    (parseExplicitBufferMinutes(t) != null &&
      /\b(puffer|flughafen|flugplatz|abflug)\b/iu.test(t))
  ) {
    return true;
  }
  return false;
}

function parseHmToday(label: string, nowMs: number): number | null {
  const m = label.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(nowMs);
  d.setHours(h, min, 0, 0);
  if (d.getTime() < nowMs - 2 * 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Abflugzeit aus Text oder gespeicherten Fakten. */
async function resolveDepartureMs(userText: string): Promise<number | null> {
  const fromText = parseDepartureMsFromText(userText);
  if (fromText != null) return fromText;

  await useOpenQuestionStore.getState().hydrate();
  const depFact = useOpenQuestionStore
    .getState()
    .userFacts.find((f) => f.key === 'flug_abflug')?.value;
  if (depFact) {
    return parseHmToday(depFact, Date.now()) ?? parseDepartureMsFromText(depFact);
  }

  const blob = useFinnusStore
    .getState()
    .chatHistory.slice(-8)
    .map((m) => m.content)
    .join(' ');
  return parseDepartureMsFromText(blob);
}

function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function parseHmLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function extractFactTime(
  facts: Array<{ label: string; value: string; time?: string | null }>,
  keys: RegExp,
): string | null {
  for (const f of facts) {
    const blob = `${f.label} ${f.value} ${f.time ?? ''}`;
    if (!keys.test(blob)) continue;
    if (f.time && /\d{1,2}[:.]\d{2}/.test(f.time)) return f.time.replace('.', ':');
    const m = blob.match(/(\d{1,2})[:.](\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return null;
}

function islandBuffers(): AirportBufferMins {
  const assessed = assessTimeBuffer({ kind: 'flight_island' });
  return {
    boardingWindowMin: assessed.minutes,
    securityWaitMin: 0,
    terminalWalkMin: 0,
  };
}

function commercialBuffers(opts: {
  text: string;
  withCheckedLuggage: boolean;
  userPreferredMin: number | null;
}): AirportBufferMins {
  const assessed = assessTimeBuffer({
    kind: 'flight_commercial',
    text: opts.text,
    withCheckedLuggage: opts.withCheckedLuggage,
    userPreferredMin: opts.userPreferredMin,
  });
  // Ein Wert = Ankunftspuffer am Flughafen vor Abflug (70/90+)
  return {
    boardingWindowMin: assessed.minutes,
    securityWaitMin: 0,
    terminalWalkMin: 0,
  };
}

function totalArriveEarlyMin(buffers: AirportBufferMins): number {
  return (
    (buffers.boardingWindowMin ?? 0) +
    (buffers.securityWaitMin ?? 0) +
    (buffers.terminalWalkMin ?? 0)
  );
}

async function researchHotelTimes(hotelName: string): Promise<{
  checkout: string | null;
  breakfast: string | null;
  notes: string[];
}> {
  const notes: string[] = [];
  try {
    const result = await runWebResearch(
      `Hotel ${hotelName} Check-out Uhrzeit und Frühstückszeiten heute — live recherchieren`,
    );
    if (!result) {
      notes.push('Hotel-Web-Recherche ohne Ergebnis');
      return { checkout: null, breakfast: null, notes };
    }
    notes.push(...result.failures.slice(0, 2));
    const checkout = extractFactTime(
      result.facts,
      /check[- ]?out|auscheck|zimmer\s*abgeb/i,
    );
    const breakfast = extractFactTime(
      result.facts,
      /frühstück|fruehstueck|breakfast/i,
    );
    if (checkout) notes.push(`Checkout live: ${checkout}`);
    if (breakfast) notes.push(`Frühstück live: ${breakfast}`);
    return { checkout, breakfast, notes };
  } catch (err) {
    notes.push(
      `Hotel-Recherche fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { checkout: null, breakfast: null, notes };
  }
}

function parseTimesFromHotelNotes(notes: string | undefined): {
  checkout: string | null;
  breakfast: string | null;
} {
  if (!notes) return { checkout: null, breakfast: null };
  const checkout =
    notes.match(
      /(?:check[- ]?out|auscheck)[^\d]{0,20}(\d{1,2}[:.]\d{2})/i,
    )?.[1]?.replace('.', ':') ??
    notes.match(/(\d{1,2}[:.]\d{2})[^\n]{0,16}(?:check[- ]?out|auscheck)/i)?.[1]
      ?.replace('.', ':') ??
    null;
  const breakfast =
    notes.match(
      /(?:frühstück|fruehstueck|breakfast)[^\d]{0,24}(?:bis\s+)?(\d{1,2}[:.]\d{2})/i,
    )?.[1]?.replace('.', ':') ?? null;
  return { checkout, breakfast };
}

function persistHotelNote(patch: string): void {
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  if (!hotel) return;
  const existing = hotel.notes?.trim() ?? '';
  if (existing.toLowerCase().includes(patch.toLowerCase().slice(0, 18))) return;
  useUserMemoryStore.getState().addOrUpdateEntity({
    id: hotel.id,
    name: hotel.name,
    type: 'hotel',
    isConfirmed: hotel.isConfirmed,
    lat: hotel.lat,
    lng: hotel.lng,
    poiId: hotel.poiId,
    cityId: hotel.cityId,
    notes: existing ? `${existing} · ${patch}` : patch,
  });
}

function activateFlightSessionPlan(
  plan: FlightDayPlan,
  userText?: string,
): SessionPlan {
  const id = `flight-day-${plan.departureMs}`;
  const session: SessionPlan = {
    id,
    createdAtMs: Date.now(),
    freeRoam: true,
    leaveByMs: plan.leaveByMs,
    bufferMinutes: plan.arriveEarlyMin,
    boostPlaceTypes: ['beach', 'attraction', 'viewpoint', 'cafe'],
    stops: [
      {
        id: `${id}-airport`,
        kind: 'fixed',
        label: plan.airport?.name ?? 'Flugplatz',
        arriveByMs: plan.departureMs - plan.arriveEarlyMin * 60_000,
        lat: plan.airport?.lat ?? null,
        lng: plan.airport?.lng ?? null,
        placeTypes: ['airport'],
        items: [],
        done: false,
      },
    ],
    confirmSpeech: `Flug um ${plan.departureLabel} notiert — spätestens ${formatClock(plan.leaveByMs)} los.`,
    active: true,
    deadlineFired: false,
  };
  useSessionPlanStore.getState().setPlan(session);
  return session;
}

/**
 * Vollständiger Flight-Day-Lauf.
 */
export async function runFlightDayOrchestrator(
  userText: string,
): Promise<{
  plan: FlightDayPlan;
  response: GeminiConciergeResponse;
} | null> {
  const departureMs = await resolveDepartureMs(userText);
  if (departureMs == null) return null;

  const store = useFinnusStore.getState();
  const profile = getCachedUserProfile();
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  const userLat = store.lastGpsLat;
  const userLng = store.lastGpsLng;

  const airport = await findAirportPoi({
    lat: hotel?.lat ?? userLat,
    lng: hotel?.lng ?? userLng,
    hint: profile?.cityName ?? null,
  });

  const islandMode =
    (profile?.cityId ?? '').toLowerCase() === 'wangerooge' ||
    (airport != null &&
      isInsideWangeroogeIsland(airport.lat, airport.lng));

  await useOpenQuestionStore.getState().hydrate();
  const facts = useOpenQuestionStore.getState().userFacts;
  const storedPuffer = facts.find((f) => f.key === 'flug_puffer_min')?.value;
  const userPreferredMin = storedPuffer ? Number(storedPuffer) : null;
  const withCheckedLuggage =
    detectCheckedLuggage(userText) ||
    facts.some(
      (f) =>
        f.key === 'flug_gepaeck_aufgabe' &&
        /ja|true|1|mit/i.test(f.value),
    );

  const bufferAssess = islandMode
    ? assessTimeBuffer({ kind: 'flight_island', text: userText, userPreferredMin })
    : assessTimeBuffer({
        kind: 'flight_commercial',
        text: userText,
        withCheckedLuggage,
        userPreferredMin:
          userPreferredMin != null && Number.isFinite(userPreferredMin)
            ? userPreferredMin
            : null,
      });

  const buffers = islandMode
    ? islandBuffers()
    : commercialBuffers({
        text: userText,
        withCheckedLuggage,
        userPreferredMin:
          userPreferredMin != null && Number.isFinite(userPreferredMin)
            ? userPreferredMin
            : null,
      });
  const arriveEarlyMin = totalArriveEarlyMin(buffers);

  const fromLat = hotel?.lat ?? userLat;
  const fromLng = hotel?.lng ?? userLng;
  let walkMinutes = 15;
  let etaLabel = 'ca. 15 Min Fußweg (geschätzt)';
  if (airport && fromLat != null && fromLng != null) {
    const eta = estimateTravelEta({
      userLat: fromLat,
      userLng: fromLng,
      destLat: airport.lat,
      destLng: airport.lng,
      destName: airport.name,
    });
    walkMinutes = eta.totalMinutes;
    etaLabel = eta.label;
  }

  const leaveByMs =
    departureMs - (walkMinutes + arriveEarlyMin) * 60_000;
  const remindAtMs = leaveByMs - 30 * 60_000;

  const memTimes = parseTimesFromHotelNotes(hotel?.notes);
  let checkoutLabel = memTimes.checkout;
  let breakfastUntil = memTimes.breakfast;
  const researchNotes: string[] = [];

  if (hotel?.name && (!checkoutLabel || !breakfastUntil)) {
    const live = await researchHotelTimes(hotel.name);
    researchNotes.push(...live.notes);
    checkoutLabel = checkoutLabel ?? live.checkout;
    breakfastUntil = breakfastUntil ?? live.breakfast;
    if (live.checkout) persistHotelNote(`Checkout ${live.checkout}`);
    if (live.breakfast) persistHotelNote(`Frühstück bis ${live.breakfast}`);
  }

  // Default island checkout hint if still unknown — ask, don't invent
  const needCheckoutAsk = !checkoutLabel;

  const checkoutMins = parseHmLabel(checkoutLabel);
  const leaveMins = (() => {
    const d = new Date(leaveByMs);
    return d.getHours() * 60 + d.getMinutes();
  })();
  const gapMinutes =
    checkoutMins != null ? Math.max(0, leaveMins - checkoutMins) : 0;

  const bounceOk = isBounceAvailableForCity(profile?.cityId, profile?.cityName);
  const luggageOptions: FlightDayPlan['luggageOptions'] = bounceOk
    ? ['hotel', 'bounce', 'carry']
    : ['hotel', 'carry'];

  const footOnly = islandMode;
  const departureLabel = formatClock(departureMs);

  const plan: FlightDayPlan = {
    departureMs,
    departureLabel,
    airport,
    hotelName: hotel?.name ?? null,
    hotelLat: hotel?.lat ?? null,
    hotelLng: hotel?.lng ?? null,
    walkMinutes,
    arriveEarlyMin,
    leaveByMs,
    remindAtMs,
    checkoutLabel,
    breakfastUntil,
    gapMinutes,
    islandMode,
    footOnly,
    luggageOptions,
    researchNotes,
    promptBlock: '',
  };

  plan.promptBlock = [
    '=== FLIGHT-DAY PLAN (VERIFIZIERT — PFLICHT) ===',
    `Abflug: ${departureLabel} Uhr`,
    airport
      ? `Flugplatz: ${airport.name} (${airport.source}${airport.distanceM != null ? `, ${airport.distanceM} m` : ''})`
      : 'Flugplatz: NOCH NICHT GEFUNDEN — ehrlich nachfragen',
    hotel?.name
      ? `Hotel: ${hotel.name}`
      : 'Hotel: unbekannt — nachfragen wo User übernachtet',
    `Fußweg Hotel/Standort → Flugplatz: ${etaLabel} (~${walkMinutes} Min)`,
    `Ankunftspuffer am Flugplatz: ${arriveEarlyMin} Min (${islandMode ? 'Insel-Flugplatz' : bufferAssess.reason})`,
    `Leave-by: spätestens ${formatClock(leaveByMs)} vom Hotel/Standort los`,
    `Erinnerung: ${formatClock(remindAtMs)} (30 Min vor Leave-by)`,
    !islandMode
      ? 'Großflughafen-Regel: mind. 70 Min vor Abflug; mit Gepäckabgabe 90 Min — User nach mehr/weniger fragen'
      : '',
    checkoutLabel
      ? `Checkout: ${checkoutLabel}`
      : 'Checkout: UNBEKANNT — bitte live fragen ODER recherchiert nachliefern',
    breakfastUntil
      ? `Frühstück bis: ${breakfastUntil}`
      : 'Frühstück: unbekannt — nur nennen wenn recherchiert',
    gapMinutes >= 45
      ? `Zeitlücke nach Checkout bis Leave-by: ~${Math.round(gapMinutes)} Min — User fragen was er füllen will`
      : 'Keine große Zeitlücke oder Checkout unbekannt',
    footOnly
      ? 'Insel-Modus: nur zu Fuß — KEIN Taxi, KEIN ÖPNV anbieten'
      : 'Transport: Fuß/ÖPNV/Taxi je nach Stadt prüfen',
    `Gepäck-Optionen: ${luggageOptions.join(', ')} — User fragen (Hotel lassen / Bounce / mitnehmen)`,
    '',
    'ANTWORT-REGELN:',
    '- speechText vereint ALLE Punkte kompakt (du-Form).',
    '- visualBullets: Abflug, Leave-by, Checkout (wenn bekannt), Puffer.',
    '- quickActions: Erinnerung + Puffer mehr/weniger + Gepäck.',
    '- Bei Zeitlücke: konkrete Nachfrage („Strand oder Leuchtturm?“).',
    '- Nichts erfinden was nicht oben steht.',
  ]
    .filter(Boolean)
    .join('\n');

  activateFlightSessionPlan(plan, userText);

  // Persist facts for next turns
  useOpenQuestionStore.getState().mergeFromPass1({
    subQuestions: [
      { id: 'fd-leave', text: `Wann los zum Flug ${departureLabel}?`, priority: 95 },
      {
        id: 'fd-puffer',
        text: islandMode
          ? 'Insel-Puffer ok — mehr oder weniger?'
          : 'Großflughafen-Puffer: mehr oder weniger?',
        priority: 90,
      },
      ...(needCheckoutAsk
        ? [{ id: 'fd-checkout', text: 'Wann ist Hotel-Checkout?', priority: 80 }]
        : []),
      {
        id: 'fd-luggage',
        text: 'Gepäck: Hotel lassen, Spot, oder mitnehmen?',
        priority: 70,
      },
      ...(gapMinutes >= 45
        ? [
            {
              id: 'fd-gap',
              text: 'Zeitlücke nach Checkout — was machen?',
              priority: 65,
            },
          ]
        : []),
    ],
    facts: [
      { key: 'flug_abflug', value: departureLabel },
      { key: 'flug_leave_by', value: formatClock(leaveByMs) },
      { key: 'flug_puffer_min', value: String(arriveEarlyMin) },
      ...(airport ? [{ key: 'flugplatz', value: airport.name }] : []),
      ...(withCheckedLuggage
        ? [{ key: 'flug_gepaeck_aufgabe', value: 'ja' }]
        : []),
      ...(checkoutLabel
        ? [{ key: 'hotel_checkout', value: checkoutLabel }]
        : []),
      ...(breakfastUntil
        ? [{ key: 'hotel_breakfast_until', value: breakfastUntil }]
        : []),
    ],
    topicSummary: `Flug ${departureLabel} — Leave-by ${formatClock(leaveByMs)} · Puffer ${arriveEarlyMin} Min`,
    anticipatedFollowUps: [
      'Mehr Puffer?',
      'Weniger Puffer?',
      'Route zum Flugplatz?',
      'Gepäck wohin?',
      'Was in der Zeitlücke?',
    ],
    sourceTurn: userText,
  });

  // Reminder 30 Min vor Leave-by (Push) + progressive Insider-Trigger
  if (remindAtMs > Date.now() + 20_000) {
    void scheduleFlightDepartureReminder({
      departureMs,
      walkEtaMinutes: walkMinutes + arriveEarlyMin,
      flightLabel: `Flug ${departureLabel}`,
      safetyBufferMin: 9,
      reminderKey: `flight-day-${departureMs}`,
    });
  }
  registerDepartureWatch({
    eventId: `flight-day-${departureMs}`,
    title: `Flug ${departureLabel}`,
    departureMs,
    walkEtaMin: walkMinutes,
    mode: 'flight',
    stationName: airport?.name ?? null,
    delayMin: 0,
    externalId: `flight-day-${departureMs}`,
    detail: `Leave-by ${formatClock(leaveByMs)} · Puffer ${arriveEarlyMin} Min`,
    scheduleOsPush: false,
  });

  const quickActions: QuickAction[] = [
    {
      type: 'SET_DEPARTURE_REMINDER',
      label: `⏰ Erinnerung ${formatClock(leaveByMs)}`,
      payload: {
        dateIso: new Date(leaveByMs).toISOString(),
        destName: airport?.name ?? 'Flugplatz',
        textPrompt: `Erinnerung: um ${formatClock(leaveByMs)} zum Flugplatz losgehen`,
      },
    },
  ];

  if (!islandMode) {
    quickActions.push({
      type: 'SHOW_MORE',
      label: withCheckedLuggage ? '⏱ 90 Min ok' : '⏱ 70 Min ok',
      payload: {
        textPrompt: withCheckedLuggage
          ? `Puffer ${arriveEarlyMin} Minuten passt — mit Gepäckabgabe`
          : `Puffer ${arriveEarlyMin} Minuten passt so`,
      },
    });
    quickActions.push({
      type: 'SHOW_MORE',
      label: '⏱ Mehr Puffer',
      payload: {
        textPrompt: withCheckedLuggage
          ? 'Ich brauche mehr Puffer als 90 Minuten am Flughafen — bitte neu rechnen'
          : 'Ich brauche mehr Puffer — und ich gebe Gepäck ab, also eher 90 Minuten oder mehr',
      },
    });
    quickActions.push({
      type: 'SHOW_MORE',
      label: '⏱ Weniger Puffer',
      payload: {
        textPrompt:
          'Ich brauche weniger Puffer am Flughafen — bitte neu rechnen und Leave-by anpassen',
      },
    });
  } else {
    quickActions.push({
      type: 'SHOW_MORE',
      label: '⏱ Mehr Puffer',
      payload: {
        textPrompt:
          'Für den Insel-Flugplatz brauche ich mehr als 15 Minuten Puffer — bitte neu rechnen',
      },
    });
  }

  if (airport && quickActions.length < 4) {
    quickActions.push({
      type: 'START_NAVIGATION',
      label: `📍 Route ${airport.name}`,
      payload: {
        destLat: airport.lat,
        destLng: airport.lng,
        destName: airport.name,
        targetPoiId: airport.poiId ?? undefined,
      },
    });
  }

  if (bounceOk && quickActions.length < 4) {
    const bounce = buildBounceLuggageAction();
    if (bounce) quickActions.push(bounce);
  } else if (!bounceOk && quickActions.length < 4) {
    quickActions.push({
      type: 'SHOW_MORE',
      label: '🧳 Gepäck im Hotel lassen',
      payload: {
        textPrompt:
          'Ich möchte mein Gepäck im Hotel lassen — passt das zum Checkout und Leave-by?',
      },
    });
  }

  if (gapMinutes >= 45 && quickActions.length < 4) {
    quickActions.push({
      type: 'SHOW_MORE',
      label: '🌊 Zeitlücke füllen',
      payload: {
        textPrompt:
          'Ich habe nach dem Checkout noch Zeit bis zum Flug — was empfiehlst du in der Nähe (Strand, Sehenswürdigkeit)?',
      },
    });
  }

  const speechParts: string[] = [];
  speechParts.push(`Alles klar — Flug um ${departureLabel} Uhr habe ich notiert.`);
  if (checkoutLabel && hotel?.name) {
    speechParts.push(
      `Um ${checkoutLabel} Uhr musst du aus ${hotel.name} auschecken.`,
    );
  } else if (hotel?.name) {
    speechParts.push(
      `Bei ${hotel.name} gucke ich den Checkout noch nach — weißt du ihn schon?`,
    );
  } else {
    speechParts.push('In welchem Hotel bist du gerade — dann rechne ich Checkout und Weg mit.');
  }
  if (breakfastUntil) {
    speechParts.push(`Frühstück geht noch bis ${breakfastUntil} Uhr.`);
  }
  if (gapMinutes >= 45) {
    speechParts.push(
      `Dazwischen hast du grob ${Math.round(gapMinutes / 60)} Stunden — Strand, oder noch einen Ort, den du nicht gesehen hast?`,
    );
  }
  const voucher = useOpenQuestionStore
    .getState()
    .userFacts.find((f) => f.key === 'verzehrgutschein')?.value;
  if (voucher) {
    speechParts.push(
      'Und denk an deinen Verzehrgutschein — vor dem Losgehen oder am Flugplatz noch einlösen.',
    );
  }
  speechParts.push(
    footOnly
      ? `Gepäck: im Hotel lassen oder mitnehmen — Partner-Spots gibt's hier nicht. Zum Flugplatz nur zu Fuß.`
      : `Gepäck: Hotel lassen, Spot buchen, oder mitnehmen — was passt dir?`,
  );
  speechParts.push(
    `Spätestens um ${formatClock(leaveByMs)} Uhr vom ${hotel?.name ? 'Hotel' : 'Standort'} los — Fußweg ca. ${walkMinutes} Min, plus ${arriveEarlyMin} Min Puffer am ${islandMode ? 'Flugplatz' : 'Flughafen'}.`,
  );
  if (bufferAssess.askUserSpeech) {
    speechParts.push(bufferAssess.askUserSpeech);
  }
  speechParts.push('Ich erinnere dich eine halbe Stunde vor dem Losgehen.');

  const bullets = [
    `Flug ${departureLabel}`,
    `Los spätestens ${formatClock(leaveByMs)}`,
    `Puffer ${arriveEarlyMin} Min${withCheckedLuggage && !islandMode ? ' (Gepäck)' : ''}`,
    checkoutLabel ? `Checkout ${checkoutLabel}` : null,
    breakfastUntil ? `Frühstück bis ${breakfastUntil}` : null,
    voucher ? 'Verzehrgutschein' : null,
    airport ? airport.name : null,
  ].filter(Boolean) as string[];

  return {
    plan,
    response: {
      speechText: speechParts.join(' '),
      visualBullets: bullets.slice(0, 3),
      quickActions: quickActions.slice(0, 4),
      cardTitle: 'Flug-Tag',
    },
  };
}
