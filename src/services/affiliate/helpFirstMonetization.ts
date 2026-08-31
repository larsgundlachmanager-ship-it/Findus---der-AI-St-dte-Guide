/**
 * Hilfe-zuerst Monetisierung — Blaupausen für natürliche Partner-Momente.
 * User soll denken: „Danke, dass du mitdenkst.“ Provision = Nebenprodukt.
 * Keine Hardcode-Sätze — nur Struktur + Action-Hints.
 *
 * === AFFILIATE-ACTION-STRUKTUR (SSOT-Denkmodell) ===
 * 1) Moment erkennen (detectHelpFirstMoments) — nie Button ohne Hilfe-Kontext.
 * 2) Frühestmöglich Action bauen, sobald Ort/Intent klar ist.
 * 3) Max 1–2 Partner-Buttons pro Antwort + Maps; Hilfe-Ton, kein Pitch.
 * 4) BOOK_UBER nie aus Help-First — nur expliziter Taxi-/Uber-Intent (wantsTaxiRide).
 */

import type { QuickAction } from '../../types/concierge';
import type { Module2ActionButton } from '../../module2/types';

/** Lazy Affiliate-API — Node-Smokes ohne react-native. */
function aff(): typeof import('./affiliateService') {
  return require('./affiliateService') as typeof import('./affiliateService');
}

function safeHollow(url: string): boolean {
  try {
    return safeHollow(url);
  } catch {
    return !/^https?:\/\//i.test(url);
  }
}

function cityFromProfile(): string {
  try {
    const { getCachedUserProfile } = require('../userProfileService') as {
      getCachedUserProfile: () => { cityName?: string } | null;
    };
    return getCachedUserProfile()?.cityName?.trim() || '';
  } catch {
    return '';
  }
}

export type HelpFirstMomentKind =
  | 'airport_access'
  | 'hotel_night'
  | 'evening_free'
  | 'plan_gap_tour'
  | 'pre_flight_luggage'
  | 'abroad_esim'
  | 'travel_insurance'
  | 'roadtrip_car'
  | 'camping'
  | 'spain_package'
  | 'package_holiday'
  | 'landmark_ticket'
  | 'hotel_transfer'
  | 'dining_reserve';

export type HelpFirstMoment = {
  kind: HelpFirstMomentKind;
  /** Prompt-Hint für die KI (Struktur, kein Script). */
  promptHint: string;
  /** Priority 1 = höchste (High-Ticket / starke Hilfe). */
  priority: number;
};

const AIRPORT_RE =
  /\b(flughafen|airport|abflug|boarding|gate\b|check[- ]?in\b|terminal)\b/iu;
const FLIGHT_RE =
  /\b(flug|flieger|fliegen|fliege|fliegst|fliegt|landung|ankunft\s+flug)\b/iu;
const CHECKOUT_RE =
  /\b(auschecken|auscheckt|auscheck|check[- ]?out|zimmer\s+abgeb|hotel\s+verlass|noch\s+eine\s+nacht|übernacht|uebernacht)\b/iu;
const EVENING_RE =
  /\b(heute\s+abend|heut\s+abend|was\s+geht|nightlife|konzert|theater|show|veranstaltung)\b/iu;
const ABROAD_RE =
  /\b(ausland|roaming|esim|e-sim|kein\s+netz|daten\s+ausland|sim\s*karte)\b/iu;
const INSURANCE_RE =
  /\b(reiseversicherung|auslandsversicherung|travel\s*insurance)\b/iu;
const CAR_RE =
  /\b(mietwagen|leihwagen|auto\s+mieten|roadtrip|wagen\s+mieten)\b/iu;
const LUGGAGE_RE =
  /\b(gepäck|gepaeck|koffer(?:n|s)?|früheincheck|frueheincheck|spätabflug|spaetabflug)\b/iu;
const CAMPING_RE =
  /\b(camping|campingplatz|camper|wohnwagen|wohnmobil|glamping|stellplatz|zeltplatz)\b/iu;
const SOLMAR_RE =
  /\b(solmar|busreise\s+spanien|spanien\s+bus|bus\s+nach\s+spanien|costa\s+blanca|costa\s+brava|costa\s+dorada|pauschalreise\s+spanien|spanien\s+pauschal|spanienurlaub)\b/iu;
const PACKAGE_HOLIDAY_RE =
  /\b(ab[\s-]?in[\s-]?den[\s-]?urlaub|invia|weg\.de|pauschalreise|last\s*minute|lastminute|all[\s-]?inclusive|pauschal\s+buchen|urlaub\s+pauschal)\b/iu;
const LANDMARK_TICKET_RE =
  /\b(eintritt|ticket|tickets|rauf\b|hoch\s+(auf|zum)|turm|aussicht(?:splattform)?|michel|dom\b|museum|sehenswürdigkeit|sightseeing|führung|tour\b|tickets?\s+für|rauf\s+auf)\b/iu;
const HOTEL_TRANSFER_RE =
  /\b(transfer|shuttle|zum\s+flughafen|vom\s+flughafen|hotel.{0,48}flughafen|flughafen.{0,48}hotel|airport\s+transfer)\b/iu;
const RESERVE_RE =
  /\b(reservier\w*|tisch\s+(frei|buch|bestell)|reservation|platz\s+reserv\w*|tisch\s+für)\b/iu;
const FOREIGN_COUNTRY_RE =
  /\b(spanien|frankreich|italien|portugal|niederlande|belgien|england|großbritannien|grossbritannien|\buk\b|usa|amerika|thailand|türkei|tuerkei|griechenland|kroatien|dänemark|daenemark|schweden|norwegen|polen|japan|china|dubai|ägypten|aegypten|irland|island|finnland|ungarn|tschechien|slowakei|slowenien|rumänien|bulgarien|marokko|tunesien|brasilien|mexiko|kanada|australien|neuseeland)\b/iu;
const FOREIGN_CITY_RE =
  /\bnach\s+(amsterdam|paris|london|barcelona|madrid|rom|mailand|lissabon|stockholm|kopenhagen|oslo|prag|warschau|budapest|athen|istanbul|new\s*york|bangkok|tokyo|dubai|mallorca|teneriffa|palma|valencia|nizza|lyon|bordeaux|edinburgh|dublin|reykjavik|helsinki|osaka|seoul|singapore|singapur)\b/iu;
const DACH_DEST_RE =
  /\bnach\s+(deutschland|österreich|oesterreich|schweiz|berlin|hamburg|münchen|muenchen|köln|koeln|frankfurt|stuttgart|düsseldorf|duesseldorf|wien|salzburg|zürich|zurich|basel|genf|innsbruck|linz|graz|bern|luzern|nürnberg|nuernberg|leipzig|dresden|bremen|hannover|dortmund|essen|duisburg|bochum|wuppertal|bielefeld|bonn|münster|muenster|karlsruhe|mannheim|augsburg|wiesbaden|mönchengladbach|moenchengladbach|kiel|lübeck|luebeck|rostock|erfurt|magdeburg|halle|potsdam|saarbrücken|saarbruecken|freiburg|heidelberg|ulm|regensburg|würzburg|wuerzburg|mainz|kassel|prisdorf|laboe|wangerooge)\b/iu;

const PARTNER_HELP_TYPES = new Set([
  'BOOK_ESIM',
  'BOOK_CAR_RENTAL',
  'BOOK_BOUNCE_LUGGAGE',
  'BOOK_STAY22',
  'OPEN_URL',
  'OPEN_GYG_WIDGET',
  'DIAL_PHONE',
]);

function looksLikeAbroadFlight(blob: string): boolean {
  if (!FLIGHT_RE.test(blob)) return false;
  if (FOREIGN_COUNTRY_RE.test(blob) || FOREIGN_CITY_RE.test(blob)) return true;
  if (DACH_DEST_RE.test(blob)) return false;
  // „Flug nach <Ort>“ ohne DACH-Match → eher Ausland
  return /\bnach\s+[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]{2,}/u.test(blob);
}

/**
 * Kontext-Momente aus User-Text (+ optional Plan-Blob) erkennen.
 * BOOK_UBER wird hier nie vorgeschlagen.
 */
export function detectHelpFirstMoments(opts: {
  userText?: string | null;
  planBlob?: string | null;
  hasEveningGapHours?: number | null;
  hasLongGapHours?: number | null;
  flightOrAirportInPlan?: boolean;
  checkoutConflict?: boolean;
  /** Job-Hints aus Call-1 (z. B. tour_ticket, museum, dining). */
  jobHints?: string[] | null;
}): HelpFirstMoment[] {
  const blob = `${opts.userText ?? ''} ${opts.planBlob ?? ''}`.trim();
  const jobs = (opts.jobHints ?? []).map((j) => j.toLowerCase());
  const out: HelpFirstMoment[] = [];

  const airport =
    opts.flightOrAirportInPlan ||
    AIRPORT_RE.test(blob) ||
    FLIGHT_RE.test(blob);
  if (airport) {
    out.push({
      kind: 'airport_access',
      priority: 2,
      promptHint:
        'FLOW Anreise Flughafen: Problem lösen (wie kommt er hin / rechtzeitig) → ein klarer nächster Schritt + Button (Transfer und/oder Mietwagen). Hilfe-Ton, kein Partner-Pitch. Kein Uber/Taxi außer User will Taxi.',
    });
    if (LUGGAGE_RE.test(blob) || AIRPORT_RE.test(blob)) {
      out.push({
        kind: 'pre_flight_luggage',
        priority: 3,
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

  if (
    ABROAD_RE.test(blob) ||
    looksLikeAbroadFlight(blob) ||
    (FLIGHT_RE.test(blob) &&
      /\b(daten|internet|netz|sim|esim|e-sim|roaming)\b/iu.test(blob))
  ) {
    out.push({
      kind: 'abroad_esim',
      priority: 1,
      promptHint:
        'FLOW Ausland/Roaming/Auslandsflug: eSIM anbieten damit er erreichbar bleibt — Button BOOK_ESIM. Praktisch, nicht werblich.',
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

  if (CAMPING_RE.test(blob)) {
    out.push({
      kind: 'camping',
      priority: 2,
      promptHint:
        'FLOW Camping: Platz suchen/buchen → camping.info Button. Hilfe-Ton, kein Pitch.',
    });
  }

  if (SOLMAR_RE.test(blob)) {
    out.push({
      kind: 'spain_package',
      priority: 2,
      promptHint:
        'FLOW Spanien-Pauschal/Busreise: Solmar-Button anbieten wenn Bus/Costa/Pauschal im Kontext. Hilfe-Ton, kein Pitch.',
    });
  }

  if (PACKAGE_HOLIDAY_RE.test(blob)) {
    out.push({
      kind: 'package_holiday',
      priority: 2,
      promptHint:
        'FLOW Pauschal/Last-Minute/Kurztrip: CHECK24 primär; ab-in-den-urlaub/weg.de wenn Brand genannt. Hilfe-Ton, kein Pitch.',
    });
  }

  const landmarkJob = jobs.some((j) =>
    /tour|museum|sight|attraction|ticket|landmark|poi_story/.test(j),
  );
  if (LANDMARK_TICKET_RE.test(blob) || landmarkJob) {
    out.push({
      kind: 'landmark_ticket',
      priority: 1,
      promptHint:
        'FLOW Landmarke/Sight/Tour: Eintritt/Ticket/rauf → Ticket-Partner (Tiqets/GYG) wenn Kaufpfad sinnvoll. Hilfe, kein Upsell-Spam.',
    });
  }

  if (HOTEL_TRANSFER_RE.test(blob)) {
    out.push({
      kind: 'hotel_transfer',
      priority: 1,
      promptHint:
        'FLOW Hotel↔Flughafen Transfer: TPX/Transfer-Button — kein Uber/Taxi als Default. Nur wenn Transfer im Kontext.',
    });
  }

  if (RESERVE_RE.test(blob)) {
    // Reserve-Wörter allein reichen (Tisch reservieren) — Gastro-Kontext soft
    out.push({
      kind: 'dining_reserve',
      priority: 2,
      promptHint:
        'FLOW Tisch reservieren: nur belegter OpenTable/Quandoo-Link oder Venue-Website/Telefon — nie Fake-OpenTable. Hilfe-Ton.',
    });
  }

  out.sort((a, b) => a.priority - b.priority);
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
    '- Taxi/Uber nur wenn User Taxi/Uber will — nie aus Help-First.',
    '- Wortlaut frei aus Kontext; nur Struktur unten.',
  ];
  for (const m of moments.slice(0, 3)) {
    lines.push(`- [${m.kind}] ${m.promptHint}`);
  }
  return lines.join('\n');
}

/**
 * Kompakter Partner-Katalog für Call-2 (keine Secrets, keine langen URLs).
 * Nur status === ready, max ~12 Zeilen.
 */
export function formatAffiliateCatalogForCall2(
  catalog?: Array<{
    id: string;
    category: string;
    status: string;
    notes?: string;
    conciergeActions?: string[];
  }>,
): string {
  const source =
    catalog ??
    (() => {
      try {
        return aff().getAffiliateCatalog();
      } catch {
        return [] as Array<{
          id: string;
          category: string;
          status: string;
          notes?: string;
          conciergeActions?: string[];
        }>;
      }
    })();
  const ready = source.filter((p) => p.status === 'ready');
  const lines: string[] = [];
  for (const p of ready) {
    if (lines.length >= 12) break;
    const when =
      p.id === 'uber'
        ? 'nur expliziter Taxi/Uber-Intent'
        : (p.notes || p.category).replace(/\s+/g, ' ').slice(0, 72);
    const action = (p.conciergeActions[0] || 'OPEN_URL').slice(0, 24);
    lines.push(`${p.id} | ${p.category} | ${when} | ${action}`);
  }
  if (!lines.length) return '';
  return ['PARTNER_CATALOG (ready, kurz):', ...lines].join('\n');
}

function pushUniqueAction(actions: QuickAction[], next: QuickAction | null | undefined) {
  if (!next) return;
  if (next.type === 'BOOK_UBER') return; // Hard-Ban
  const url = typeof next.payload?.url === 'string' ? next.payload.url : '';
  if (url && safeHollow(url)) return;
  const key = `${next.type}:${url || next.label}`;
  if (actions.some((a) => `${a.type}:${a.payload?.url ?? a.label}` === key)) return;
  actions.push(next);
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
  const city = opts.cityName?.trim() || cityFromProfile();
  const actions: QuickAction[] = [];

  for (const m of moments) {
    if (actions.length >= 2) break;
    switch (m.kind) {
      case 'airport_access':
      case 'roadtrip_car':
        pushUniqueAction(actions, aff().buildCarRentalAction());
        if (m.kind === 'airport_access' && actions.length < 2) {
          pushUniqueAction(actions, aff().buildTravelpayoutsCategoryAction('transfer'));
        }
        break;
      case 'hotel_transfer':
        pushUniqueAction(actions, aff().buildTravelpayoutsCategoryAction('transfer'));
        break;
      case 'hotel_night':
        pushUniqueAction(
          actions,
          aff().buildExpediaAccommodationAction(city || 'Germany'),
        );
        break;
      case 'evening_free':
      case 'plan_gap_tour':
      case 'landmark_ticket':
        pushUniqueAction(
          actions,
          aff().buildTourBookingAction({
            kind: m.kind === 'landmark_ticket' ? 'attraction' : 'tour',
            city: city || undefined,
            query: city || undefined,
          }),
        );
        break;
      case 'pre_flight_luggage': {
        const bounce = aff().buildBounceLuggageAction();
        if (bounce) pushUniqueAction(actions, bounce);
        else pushUniqueAction(actions, aff().buildTravelpayoutsCategoryAction('luggage'));
        break;
      }
      case 'abroad_esim':
        pushUniqueAction(
          actions,
          aff().buildEsimAction({ textHint: opts.planBlob }) as QuickAction | null,
        );
        break;
      case 'travel_insurance':
        pushUniqueAction(actions, aff().buildTravelInsuranceAction());
        break;
      case 'camping':
        pushUniqueAction(
          actions,
          aff().buildCampingInfoAction({ cityOrQuery: city || undefined }),
        );
        break;
      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: opts.planBlob,
          }),
        );
        break;
      case 'dining_reserve':
        // Plan-Pfad: ohne belegte Venue-ID keinen Fake-OpenTable
        break;
      default:
        break;
    }
  }

  return actions.filter((a) => a.type !== 'BOOK_UBER').slice(0, 2);
}

/**
 * Turn-Inject nach Call-2: fehlende Partner-Hilfe-Buttons (max 2).
 * Nie BOOK_UBER.
 */
export function buildHelpFirstTurnActions(opts: {
  moments: HelpFirstMoment[];
  userText?: string | null;
  cityName?: string | null;
  placeName?: string | null;
  /** Belegte OpenTable-ID oder volle URL — sonst kein OT-Button. */
  openTableIdOrUrl?: string | null;
  venueWebsite?: string | null;
  venuePhone?: string | null;
}): QuickAction[] {
  const city = opts.cityName?.trim() || cityFromProfile();
  const place = opts.placeName?.trim() || '';
  const blob = `${opts.userText ?? ''} ${place} ${city}`.trim();
  const actions: QuickAction[] = [];
  const moments = opts.moments.slice(0, 4);

  for (const m of moments) {
    if (actions.length >= 2) break;
    switch (m.kind) {
      case 'abroad_esim':
        pushUniqueAction(
          actions,
          aff().buildEsimAction({ textHint: blob }) as QuickAction | null,
        );
        break;
      case 'landmark_ticket':
      case 'evening_free':
      case 'plan_gap_tour':
        pushUniqueAction(
          actions,
          aff().buildTourBookingAction({
            kind: m.kind === 'landmark_ticket' ? 'attraction' : 'tour',
            city: city || undefined,
            query: place || city || undefined,
          }),
        );
        break;
      case 'hotel_transfer':
        pushUniqueAction(actions, aff().buildTravelpayoutsCategoryAction('transfer'));
        break;
      case 'airport_access':
        pushUniqueAction(actions, aff().buildTravelpayoutsCategoryAction('transfer'));
        if (actions.length < 2 && CAR_RE.test(blob)) {
          pushUniqueAction(actions, aff().buildCarRentalAction());
        }
        break;
      case 'roadtrip_car':
        pushUniqueAction(actions, aff().buildCarRentalAction());
        break;
      case 'hotel_night':
        pushUniqueAction(
          actions,
          aff().buildExpediaAccommodationAction(city || place || 'Germany'),
        );
        break;
      case 'pre_flight_luggage': {
        const bounce = aff().buildBounceLuggageAction();
        if (bounce) pushUniqueAction(actions, bounce);
        break;
      }
      case 'travel_insurance':
        pushUniqueAction(actions, aff().buildTravelInsuranceAction());
        break;
      case 'camping':
        pushUniqueAction(
          actions,
          aff().buildCampingInfoAction({ cityOrQuery: city || undefined }),
        );
        break;
      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: blob,
          }),
        );
        break;
      case 'dining_reserve': {
        const otRaw = (opts.openTableIdOrUrl || '').trim();
        if (otRaw) {
          const url = /^https?:\/\//i.test(otRaw)
            ? otRaw
            : aff().getOpenTableBookingUrl(otRaw);
          if (url && !safeHollow(url)) {
            pushUniqueAction(actions, {
              type: 'OPEN_URL',
              label: '🍽️ Tisch reservieren',
              payload: { url, destName: place || 'Restaurant' },
            });
          }
        } else if (opts.venueWebsite && /^https?:\/\//i.test(opts.venueWebsite)) {
          pushUniqueAction(actions, {
            type: 'OPEN_URL',
            label: '🌐 Website',
            payload: { url: opts.venueWebsite, destName: place || 'Venue' },
          });
        } else if (opts.venuePhone?.trim()) {
          pushUniqueAction(actions, {
            type: 'DIAL_PHONE',
            label: '📞 Anrufen',
            payload: { phone: opts.venuePhone.trim() },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return actions.filter((a) => a.type !== 'BOOK_UBER').slice(0, 2);
}

/** QuickAction → Module2-Button für Inject in runConciergeTurn. */
export function helpFirstQuickActionToModule2Button(
  a: QuickAction,
  idPrefix: string,
): Module2ActionButton | null {
  if (a.type === 'BOOK_UBER') return null;
  if (!PARTNER_HELP_TYPES.has(a.type)) return null;

  if (a.type === 'DIAL_PHONE') {
    const phone = String(a.payload?.phone ?? '').trim();
    if (!phone) return null;
    return {
      id: `${idPrefix}_dial`,
      label: a.label.slice(0, 28),
      payload: { kind: 'dial', phone },
    };
  }

  const url = String(a.payload?.url ?? '').trim();
  if (!url || safeHollow(url)) return null;

  if (
    a.type === 'BOOK_ESIM' ||
    a.type === 'BOOK_CAR_RENTAL' ||
    a.type === 'BOOK_BOUNCE_LUGGAGE' ||
    a.type === 'BOOK_STAY22'
  ) {
    return {
      id: `${idPrefix}_${a.type.toLowerCase()}`,
      label: a.label.slice(0, 28),
      payload: {
        kind: 'ui',
        action: a.type,
        data: {
          url,
          destination:
            typeof a.payload?.destination === 'string'
              ? a.payload.destination
              : undefined,
        },
      },
    };
  }

  return {
    id: `${idPrefix}_url`,
    label: a.label.slice(0, 28),
    payload: {
      kind: 'deep_link',
      url,
      destName:
        (typeof a.payload?.destName === 'string' && a.payload.destName) ||
        (typeof a.payload?.destination === 'string' && a.payload.destination) ||
        undefined,
      destination:
        typeof a.payload?.destination === 'string'
          ? a.payload.destination
          : undefined,
    },
  };
}

/**
 * Fehlende Help-First-Buttons in bestehende Module2-Buttons mergen (max 2 Partner-Hilfe).
 */
export function injectHelpFirstModule2Buttons(opts: {
  buttons: Module2ActionButton[];
  moments: HelpFirstMoment[];
  userText?: string | null;
  cityName?: string | null;
  placeName?: string | null;
  openTableIdOrUrl?: string | null;
  venueWebsite?: string | null;
  venuePhone?: string | null;
  maxPartner?: number;
}): Module2ActionButton[] {
  const maxPartner = opts.maxPartner ?? 2;
  if (!opts.moments.length) return opts.buttons;

  const existingPartner = opts.buttons.filter((b) => {
    const p = b.payload as { kind?: string; action?: string; url?: string };
    if (p.kind === 'deep_link' && p.url) return true;
    if (
      p.kind === 'ui' &&
      /BOOK_ESIM|BOOK_CAR|BOOK_BOUNCE|BOOK_STAY22|OPEN_URL/i.test(
        String(p.action || ''),
      )
    ) {
      return true;
    }
    return false;
  }).length;

  if (existingPartner >= maxPartner) return opts.buttons;

  const needed = maxPartner - existingPartner;
  let built: QuickAction[] = [];
  try {
    built = buildHelpFirstTurnActions({
      moments: opts.moments,
      userText: opts.userText,
      cityName: opts.cityName,
      placeName: opts.placeName,
      openTableIdOrUrl: opts.openTableIdOrUrl,
      venueWebsite: opts.venueWebsite,
      venuePhone: opts.venuePhone,
    }).slice(0, needed);
  } catch {
    built = [];
  }

  const extras: Module2ActionButton[] = [];
  for (let i = 0; i < built.length; i++) {
    const btn = helpFirstQuickActionToModule2Button(built[i]!, `hf_${i}`);
    if (!btn) continue;
    const url =
      btn.payload.kind === 'deep_link'
        ? btn.payload.url
        : btn.payload.kind === 'ui'
          ? String(btn.payload.data?.url ?? '')
          : '';
    const dup = opts.buttons.some((b) => {
      const p = b.payload as { url?: string; data?: { url?: string } };
      const u = p.url || p.data?.url || '';
      return u && url && u === url;
    });
    if (dup) continue;
    extras.push(btn);
  }

  if (!extras.length) return opts.buttons;
  return [...opts.buttons, ...extras].slice(0, 4);
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
    const lastEnd = Math.max(...intervals.map((i) => i.endMs));
    if (lastEnd < eveningStart) return (eveningEnd - eveningStart) / 3_600_000;
    if (lastEnd < eveningEnd) return (eveningEnd - lastEnd) / 3_600_000;
    return null;
  }
  return (eveningEnd - eveningStart) / 3_600_000;
}
