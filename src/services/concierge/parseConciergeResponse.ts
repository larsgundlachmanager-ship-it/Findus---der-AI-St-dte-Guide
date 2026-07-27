/**
 * Parse & Normalisierung strukturierter Concierge-JSON-Antworten.
 */

import type {
  GeminiConciergeResponse,
  QuickAction,
  QuickActionType,
} from '../../types/concierge';

const ACTION_TYPES = new Set<QuickActionType>([
  'START_NAVIGATION',
  'DIAL_PHONE',
  'OPEN_URL',
  'SHOW_MORE',
  'CONFIRM_API_RESERVATION',
  'SEND_RESERVATION_EMAIL',
  'TRIGGER_AI_CALL',
  'OPEN_GYG_WIDGET',
  'BOOK_UBER',
  'BOOK_CAR_RENTAL',
  'BOOK_BOUNCE_LUGGAGE',
  'BOOK_STAY22',
]);

function stripCodeFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return s.trim();
}

function extractJsonObject(raw: string): unknown | null {
  const cleaned = stripCodeFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeAction(raw: unknown): QuickAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const typeRaw = String(o.type ?? '').toUpperCase().replace(/\s+/g, '_');
  let type = typeRaw as QuickActionType;
  if (typeRaw === 'NAVIGATION' || typeRaw === 'NAV' || typeRaw === 'COMPASS') {
    type = 'START_NAVIGATION';
  }
  if (typeRaw === 'PHONE' || typeRaw === 'CALL' || typeRaw === 'TEL') {
    type = 'DIAL_PHONE';
  }
  if (typeRaw === 'URL' || typeRaw === 'LINK' || typeRaw === 'WEB') {
    type = 'OPEN_URL';
  }
  if (
    typeRaw === 'RESERVE' ||
    typeRaw === 'API_RESERVATION' ||
    typeRaw === 'BOOK'
  ) {
    type = 'CONFIRM_API_RESERVATION';
  }
  if (typeRaw === 'EMAIL' || typeRaw === 'RESERVATION_EMAIL') {
    type = 'SEND_RESERVATION_EMAIL';
  }
  if (typeRaw === 'AI_CALL' || typeRaw === 'VOICE_CALL' || typeRaw === 'CALL_AI') {
    type = 'TRIGGER_AI_CALL';
  }
  if (
    typeRaw === 'GYG' ||
    typeRaw === 'GETYOURGUIDE' ||
    typeRaw === 'GYG_WIDGET' ||
    typeRaw === 'TICKETS'
  ) {
    type = 'OPEN_GYG_WIDGET';
  }
  if (
    typeRaw === 'UBER' ||
    typeRaw === 'BOOK_UBER' ||
    typeRaw === 'RIDE_UBER' ||
    typeRaw === 'UBER_RIDE'
  ) {
    type = 'BOOK_UBER';
  }
  if (
    typeRaw === 'CAR_RENTAL' ||
    typeRaw === 'BOOK_CAR_RENTAL' ||
    typeRaw === 'MIETWAGEN' ||
    typeRaw === 'RENT_CAR' ||
    typeRaw === 'ECONOMY_BOOKINGS'
  ) {
    type = 'BOOK_CAR_RENTAL';
  }
  if (
    typeRaw === 'BOUNCE' ||
    typeRaw === 'BOOK_BOUNCE_LUGGAGE' ||
    typeRaw === 'LUGGAGE' ||
    typeRaw === 'GEPAECK' ||
    typeRaw === 'GEPÄCK' ||
    typeRaw === 'LUGGAGE_STORAGE'
  ) {
    type = 'BOOK_BOUNCE_LUGGAGE';
  }
  if (
    typeRaw === 'STAY22' ||
    typeRaw === 'BOOK_STAY22' ||
    typeRaw === 'ACCOMMODATION' ||
    typeRaw === 'HOTEL' ||
    typeRaw === 'UNTERKUNFT' ||
    typeRaw === 'FERIENWOHNUNG'
  ) {
    type = 'BOOK_STAY22';
  }
  if (!ACTION_TYPES.has(type)) return null;

  const label = String(o.label ?? '').trim();
  if (!label) return null;

  const payloadRaw =
    o.payload && typeof o.payload === 'object'
      ? (o.payload as Record<string, unknown>)
      : o;

  const payload = {
    targetPoiId:
      payloadRaw.targetPoiId != null
        ? (payloadRaw.targetPoiId as string | number)
        : payloadRaw.poiId != null
          ? (payloadRaw.poiId as string | number)
          : undefined,
    phoneNumber:
      payloadRaw.phoneNumber != null
        ? String(payloadRaw.phoneNumber)
        : payloadRaw.phone != null
          ? String(payloadRaw.phone)
          : undefined,
    url: payloadRaw.url != null ? String(payloadRaw.url) : undefined,
    textPrompt:
      payloadRaw.textPrompt != null
        ? String(payloadRaw.textPrompt)
        : undefined,
    partySize:
      payloadRaw.partySize != null
        ? Number(payloadRaw.partySize)
        : undefined,
    timeLabel:
      payloadRaw.timeLabel != null
        ? String(payloadRaw.timeLabel)
        : undefined,
    dateIso:
      payloadRaw.dateIso != null ? String(payloadRaw.dateIso) : undefined,
    gygTourSlug:
      payloadRaw.gygTourSlug != null
        ? String(payloadRaw.gygTourSlug)
        : payloadRaw.tourSlug != null
          ? String(payloadRaw.tourSlug)
          : undefined,
    gygLocationId:
      payloadRaw.gygLocationId != null
        ? String(payloadRaw.gygLocationId)
        : payloadRaw.locationId != null
          ? String(payloadRaw.locationId)
          : undefined,
    destLat:
      payloadRaw.destLat != null
        ? Number(payloadRaw.destLat)
        : payloadRaw.latitude != null
          ? Number(payloadRaw.latitude)
          : undefined,
    destLng:
      payloadRaw.destLng != null
        ? Number(payloadRaw.destLng)
        : payloadRaw.longitude != null
          ? Number(payloadRaw.longitude)
          : undefined,
    destName:
      payloadRaw.destName != null
        ? String(payloadRaw.destName)
        : payloadRaw.nickname != null
          ? String(payloadRaw.nickname)
          : undefined,
    destination:
      payloadRaw.destination != null
        ? String(payloadRaw.destination)
        : payloadRaw.address != null
          ? String(payloadRaw.address)
          : payloadRaw.city != null
            ? String(payloadRaw.city)
            : undefined,
  };

  return { type, label, payload };
}

export function parseConciergeResponse(
  raw: string,
): GeminiConciergeResponse | null {
  const data = extractJsonObject(raw);
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;

  const speechText = String(
    o.speechText ?? o.speech_text ?? o.text ?? '',
  ).trim();
  if (!speechText) return null;

  const bulletsRaw = o.visualBullets ?? o.visual_bullets ?? o.bullets;
  const visualBullets = clampVisualBullets(
    Array.isArray(bulletsRaw)
      ? bulletsRaw.map((b) => String(b).trim())
      : [],
  );

  const actionsRaw = o.quickActions ?? o.quick_actions ?? o.actions;
  const quickActions: QuickAction[] = [];
  if (Array.isArray(actionsRaw)) {
    for (const a of actionsRaw) {
      const n = normalizeAction(a);
      if (n) quickActions.push(n);
    }
  }

  const cardTitle =
    o.cardTitle != null
      ? String(o.cardTitle).trim()
      : o.card_title != null
        ? String(o.card_title).trim()
        : undefined;

  return {
    speechText,
    visualBullets,
    quickActions: quickActions.slice(0, 8),
    cardTitle: cardTitle || undefined,
  };
}

/** Maximal 3 Spickzettel-Stichpunkte — 1 reicht, wenn sonst nichts Sinnvolles da ist. */
export const MAX_VISUAL_BULLETS = 3;

export function clampVisualBullets(bullets: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of bullets) {
    const b = String(raw ?? '').trim();
    if (!b) continue;
    const key = b.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (out.length >= MAX_VISUAL_BULLETS) break;
  }
  return out;
}

/** Plain-Text-Fallback → minimale Struktur (Audio-first). */
export function wrapPlainAsConcierge(
  speechText: string,
  extras?: Partial<GeminiConciergeResponse>,
): GeminiConciergeResponse {
  return {
    speechText: speechText.trim(),
    visualBullets: clampVisualBullets(extras?.visualBullets ?? []),
    quickActions: extras?.quickActions ?? [],
    cardTitle: extras?.cardTitle,
  };
}

export const CONCIERGE_JSON_INSTRUCTION = `
=== STRUKTURIERTE ANTWORT (PFLICHT — NUR JSON) ===
Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt (kein Markdown, keine Code-Fences):
{
  "speechText": "Gesprochener Text für Findus — Kumpelton, präzise, hilfsbereit. Das ist der EINZIGE Text für die Stimme.",
  "cardTitle": "Kurzer Kartentitel (optional)",
  "visualBullets": ["optionaler Stichpunkt"],
  "quickActions": [
    {
      "type": "START_NAVIGATION" | "DIAL_PHONE" | "OPEN_URL" | "SHOW_MORE" | "OPEN_GYG_WIDGET" | "BOOK_UBER" | "BOOK_CAR_RENTAL" | "BOOK_BOUNCE_LUGGAGE" | "BOOK_STAY22" | "CONFIRM_API_RESERVATION" | "SEND_RESERVATION_EMAIL" | "TRIGGER_AI_CALL",
      "label": "Kurzes Button-Label mit Emoji ok",
      "payload": {
        "targetPoiId": "spot_key oder numerische id wenn bekannt",
        "phoneNumber": "+49…",
        "url": "https://…",
        "textPrompt": "für SHOW_MORE",
        "destLat": 53.55,
        "destLng": 9.99,
        "destName": "Zielname für Uber",
        "destination": "Stadt für Stay22 Unterkunft"
      }
    }
  ]
}

Regeln:
- speechText: natürlich zum Vorlesen, 2–5 Sätze. Keine Bullet-Listen im speechText.
- NIEMALS Versprecher, Tippfehler oder STT-Fehler des Users korrigieren oder kommentieren — einfach verstehen und antworten.
- visualBullets: 0–3 knackige Spickzettel-Zeilen (Zahlen, Zeiten, Highlights) — Display only. Oft reicht 1; nur mehr, wenn es wirklich hilft; nie Auffüllen.
- quickActions: passende Sofort-Aktionen. Max 8; App priorisiert Navigation > Intent-Partner > Uber.
- Keine Fake-Tour-Slugs. Unbekannt → Stadt als Suchbegriff; App baut GYG/Musement/Viator-Suche.
- MONETARISIERUNG: Bei allgemeinen Fragen erst höflich nachfragen, ob Buchungsoptionen gewünscht sind — keine ungefragten Partner-Buttons.
  Bei klarem Wunsch (Hotel, Tour, Gepäck, Mietwagen): sofort Action + Partner natürlich in einem Satz nennen.
- START_NAVIGATION: targetPoiId aus Concierge-/Transit-Kontext wenn vorhanden (numerische id oder spot_key).
- DIAL_PHONE: echte Nummern aus Fakten/Kontext.
- OPEN_URL: z. B. Slot & Fly, Speisekarte, GetYourGuide-Tour (partner_id=ZVQGONB), Musement-Ticket (aid/client_id=findus-8445) oder Viator (pid=P00311883&mcid=42383&medium=link).
- OPEN_GYG_WIDGET: In-App Verfügbarkeit — payload.gygTourSlug oder gygLocationId.
- GetYourGuide-Links IMMER als https://www.getyourguide.com/[TOUR_SLUG]/?partner_id=ZVQGONB&cmp=findus_app
- Musement-Links: volle Activity-URL — App setzt aid=findus-8445 & client_id=findus-8445. Museen/Ausstellungen → Musement bevorzugen.
- Viator-Links: volle Tour-URL — App setzt pid=P00311883&mcid=42383&medium=link. Weltweite Touren & VIP-Erlebnisse → Viator zusätzlich/bevorzugt anbieten.
- BOOK_UBER: bei Restaurant-/Sehenswürdigkeit-/Tour-Empfehlungen „Fahrt mit Uber buchen“ / „🚗 Uber dorthin“ — payload destLat, destLng, destName (oder targetPoiId). Zusätzlich zur Fuß-Navigation.
- BOOK_CAR_RENTAL: bei Reiseanfragen, Flughafen-Anreise, Streckenplanung oder wenn ein Mietwagen sinnvoll ist — Label „🚗 Mietwagen buchen“. URL setzt die App (Economy Bookings Referral).
- BOOK_BOUNCE_LUGGAGE: bei Gepäckaufbewahrung, Früheinchecken, Spätabflug oder kofferfreier Tour — Label „🧳 Gepäck-Spot buchen“. URL setzt die App (Bounce Affiliate).
- BOOK_STAY22: bei Hotels/Übernachtung — Label „🏨 Mehr Unterkünfte“, payload.destination = Zielstadt. Zuerst konkrete lokale Namen aus dem Unterkunft-Kontext nennen.
- CONFIRM_API_RESERVATION / SEND_RESERVATION_EMAIL / TRIGGER_AI_CALL: nur nach User-Ja; payload mit partySize + timeLabel + targetPoiId.
- Erfinde keine Fake-Nummern/URLs. Wenn unbekannt: Action weglassen.
- WICHTIG NAVIGATION: Wenn speechText sagt, dass du den Kompass anmachst / hinsführst / führst — dann MUSS quickActions eine START_NAVIGATION mit gültigem targetPoiId enthalten. Die App startet Navigation + Landmarken-Anweisungen parallel zur Stimme.
- Wenn du nur ANBIETEST („Soll ich den Kompass anmachen?“) → keine Zusicherung im speechText, nur Button.
- RESERVIERUNG: Nie „Tisch ist gebucht“ ohne Button-Bestätigung. Stufe wählen laut Reservierungs-Block (API → E-Mail → KI-Anruf → tel:).
`.trim();
