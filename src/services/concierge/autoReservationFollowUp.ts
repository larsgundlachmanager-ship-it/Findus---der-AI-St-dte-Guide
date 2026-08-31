import { buildFindusSystemPrompt } from '../../constants/prompts';
import { getFactsForPoi, getPoiWithFacts } from '../../db/database';
import { isDeviceOffline } from '../navigation/networkState';
import { resolvePersonaEngine } from '../personaEngine';
import {
  buildPoiReservationInfo,
  buildReservationPromptBlock,
  describeReservationOffer,
} from '../reservation/reservationService';
import { getCachedUserProfile } from '../userProfileService';
import { askGeminiConciergeResponse } from '../geminiService';
import {
  CONCIERGE_JSON_INSTRUCTION,
  wrapPlainAsConcierge,
} from './parseConciergeResponse';
import { presentConciergeResponse } from './presentConcierge';
import {
  buildReservationQuickActions,
  evaluateReservationIntel,
} from '../../runtime/reservationIntel';
import type { GeminiConciergeResponse, QuickAction } from '../../types/concierge';

function defaultPartySize(): number {
  const profile = getCachedUserProfile();
  const travelParty = profile?.travelParty ?? resolvePersonaEngine(profile).travelParty;
  switch (travelParty) {
    case 'solo':
      return 1;
    case 'couple':
    case 'date':
      return 2;
    case 'family':
    case 'friends':
      return 4;
    default:
      return 2;
  }
}

function defaultTimeLabel(): string {
  const now = new Date();
  const h = now.getHours();
  if (h < 12) return 'heute Mittag';
  if (h < 17) return 'heute Abend';
  return 'heute gegen 19 Uhr';
}

function selectionChips(poiName: string, partySize: number, timeLabel: string): QuickAction[] {
  return [
    {
      type: 'SHOW_MORE',
      label: 'Andere Uhrzeit',
      payload: {
        textPrompt: `Andere Uhrzeit für Tisch bei ${poiName}, aktuell ${timeLabel}`,
      },
    },
    {
      type: 'SHOW_MORE',
      label: 'Neuer Termin',
      payload: {
        textPrompt: `Neuer Termin bei ${poiName} eintragen, ${partySize} Personen`,
      },
    },
    {
      type: 'SHOW_MORE',
      label: 'Später',
      payload: { textPrompt: 'Reservierung später' },
    },
  ];
}

function mergeReservationActions(
  primary: QuickAction[],
  chips: QuickAction[],
): QuickAction[] {
  const out: QuickAction[] = [];
  const seen = new Set<string>();
  for (const a of [...primary, ...chips]) {
    const key = `${a.type}|${a.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.slice(0, 4);
}

function labelReserveActions(actions: QuickAction[]): QuickAction[] {
  return actions.map((a) => {
    if (a.type === 'CONFIRM_API_RESERVATION') {
      return { ...a, label: '🍽 Tisch reservieren' };
    }
    if (a.type === 'SEND_RESERVATION_EMAIL') {
      return { ...a, label: '🍽 Tisch anfragen' };
    }
    if (a.type === 'TRIGGER_AI_CALL') {
      return { ...a, label: '📞 KI-Anruf' };
    }
    if (a.type === 'DIAL_PHONE') {
      return { ...a, label: '📞 Anrufen' };
    }
    return a;
  });
}

async function buildOfflineReservationResponse(
  poiId: number,
): Promise<GeminiConciergeResponse | null> {
  const poi = await getPoiWithFacts(poiId);
  if (!poi) return null;
  const facts = (await getFactsForPoi(poiId)).map((f) => f.fact_text);
  const info = buildPoiReservationInfo(poi, facts);
  const profile = getCachedUserProfile();
  const offer = describeReservationOffer(info, profile);
  const partySize = defaultPartySize();
  const timeLabel = defaultTimeLabel();
  const intel = await evaluateReservationIntel(poi, '');
  const primary = labelReserveActions(
    buildReservationQuickActions(intel, profile, {
      lat: poi.lat,
      lng: poi.lng,
    }).filter((a) => a.type !== 'START_NAVIGATION'),
  );
  const speech =
    `Leider habe ich aktuell kein Netz. Offline schon klar: ${offer.speechHint} ` +
    `Tisch für ${partySize} Personen ${timeLabel} — tipp zum Anfragen, oder wähl eine Alternative.`;

  return wrapPlainAsConcierge(speech, {
    cardTitle: `Reservierung · ${info.name}`,
    visualBullets: [
      `${info.name}`,
      `${partySize} Personen · ${timeLabel}`,
      info.phoneNumber
        ? `Telefon da: ${info.phoneNumber}`
        : info.reservationEmail
          ? `E-Mail da: ${info.reservationEmail}`
          : 'Buchungsweg lokal vorbereitet',
    ],
    quickActions: mergeReservationActions(
      primary,
      selectionChips(info.name, partySize, timeLabel),
    ),
  });
}

export async function presentAutoReservationFollowUp(
  poiId: number,
): Promise<void> {
  const offline = await isDeviceOffline();
  if (offline) {
    const fallback = await buildOfflineReservationResponse(poiId);
    if (fallback) {
      await presentConciergeResponse(fallback);
    }
    return;
  }

  const poi = await getPoiWithFacts(poiId);
  if (!poi) return;
  const facts = (await getFactsForPoi(poiId)).map((f) => f.fact_text);
  const info = buildPoiReservationInfo(poi, facts);
  const profile = getCachedUserProfile();
  const partySize = defaultPartySize();
  const timeLabel = defaultTimeLabel();
  const intel = await evaluateReservationIntel(poi, '');
  const primary = labelReserveActions(
    buildReservationQuickActions(intel, profile, {
      lat: poi.lat,
      lng: poi.lng,
    }).filter((a) => a.type !== 'START_NAVIGATION'),
  );
  const chips = selectionChips(info.name, partySize, timeLabel);
  const forcedActions = mergeReservationActions(primary, chips);

  const systemInstruction = [
    buildFindusSystemPrompt(),
    buildReservationPromptBlock(info, profile),
    CONCIERGE_JSON_INSTRUCTION,
    `Der User hat dieses Restaurant gerade ausgewählt und die Route läuft.
Frage JETZT, ob ein Tisch reserviert werden soll — think-ahead, Wortlaut frei:
- Kurze Frage, ob reservieren.
- Wenn die aktuelle Ankunft (ÖPNV/Fahrt) belegt ist: als Vorschlag nennen (z. B. Ankunftszeit) UND alternativ heute Abend.
- Danach Personenanzahl / Uhrzeit nur wenn der User ja sagt — Defaults ${partySize} Personen, ${timeLabel} bereithalten.
- KEINE Behauptung der Tisch sei schon gebucht.
- quickActions: Tisch reservieren plus SHOW_MORE „Andere Uhrzeit“, „Neuer Termin“, „Später“.
Kein START_NAVIGATION in diesem Turn.`,
  ].join('\n\n');

  const raw = await askGeminiConciergeResponse(
    [
      {
        role: 'system',
        content: systemInstruction,
      },
      {
        role: 'user',
        content: `Das Restaurant ${info.name} ist ausgewählt. Was ist jetzt der beste nächste Schritt?`,
      },
    ],
    { maxTokens: 600 },
  );

  const fallbackSpeech = `Soll ich bei ${info.name} einen Tisch reservieren? Für ${partySize} Personen ${timeLabel} — oder lieber heute Abend?`;

  let response: GeminiConciergeResponse =
    raw && raw.speechText.trim()
      ? raw
      : wrapPlainAsConcierge(fallbackSpeech, {
          cardTitle: `Reservierung · ${info.name}`,
          visualBullets: [`${partySize} Personen · ${timeLabel}`],
        });

  // Permission-Fragen nicht mehr rausstrippen — Reservierung darf fragen.
  response = {
    ...response,
    speechText: response.speechText.trim() || fallbackSpeech,
    cardTitle: response.cardTitle || `Reservierung · ${info.name}`,
    visualBullets:
      response.visualBullets.length > 0
        ? response.visualBullets
        : [`${partySize} Personen · ${timeLabel}`],
    quickActions: mergeReservationActions(
      labelReserveActions(response.quickActions),
      forcedActions,
    ),
  };

  await presentConciergeResponse(response);
}


/** Nach Gastro-Wahl ohne Pack-POI: Reservierung fragen + Ankunft vorschlagen. */
export async function presentPlaceReservationAsk(opts: {
  name: string;
  lat?: number;
  lng?: number;
}): Promise<void> {
  const name = String(opts.name || "").trim();
  if (!name) return;
  const partySize = defaultPartySize();
  let arrivalHint = "";
  try {
    const { useFinnusStore } = require("../../store/useFinnusStore") as {
      useFinnusStore: {
        getState: () => { navEtaMin: number | null };
      };
    };
    const eta = useFinnusStore.getState().navEtaMin;
    if (typeof eta === "number" && eta > 0) {
      const at = new Date(Date.now() + eta * 60_000);
      arrivalHint = at.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  } catch {
    /* soft */
  }
  const timeLabel = arrivalHint
    ? "ca. " + arrivalHint + " (Ankunft)"
    : defaultTimeLabel();
  const speech = arrivalHint
    ? "Soll ich bei " + name + " einen Tisch reservieren? Mit der Verbindung wärst du so gegen " + arrivalHint + " da — passt das, oder lieber heute Abend?"
    : "Soll ich bei " + name + " einen Tisch reservieren? Sag wann und für wie viele — oder heute Abend.";
  const chips: QuickAction[] = [
    {
      type: "SHOW_MORE",
      label: "🍽 Tisch reservieren",
      payload: {
        textPrompt: "Tisch reservieren bei " + name + " für " + partySize + " Personen " + timeLabel,
      },
    },
    {
      type: "SHOW_MORE",
      label: "Heute Abend",
      payload: {
        textPrompt: "Tisch reservieren bei " + name + " heute Abend für " + partySize + " Personen",
      },
    },
    {
      type: "SHOW_MORE",
      label: "Nein danke",
      payload: { textPrompt: "Keine Tischreservierung" },
    },
  ];
  await presentConciergeResponse(
    wrapPlainAsConcierge(speech, {
      cardTitle: "Reservierung · " + name,
      visualBullets: [partySize + " Personen · " + timeLabel],
      quickActions: chips,
    }),
  );
}
