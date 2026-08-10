/**
 * Parse & Normalisierung strukturierter Concierge-JSON-Antworten.
 */

import type {
  GeminiConciergeResponse,
  QuickAction,
  QuickActionPayload,
  QuickActionType,
} from '../../types/concierge';
import {
  FINDUS_ANSWER_FIRST_BLOCK,
  FINDUS_BRIDGE_CONTINUITY_BLOCK,
  FINDUS_COMPOUND_PLAN_BLOCK,
  FINDUS_FACTUAL_ANSWER_BLOCK,
  FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
  FINDUS_JUST_DO_IT_BLOCK,
} from './findusResponsePolicy';
import { getEsimAffiliateUrl } from '../affiliate/affiliateService';
import { parseBackgroundTasks } from './backgroundTasks';
import {
  filterAddressCoordBullets,
  looksLikeAddressOrCoordBullet,
} from '../../utils/addressPrivacy';
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
  'BOOK_ESIM',
  'COMPLETE_SHOPPING_TASK',
  'SNOOZE_SHOPPING_TASK',
  'SET_WAKE_ALARM',
  'SET_TIMER',
  'SET_DEPARTURE_REMINDER',
  'SHOW_STREET_VIEW',
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
  if (
    typeRaw === 'ESIM' ||
    typeRaw === 'BOOK_ESIM' ||
    typeRaw === 'AIRALO'
  ) {
    type = 'BOOK_ESIM';
  }
  if (!ACTION_TYPES.has(type)) return null;

  const label = String(o.label ?? '').trim();
  if (!label) return null;

  const payloadRaw =
    o.payload && typeof o.payload === 'object'
      ? (o.payload as Record<string, unknown>)
      : o;

  const payload: QuickActionPayload = {
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
    taskId:
      payloadRaw.taskId != null ? String(payloadRaw.taskId) : undefined,
    placeId:
      payloadRaw.placeId != null ? String(payloadRaw.placeId) : undefined,
    offlineOnly:
      payloadRaw.offlineOnly != null
        ? Boolean(payloadRaw.offlineOnly)
        : undefined,
    autoFollowUp:
      payloadRaw.autoFollowUp === 'reservation' ? 'reservation' : undefined,
  };

  return { type, label, payload };
}

function dropDeadAffiliateAction(action: QuickAction): QuickAction | null {
  // Nie tote Partner-Buttons: BOOK_ESIM braucht echte URL
  if (action.type === 'BOOK_ESIM') {
    const url = (action.payload.url ?? '').trim();
    if (url) return action;
    const resolved = getEsimAffiliateUrl();
    if (!resolved) return null;
    return {
      ...action,
      payload: { ...action.payload, url: resolved },
    };
  }
  return action;
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
      if (!n) continue;
      const kept = dropDeadAffiliateAction(n);
      if (kept) quickActions.push(kept);
    }
  }

  const cardTitle =
    o.cardTitle != null
      ? String(o.cardTitle).trim()
      : o.card_title != null
        ? String(o.card_title).trim()
        : undefined;

  const backgroundTasks = parseBackgroundTasks(
    o.backgroundTasks ?? o.background_tasks ?? o.backgroundTask,
  );

  return {
    speechText,
    visualBullets,
    quickActions: quickActions.slice(0, 4),
    cardTitle: cardTitle || undefined,
    backgroundTasks: backgroundTasks.length ? backgroundTasks : undefined,
  };
}

/** Maximal 3 Spickzettel-Stichpunkte. */
export const MAX_VISUAL_BULLETS = 3;

/** Surface: Fallback-Cap vor Layout-Messung (UI misst echter). */
export type BulletSurface = 'default' | 'module1' | 'pitch' | 'nav';

export const BULLET_SURFACE_MAX_CHARS: Record<BulletSurface, number> = {
  /** Konservativ bis onLayout — echte Breite überschreibt in BulletsSlot */
  default: 72,
  module1: 72,
  nav: 64,
  /** Zwei Spalten nebeneinander — eng */
  pitch: 40,
};

/** @deprecated — nutze BULLET_SURFACE_MAX_CHARS.default */
export const MAX_BULLET_CHARS = BULLET_SURFACE_MAX_CHARS.default;

const BULLET_FLUFF_RE =
  /\b(wurde|worden|hat man|man hat|damals|nämlich|eigentlich|richtig|sehr|besonders|bereits|schon|dann|dort|hier)\b/giu;

function scoreBulletImportance(b: string): number {
  let s = 0;
  if (/\d/.test(b)) s += 8; // Zahlen/Preise/Zeiten zuerst
  if (/[€$]|euro|min\b|km\b|m\b|uhr|%|stunde/i.test(b)) s += 4;
  if (b.length <= 56) s += 2;
  if (b.length > 120) s -= 3;
  return s;
}

/** Max. Zeichen aus gemessener UI-Breite (Schriftgröße / 2 Zeilen). */
export function estimateBulletMaxChars(opts: {
  widthPx: number;
  fontSize?: number;
  lines?: number;
  bulletPrefixPx?: number;
}): number {
  const fontSize = opts.fontSize ?? 14;
  const lines = opts.lines ?? 2;
  const prefix = opts.bulletPrefixPx ?? 16;
  const usable = Math.max(48, opts.widthPx - prefix);
  // DE-Durchschnitt ~0.55em; enger = sicherer (keine UI-Ellipse)
  const perLine = Math.max(18, Math.floor(usable / (fontSize * 0.58)));
  return Math.max(22, perLine * lines);
}

function compressPhrase(s: string, max: number): string {
  const limit = Math.max(12, Math.floor(max));
  let t = s
    .replace(BULLET_FLUFF_RE, ' ')
    .replace(/\b(das|die|der|dem|den|ein|eine|einem|einer|eines)\s+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) t = s.trim();
  if (t.length <= limit) return t;
  const window = t.slice(0, limit + 1);
  const cuts = [' · ', ' — ', ' – ', '; ', ', ', ' / ', ' '];
  for (const c of cuts) {
    const i = window.lastIndexOf(c);
    if (i >= Math.floor(limit * 0.4)) {
      return window.slice(0, i).trim();
    }
  }
  const sp = window.lastIndexOf(' ');
  if (sp >= Math.floor(limit * 0.5)) return window.slice(0, sp).trim();
  return t.slice(0, limit).trim();
}

/**
 * Kürzt einen Stichpunkt so, dass er PASST und trotzdem Sinn ergibt.
 * Nie droppen, nie „…“ / Wort-Halbierung als UI-Lösung.
 */
export function rewriteBulletToFit(raw: string, maxChars: number): string {
  const limit = Math.max(18, Math.floor(maxChars));
  let b = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s•\-–—*]+/u, '')
    .replace(/\s*(\.\.\.|…)\s*$/u, '')
    .trim();
  if (!b) return '';
  if (b.length <= limit) return b;

  const year = b.match(/\b((?:1[0-9]{3}|20[0-2]\d))\b/);
  if (year) {
    const rest = b
      .replace(year[0], ' ')
      .replace(BULLET_FLUFF_RE, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s·,\-–—]+|[\s·,\-–—]+$/g, '')
      .trim();
    const budget = limit - year[0].length - 3;
    if (budget >= 8) {
      const core = compressPhrase(rest || b, budget);
      if (core) return `${year[0]} · ${core}`;
    }
  }

  // Zahlen/Preise vorne halten
  const leadNum = b.match(
    /^(.{0,24}?\b\d+[.,]?\d*\s*(?:€|m|km|min|h|%|Pkt|Punkte|Stufen|Uhr)?)/iu,
  );
  if (leadNum && leadNum[1] && leadNum[1].length < limit - 6) {
    const head = leadNum[1].trim();
    const rest = b.slice(head.length).replace(/^[\s·,\-–—]+/, '').trim();
    const core = compressPhrase(rest, limit - head.length - 3);
    if (core) return `${head} · ${core}`;
    return compressPhrase(head, limit);
  }

  return compressPhrase(b, limit) || b.slice(0, limit).trim();
}

/** Leere Labels, TTS-Meta, unfertige Fakten — raus. */
export function isWeakOrMetaBullet(raw: string): boolean {
  const b = String(raw ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!b || b.length < 3) return true;
  if (
    /\b(ausgeschrieben|buchstabier|in worten|als wörter|als worte|ziffern vermeiden)\b/iu.test(
      b,
    )
  ) {
    return true;
  }
  if (/[:：]\s*(\.\.\.|…)?\s*$/u.test(b)) return true;
  if (/\b(höhe|stufen|eintritt|preis|länge|breite|baujahr|öffnungs)\b/iu.test(b) && !/\d/.test(b)) {
    return true;
  }
  if (
    /^(historie|venue-offers|maps-pitch|fakten|live|heute|wissen)\b/iu.test(b) &&
    !/\d/.test(b)
  ) {
    return true;
  }
  if (looksLikeAddressOrCoordBullet(b)) return true;
  return false;
}

export function clampVisualBullets(
  bullets: string[],
  opts?: {
    userText?: string | null;
    allowAddress?: boolean;
    /** UI-Kontext: pitch = enger */
    surface?: BulletSurface;
    /** Nur Fakten aus speechText (keine Halluzination) */
    speechText?: string | null;
  },
): string[] {
  const maxChars =
    BULLET_SURFACE_MAX_CHARS[opts?.surface ?? 'default'] ??
    BULLET_SURFACE_MAX_CHARS.default;
  const speech = (opts?.speechText ?? '').replace(/\s+/g, ' ').trim();
  const speechLc = speech.toLowerCase();

  const cleaned: string[] = [];
  for (const raw of filterAddressCoordBullets(bullets, opts)) {
    let b = String(raw ?? '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s•\-–—*]+/u, '')
      .replace(/\s*(\.\.\.|…)\s*$/u, '')
      .trim();
    if (!b || isWeakOrMetaBullet(b)) continue;
    b = b
      .replace(/\s*ausgeschrieben\b.*$/iu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!b || isWeakOrMetaBullet(b)) continue;
    // Speech-Gate: Stichpunkt muss im Gesagten vorkommen (Zahlen/Tokens)
    if (speechLc.length >= 40) {
      const digits = b.match(/\d+(?:[.,]\d+)?/g) ?? [];
      const tokens = b
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 4);
      const digitOk =
        digits.length === 0 || digits.some((d) => speech.includes(d));
      const tokenOk =
        tokens.length === 0 ||
        tokens.filter((t) => speechLc.includes(t)).length >=
          Math.min(2, tokens.length);
      if (!digitOk || !tokenOk) continue;
    }
    const fitted = rewriteBulletToFit(b, maxChars);
    if (!fitted || isWeakOrMetaBullet(fitted)) continue;
    cleaned.push(fitted);
  }

  cleaned.sort((a, b) => scoreBulletImportance(b) - scoreBulletImportance(a));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of cleaned) {
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
    backgroundTasks: extras?.backgroundTasks,
  };
}

export const CONCIERGE_JSON_INSTRUCTION = `
=== STRUKTURIERTE ANTWORT (PFLICHT — NUR JSON) ===
Antworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt (kein Markdown, keine Code-Fences):
{
  "speechText": "Gesprochener Text für Findus — Kumpelton, präzise, hilfsbereit. Das ist der EINZIGE Text für die Stimme.",
  "cardTitle": "Kurzer Kartentitel (optional)",
  "visualBullets": ["optionaler Stichpunkt"],
  "background_tasks": [
    { "type": "SET_NATIVE_ALARM", "time": "07:30", "label": "Aufstehen" }
  ],
  "quickActions": [
    {
      "type": "START_NAVIGATION" | "DIAL_PHONE" | "OPEN_URL" | "SHOW_MORE" | "OPEN_GYG_WIDGET" | "BOOK_UBER" | "BOOK_CAR_RENTAL" | "BOOK_BOUNCE_LUGGAGE" | "BOOK_STAY22" | "BOOK_ESIM" | "CONFIRM_API_RESERVATION" | "SEND_RESERVATION_EMAIL" | "TRIGGER_AI_CALL" | "SET_WAKE_ALARM" | "SET_TIMER",
      "label": "Kurzes Button-Label mit Emoji ok",
      "payload": {
        "targetPoiId": "spot_key oder numerische id wenn bekannt",
        "phoneNumber": "+49…",
        "url": "https://…",
        "textPrompt": "für SHOW_MORE / Timer aus",
        "dateIso": "ISO-Zeit für Wecker/Timer-Ende",
        "timeLabel": "z. B. 7:00 Uhr oder 10 Min",
        "durationMs": 600000,
        "destLat": 53.55,
        "destLng": 9.99,
        "destName": "Zielname für Uber / Wecker-Label",
        "destination": "Stadt für Stay22 Unterkunft"
      }
    }
  ]
}

Regeln:
- speechText: natürlich zum Vorlesen, 2–5 Sätze. Keine Bullet-Listen im speechText.
- ANTWORT-FIRST: erste 1–2 Sätze = klare Antwort/Zusammenfassung; Tipps/Alternativen erst danach. Kein Vorgeplänkel in speechText (Bridge kam schon).
- Fakten-/Zahlenfragen: DIREKTE Lösung in den ersten Sätzen — Zahl/Regel darf nicht fehlen und nicht erst am Ende auftauchen.
- NIEMALS Versprecher, Tippfehler oder STT-Fehler des Users korrigieren oder kommentieren — einfach verstehen und antworten.
- WECKER (STRENG): Nie nur „Wecker ist gestellt“ im speechText. Bei klarer Uhrzeit IMMER background_tasks mit type SET_NATIVE_ALARM (time "HH:MM", label). Die App ruft den echten Android-Wecker; speechText darf Erfolg erst nach Native-Success. Ohne Task = Lüge.
- PROACTIVE REASONING: Zeitlücken erkennen (Checkout vs. späteres Event/Tennis) → Unterkunft/Transport/Plan im speechText mitdenken und ggf. BOOK_STAY22 / Hotel-Nachfrage anbieten.
- visualBullets = bei Fakten-/Zahlen-/Punkte-/Regel-Fragen PFLICHT (1–3), sonst optional; die App baut Memory-Stichpunkte nach dem Text nach. Je max. 1 kurze Zeile, keine Meta-Chips.
- KEINE Adressen, Hausnummern, PLZ oder GPS/Koordinaten in visualBullets — außer der User fragt explizit danach (dann VOLL: Straße + Nr. + Ort, nicht nur Straßenname).
- Stichpunkte: IMMER Ziffern bei Maßen/Punkten (z. B. „132 m hoch“, „452 Stufen“, „1. Runde · 110 Pkt“) — nie „ausgeschrieben“, nie leere Labels.
- Faktenfragen: Bullet 1 = direkte Lösung; Bullet 2–3 = vorausdenken (nächste belegte Stufe/Runde/Variante) — siehe Policy.
- quickActions: LEER lassen oder nur System (Wecker/Timer). ActionBoard baut Buttons (Route, Speisekarte, Hotel, eSIM…) — erfinde KEINE Labels/URLs. Namen der Orte nur in speechText.
- Bei Geschichte/Historie: visualBullets = 1–3 Fakten MIT Jahreszahl wenn bekannt (z. B. „1844 · Bahnanschluss“), je 1 Zeile, KEINE Meta-Chips wie „Lebendig“ / Ortsname allein.
- Buttons 1:1 zum Text: Wahl → Speisekarte oder 2 Routen; Tour/Kurs/Verleih/Buchungsportal → OPEN_URL wenn URL belegt; Bahnhof → Linien; Geschichte → Folge-Thema.
- ZERO-FAKE: Kein Button „Turnierplan“/„Spielplan“/Ansetzung ohne echte abrufbare URL. Geschlossene Club-/Login-Pläne → ehrlich sagen (schwarzes Brett) + KEIN Button. Keine erfundenen Portal-Partnerschaften (Mietrad o. ä.).
- Bei zwei Ort-Optionen („Welchen nehmen wir?“): GENAU 2× START_NAVIGATION mit denselben Ortsnamen wie im speechText.
- Keine Fake-Tour-Slugs. Unbekannt → Stadt als Suchbegriff; App baut GYG/Musement/Viator-Suche.
- MONETARISIERUNG: siehe HILFE-ZUERST — allgemeine Fragen ohne Logistik-Bedarf: KEINE Partner-Buttons. Kontext-Momente (Flughafen, Checkout-Konflikt, Plan-Lücke, Abend frei): 1 Hilfe-Schritt + 1 Button.
- „Was heute geht“ / Tipps: speechText nennt pro Ort Entfernung, Motto und was dort lohnt — nicht nur den Namen.
- START_NAVIGATION: targetPoiId aus Concierge-/Transit-Kontext wenn vorhanden (numerische id oder spot_key).
- DIAL_PHONE: echte Nummern aus Fakten/Kontext — SOFORT Button „📞 Anrufen“.
- ${FINDUS_JUST_DO_IT_BLOCK}
- ${FINDUS_BRIDGE_CONTINUITY_BLOCK}
- ${FINDUS_ANSWER_FIRST_BLOCK}
- ${FINDUS_FACTUAL_ANSWER_BLOCK}
- ${FINDUS_HELP_FIRST_MONETIZATION_BLOCK}
- ${FINDUS_COMPOUND_PLAN_BLOCK}
- AGI: speechText max 600 Zeichen; keine Adressen/URLs/PLZ/„Deutschland“ unless User fragt; Buttons 1:1 zur Speech; keine ungefragte Navigation.
- OPEN_URL: z. B. Slot & Fly, Speisekarte, GetYourGuide-Tour (partner_id=ZVQGONB), Musement-Ticket (aid/client_id=findus-8445) oder Viator (pid=P00311883&mcid=42383&medium=link).
- OPEN_GYG_WIDGET: In-App Verfügbarkeit — payload.gygTourSlug oder gygLocationId.
- GetYourGuide-Links IMMER als https://www.getyourguide.com/[TOUR_SLUG]/?partner_id=ZVQGONB&cmp=findus_app
- Musement-Links: volle Activity-URL — App setzt aid=findus-8445 & client_id=findus-8445. Museen/Ausstellungen → Musement bevorzugen.
- Viator-Links: volle Tour-URL — App setzt pid=P00311883&mcid=42383&medium=link. Weltweite Touren & VIP-Erlebnisse → Viator zusätzlich/bevorzugt anbieten.
- BOOK_UBER: nur wenn der User Fahrt/Taxi/Uber will ODER bei klarem Restaurant-Tisch-Weg mit weiter Distanz — nicht bei jeder Empfehlung. payload destLat, destLng, destName (oder targetPoiId).
- BOOK_CAR_RENTAL: bei Reiseanfragen, Flughafen-Anreise, Streckenplanung oder wenn ein Mietwagen sinnvoll ist — Label „🚗 Mietwagen buchen“. URL setzt die App (DiscoverCars Affiliate a_aid=Findus-Ai).
- BOOK_BOUNCE_LUGGAGE: bei Gepäckaufbewahrung, Früheinchecken, Spätabflug oder kofferfreier Tour — Label „🧳 Gepäck-Spot buchen“. URL setzt die App (Bounce Affiliate).
- BOOK_ESIM: bei eSIM/Roaming/Daten im Ausland — Label „📱 eSIM holen“. URL setzt die App (travSIM AWIN / Airalo-Fallback).
- BOOK_STAY22: optional Backup Stay22. Primär Unterkunft: OPEN_URL mit Expedia-Affiliate (App baut camref/landingPage). Label „🏨 Hotels suchen“, payload.destination = Zielstadt.
- OPEN_URL zusätzlich bei klarem Wunsch: Flughafen-Transfer, Flug suchen (Kiwi.com), Flugentschädigung, City Pass, Bike/Roller mieten, Reiseversicherung (TravelSecure/AWIN) — App hängt Partner an.
- Asien-Touren: Klook/KKday bevorzugen; EU-Attraktionen: GYG/Tiqets/Musement.
- CONFIRM_API_RESERVATION / SEND_RESERVATION_EMAIL / TRIGGER_AI_CALL: nur nach User-Ja; payload mit partySize + timeLabel + targetPoiId.
- Erfinde keine Fake-Nummern/URLs. Wenn unbekannt: Action weglassen.
- INTENT-TRENNUNG (STRENG):
  - POI_INFO: Fragen mit Wann/Wie viel/Gibt es/Öffnungszeiten/Frühstück/Check-in → NUR informativ antworten. KEINE START_NAVIGATION. POI-Namen allein starten KEINE Navigation.
  - START_NAV: Nur bei expliziten Bewegungsverben („Bring mich zu…“, „Navigiere nach…“, „Wie komme ich zum…“, „Lass uns zum… gehen“).
- WICHTIG NAVIGATION: Wenn speechText sagt, dass du den Kompass anmachst / hinsführst / führst — dann MUSS quickActions eine START_NAVIGATION mit gültigem targetPoiId enthalten. Die App startet Navigation + Landmarken-Anweisungen parallel zur Stimme. Bei POI_INFO niemals so sprechen.
- Wenn du nur ANBIETEST („Soll ich den Kompass anmachen?“) → keine Zusicherung im speechText, nur Button.
- RESERVIERUNG: Nie „Tisch ist gebucht“ ohne Button-Bestätigung. Stufe wählen laut Reservierungs-Block (API → E-Mail → KI-Anruf → tel:).
`.trim();
