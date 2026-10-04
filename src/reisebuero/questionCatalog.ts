/**
 * Akt-1 Fragenkatalog — Master → Kategorie → Tiefe.
 * Struktur/Keys im Code; Wortlaut der Frage/Sticker dynamisch (Speech/LLM).
 */

import type { ReiseLedger } from './types';
import { detectTripVibes, type TripVibe } from './vibeProbes';
import {
  branchesFromPersonas,
  detectTouristPersonas,
} from './touristPersonas';

function hasWhenLocal(ledger: ReiseLedger): boolean {
  if (ledger.mode?.value === 'daytrip') return true;
  if (ledger.dateStart || ledger.dateEnd) return true;
  if (ledger.stayDays || ledger.stayNights || ledger.stayNightsMax) return true;
  if (ledger.dateMonth && (ledger.dateFlex?.value === 'weekend' || ledger.dateFlex?.value === 'month')) {
    return true;
  }
  if (ledger.dateAnchor?.value === 'depart' && ledger.dateEnd) return true;
  return false;
}

function needsNightLocal(ledger: ReiseLedger): boolean {
  return ledger.mode?.value !== 'daytrip';
}

function hasUserBudgetLocal(ledger: ReiseLedger): boolean {
  return Boolean(ledger.budgetEur && ledger.budgetEur.source === 'user');
}

export type CatalogBranch =
  | 'master'
  | 'party'
  | 'spa'
  | 'event'
  | 'tournament'
  | 'cruise'
  | 'family'
  | 'mode_deep'
  | 'romantic'
  | 'allInclusive'
  | 'city'
  | 'active'
  | 'seasonal'
  | 'senior'
  | 'open_discover';

export type CatalogQuestion = {
  id: string;
  branch: CatalogBranch;
  parentId?: string;
  depth: 0 | 1 | 2;
  /** Thema für Flipchart/LLM — kein Vorlese-Skript. */
  topic: string;
  fills: string[];
  askSeed: string;
  when?: (ctx: CatalogCtx) => boolean;
  filled: (ctx: CatalogCtx) => boolean;
};

export type CatalogExtra = {
  id: string;
  topic: string;
  askSeed: string;
  branch?: CatalogBranch;
  done?: boolean;
};

export type CatalogCtx = {
  ledger: ReiseLedger;
  vibes: TripVibe;
  asked: string[];
  extras: CatalogExtra[];
};

function amenity(ledger: ReiseLedger, id: string): boolean {
  return (
    (ledger.mustHaves?.value ?? []).includes(id as never) ||
    (ledger.wishHaves?.value ?? []).includes(id as never) ||
    (ledger.niceHaves?.value ?? []).includes(id as never)
  );
}

function blob(ledger: ReiseLedger): string {
  return [
    ledger.purpose?.value,
    ledger.energy?.value,
    ledger.extraWishes?.value,
    ledger.highlightWant?.value,
    ledger.inspiration?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function detectCatalogBranches(ledger: ReiseLedger, userLine = ''): CatalogBranch[] {
  const v = detectTripVibes(ledger);
  const t = `${blob(ledger)} ${userLine}`.toLowerCase();
  const out: CatalogBranch[] = ['master'];

  // Personas (~30) → Branches (SSOT touristPersonas.ts)
  for (const b of branchesFromPersonas(detectTouristPersonas(ledger, userLine))) {
    out.push(b);
  }

  // Legacy / Vibes-Fallback (wenn Persona-Matcher dünn)
  if (v.party || (/party|feier|nightlife|männer|jungs/.test(t) || /\bclubs?\b/.test(t)) && !/kids.?club|kinderclub/.test(t))
    out.push('party');
  if (v.spa || /spa|wellness|sauna|massage|therme|detox/.test(t)) out.push('spa');
  if (
    /turnier|finale|halbfinale|\bwm\b|\bem\b|meisterschaft|match|spieltag|bundesliga|champions|grand\s*slam|tennis/.test(
      t,
    ) ||
    amenity(ledger, 'stadium')
  ) {
    out.push('tournament');
  }
  if (
    /festival|konzert|open\s*air|veranstaltung|messe|event|auftreten|ticket|hochzeit/.test(t) ||
    amenity(ledger, 'concert')
  ) {
    out.push('event');
  }
  if (
    /kreuzfahrt|cruise|schiff|kabine|einschiff|polarlicht|flusskreuzfahrt/.test(t) ||
    ledger.tripShape?.value === 'cruise' ||
    amenity(ledger, 'cruise') ||
    amenity(ledger, 'river_cruise')
  ) {
    out.push('cruise');
  }
  if (
    v.kids ||
    (ledger.children?.value ?? 0) > 0 ||
    /familie|kids.?club|kinderwagen|baby/.test(t)
  ) {
    out.push('family');
  }
  // Mode-Tiefe: Flug/Bahn/Auto + Senior/Budget-Signale
  if (
    ledger.mode?.value === 'fly' ||
    ledger.mode?.value === 'train' ||
    ledger.mode?.value === 'drive' ||
    /flug|bahn|auto|direkt|umstieg|fahrzeit|senior|70\+|80\+|rollstuhl|flix/.test(t) ||
    Boolean(ledger.accessNeeds?.value?.length) ||
    (ledger.travelerAges?.value ?? []).some((a) => a >= 70)
  ) {
    out.push('mode_deep');
  }
  if (
    ledger.tripShape?.value === 'hop' ||
    ledger.tripShape?.value === 'roadtrip' ||
    ledger.tripShape?.value === 'tour' ||
    /roadtrip|multi.?city|rundreise|workation|norditalien|hopping/.test(t)
  ) {
    if (!out.includes('mode_deep')) out.push('mode_deep');
  }
  return [...new Set(out)];
}

/** Feste Katalog-Reihenfolge (Master zuerst, dann Tiefe). */
export const QUESTION_CATALOG: CatalogQuestion[] = [
  {
    id: 'purpose',
    branch: 'master',
    depth: 0,
    topic: 'Reise-Idee / Zweck',
    fills: ['purpose', 'energy', 'inspiration'],
    askSeed: 'Was soll der Urlaub werden — entspannen, Party, Spa, Event, oder was anderes?',
    filled: ({ ledger }) =>
      Boolean(ledger.purpose?.value) ||
      Boolean(ledger.energy?.value) ||
      Boolean(ledger.inspiration?.value) ||
      Boolean(ledger.highlightWant?.value) ||
      Boolean(ledger.bookedStay?.value) ||
      Boolean(ledger.destinationHint?.value) ||
      /* schon tief im Brief — Zweck aus Mode/Zeit/Gruppe ableitbar, Branches über Vibes */
      (Boolean(ledger.mode && ledger.mode.value !== 'unknown') &&
        hasWhenLocal(ledger) &&
        (ledger.adults?.source === 'user' || ledger.adults?.source === 'profile')),
  },
  {
    id: 'adults',
    branch: 'master',
    depth: 0,
    topic: 'Gruppe / Personen',
    fills: ['adults', 'children'],
    askSeed: 'Allein oder zu mehreren — und wie viele?',
    filled: ({ ledger }) =>
      ledger.adults?.source === 'user' || ledger.adults?.source === 'profile',
  },
  {
    id: 'when',
    branch: 'master',
    depth: 0,
    topic: 'Zeitraum',
    fills: ['dateStart', 'dateEnd', 'stayNights', 'dateMonth'],
    askSeed: 'Wann soll’s losgehen — Monat reicht, Tage optional?',
    filled: ({ ledger }) => hasWhenLocal(ledger),
  },
  {
    id: 'budget',
    branch: 'master',
    depth: 0,
    topic: 'Budget',
    fills: ['budgetEur', 'budgetVibe'],
    askSeed: 'Was schwebt preislich vor — grob pro Person?',
    filled: ({ ledger }) =>
      hasUserBudgetLocal(ledger) || Boolean(ledger.budgetVibe?.value) || ledger.dealHunt?.value === true,
  },
  {
    id: 'origin',
    branch: 'master',
    depth: 0,
    topic: 'Startort',
    fills: ['originCity', 'originCities'],
    askSeed: 'Von wo startet ihr?',
    filled: ({ ledger }) =>
      ledger.mode?.value === 'daytrip' ||
      ledger.originCity?.source === 'user' ||
      Boolean(ledger.originCities?.value?.length),
  },
  {
    id: 'lodging',
    branch: 'master',
    depth: 0,
    topic: 'Unterkunft',
    fills: ['lodgingKind', 'lodgingOpen'],
    askSeed: 'Hotel, Ferienhaus oder Apartment — was liegt näher?',
    when: ({ ledger }) => needsNightLocal(ledger) && ledger.tripShape?.value !== 'cruise',
    filled: ({ ledger }) =>
      Boolean(ledger.lodgingKind || ledger.lodgingOpen?.value) ||
      ledger.bookedStay?.value === true ||
      !needsNightLocal(ledger),
  },
  {
    id: 'lodgingRank',
    branch: 'master',
    depth: 1,
    topic: 'Unterkunft Erst- / Notfall-Spur',
    fills: ['lodgingKind', 'lodgingFallback'],
    askSeed: 'Was wäre die geilste Spur — und was als Notfall, wenn die leer oder zu teuer ist?',
    when: ({ ledger }) =>
      needsNightLocal(ledger) &&
      ledger.tripShape?.value !== 'cruise' &&
      Boolean(ledger.lodgingKind) &&
      !ledger.lodgingFallback &&
      !ledger.lodgingOpen?.value &&
      ledger.bookedStay?.value !== true &&
      // nur wenn AI/Hotel-Erstspur oder Ranking schon angekündigt
      (ledger.meals?.value === 'all' ||
        ledger.lodgingKind?.value === 'hotel' &&
          (amenity(ledger, 'spa') || amenity(ledger, 'party') || /all.?inclusive|geilst|notfall/i.test(blob(ledger)))),
    filled: ({ ledger }) =>
      Boolean(ledger.lodgingFallback) ||
      ledger.lodgingOpen?.value === true ||
      ledger.bookedStay?.value === true ||
      (Boolean(ledger.lodgingKind) && ledger.meals?.value !== 'all'),
  },
  {
    id: 'bookedBits',
    branch: 'master',
    depth: 0,
    topic: 'Schon gebucht?',
    fills: [
      'bookedFlight',
      'bookedStay',
      'bookedTransfer',
      'bookedRail',
      'bookedBus',
      'bookedCar',
      'needCar',
    ],
    askSeed: 'Was habt ihr schon — und was fehlt noch: Flug, Bahn, Hotel oder Mietwagen?',
    when: ({ ledger }) => {
      const anyBooked =
        ledger.bookedStay?.value === true ||
        ledger.bookedFlight?.value === true ||
        ledger.bookedRail?.value === true ||
        ledger.bookedBus?.value === true ||
        ledger.bookedCar?.value === true ||
        (ledger.bookedActivities?.value?.length ?? 0) > 0;
      const anyOpen =
        ledger.bookedFlight == null ||
        ledger.bookedStay == null ||
        (ledger.needCar?.value === true && ledger.bookedCar?.value !== true);
      // Stay da, Anreise unklar
      if (ledger.bookedStay?.value === true && ledger.bookedFlight?.value !== true && !ledger.mode) {
        return true;
      }
      // Flug da, Stay unklar (bei Übernachtung)
      if (ledger.bookedFlight?.value === true && ledger.bookedStay == null && needsNightLocal(ledger)) {
        return true;
      }
      // Teil-Inventar ohne klare Lücke → einmal nachfragen
      return anyBooked && anyOpen && ledger.inventoryMode?.value !== 'add_on';
    },
    filled: ({ ledger }) => {
      // gap_fill mit klarer Lücke zählt als beantwortet; unklare Anreise/Stay nicht
      if (ledger.inventoryMode?.value === 'add_on') return true;
      if (
        ledger.inventoryMode?.value === 'gap_fill' &&
        (ledger.bookedFlight != null ||
          ledger.bookedRail != null ||
          ledger.bookedBus != null ||
          ledger.needCar != null ||
          Boolean(ledger.mode && ledger.mode.value !== 'unknown'))
      ) {
        return true;
      }
      return (
        ledger.bookedFlight != null ||
        ledger.bookedRail != null ||
        ledger.bookedBus != null ||
        Boolean(ledger.mode && ledger.mode.value !== 'unknown') ||
        ledger.needCar != null
      );
    },
  },
  {
    id: 'needCar',
    branch: 'master',
    depth: 1,
    topic: 'Mietwagen',
    fills: ['needCar', 'bookedCar', 'rentalCar'],
    askSeed: 'Braucht ihr vor Ort noch einen Mietwagen?',
    when: ({ ledger }) =>
      // erst nach geklärter Anreise/Stay-Lücke — nicht vor bookedBits
      (ledger.bookedFlight?.value === true || ledger.bookedStay?.value === true) &&
      (ledger.bookedFlight != null ||
        ledger.bookedRail != null ||
        Boolean(ledger.mode) ||
        ledger.bookedStay?.value === false) &&
      ledger.needCar == null &&
      ledger.bookedCar?.value !== true &&
      ledger.rentalCar == null &&
      ledger.localMovePref?.value !== 'oepnv' &&
      ledger.localMovePref?.value !== 'walk',
    filled: ({ ledger }) =>
      ledger.needCar != null || ledger.bookedCar != null || ledger.rentalCar != null,
  },
  {
    id: 'mode',
    branch: 'master',
    depth: 0,
    topic: 'Anreise-Art',
    fills: ['mode'],
    askSeed: 'Flug, Bahn oder Auto — oder egal, Hauptsache günstig?',
    filled: ({ ledger }) =>
      Boolean(ledger.mode && ledger.mode.value !== 'unknown') ||
      ledger.tripShape?.value === 'cruise' ||
      ledger.tripShape?.value === 'ferry' ||
      ledger.bookedFlight?.value === true ||
      ledger.bookedRail?.value === true ||
      ledger.bookedBus?.value === true ||
      (ledger.bookedStay?.value === true && ledger.needCar?.value === true),
  },
  {
    id: 'bags',
    branch: 'master',
    depth: 0,
    topic: 'Gepäck',
    fills: ['cabinBags', 'checkedBags'],
    askSeed: 'Nur Handgepäck oder auch Aufgabegepäck — wie viele?',
    when: ({ ledger }) =>
      ledger.mode?.value === 'fly' && ledger.bookedFlight?.value !== true,
    filled: ({ ledger }) =>
      ledger.mode?.value !== 'fly' || ledger.cabinBags != null || ledger.checkedBags != null,
  },
  {
    id: 'meals',
    branch: 'master',
    depth: 0,
    topic: 'Verpflegung',
    fills: ['meals'],
    askSeed: 'Essen — selbst, Frühstück, Halbpension oder All Inclusive?',
    when: ({ ledger }) => needsNightLocal(ledger) && ledger.tripShape?.value !== 'cruise',
    filled: ({ ledger }) => Boolean(ledger.meals),
  },
  {
    id: 'localMove',
    branch: 'master',
    depth: 0,
    topic: 'Fortbewegung vor Ort',
    fills: ['localMovePref', 'rentalCar'],
    askSeed: 'Vor Ort eher zu Fuß/ÖPNV, Rad/Scooter, Hop-on oder Mietwagen?',
    when: ({ ledger }) =>
      ledger.tripShape?.value !== 'cruise' && ledger.tripShape?.value !== 'ferry',
    filled: ({ ledger }) =>
      Boolean(ledger.localMovePref || ledger.rentalCar != null) ||
      ledger.tripShape?.value === 'cruise' ||
      ledger.tripShape?.value === 'ferry',
  },
  {
    id: 'ages',
    branch: 'master',
    depth: 0,
    topic: 'Alter je Person',
    fills: ['travelerAges'],
    askSeed: 'Alter der Mitreisenden — einzeln, grob reicht?',
    when: ({ ledger }) =>
      (ledger.adults?.value ?? 0) >= 2 ||
      (ledger.children?.value ?? 0) > 0 ||
      Boolean(ledger.travelerAges) ||
      /senior|70|80|kind|kinder/i.test(blob(ledger)),
    filled: ({ ledger }) => Boolean(ledger.travelerAges?.value?.length),
  },
  {
    id: 'bahncard',
    branch: 'master',
    depth: 0,
    topic: 'Bahncard',
    fills: ['bahncard'],
    askSeed: 'Hat jemand eine Bahncard?',
    when: ({ ledger }) =>
      ledger.mode?.value === 'train' ||
      ledger.modeFallback?.value === 'train' ||
      ledger.surfacePref?.value === 'train_only' ||
      ledger.surfacePref?.value === 'train_ok_bus_no',
    filled: ({ ledger }) => ledger.bahncard != null && ledger.bahncard.source === 'user',
  },
  {
    id: 'geo',
    branch: 'master',
    depth: 0,
    topic: 'Lage',
    fills: ['locationBias'],
    askSeed: 'Lage — zentral, ruhig, oder nah an einem Spot?',
    filled: ({ ledger }) => Boolean(ledger.locationBias || ledger.extraWishes),
  },
  {
    id: 'dest',
    branch: 'master',
    depth: 0,
    topic: 'Richtung / Ziel',
    fills: ['destinationHint', 'corridor'],
    askSeed: 'Schon eine Richtung oder Stadt — oder noch offen?',
    filled: ({ ledger }) =>
      Boolean(ledger.destinationHint?.value) || Boolean(ledger.corridor?.value),
  },
  {
    id: 'cityExplore',
    branch: 'city',
    depth: 1,
    topic: 'Stadt-Erwartung',
    fills: ['cityExplore', 'localMovePref'],
    askSeed: 'Viel erkunden — Museen/Kirchen/Geschichte? Zentrum wohnen oder reinfahren?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('city') ||
      (Boolean(ledger.destinationHint?.value) &&
        !/warm|strand|beach|resort|all.?inclusive/i.test(blob(ledger)) &&
        ledger.tripShape?.value !== 'cruise'),
    filled: ({ ledger }) => Boolean(ledger.cityExplore?.value),
  },
  {
    id: 'accessNeeds',
    branch: 'senior',
    depth: 1,
    topic: 'Zugang / Mobilität',
    fills: ['accessNeeds'],
    askSeed: 'Gibt’s Zugangsthemen — 70+, Rollstuhl, kurze Wege?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('senior'),
    filled: ({ ledger }) => Boolean(ledger.accessNeeds?.value?.length),
  },
  {
    id: 'tripShapeAsk',
    branch: 'master',
    depth: 1,
    topic: 'Reiseform',
    fills: ['tripShape'],
    askSeed: 'Ein Hub, mehrere Städte nacheinander, Roadtrip oder Kreuzfahrt?',
    when: ({ ledger }) =>
      !ledger.tripShape &&
      ((ledger.stayNights?.value ?? 0) >= 5 ||
        /tour|rundreise|mehrere\s+städte|hop|italien|norditalien/i.test(blob(ledger))),
    filled: ({ ledger }) => Boolean(ledger.tripShape),
  },
  {
    id: 'hopStops',
    branch: 'master',
    depth: 1,
    topic: 'Multi-City Stops',
    fills: ['hopStops', 'tripShape'],
    askSeed: 'Welche Städte in welcher Reihenfolge — und wie viele Nächte je Stop?',
    when: ({ ledger }) =>
      ledger.tripShape?.value === 'hop' ||
      ledger.tripShape?.value === 'tour' ||
      Boolean(ledger.hopStops?.value?.length) ||
      /multi.?city|st[äa]dte.?hop|mehrere\s+st[äa]dt|rundreise/i.test(blob(ledger)),
    filled: ({ ledger }) => Boolean(ledger.hopStops?.value && ledger.hopStops.value.length >= 2),
  },

  {
    id: 'partyGrain',
    branch: 'party',
    depth: 1,
    topic: 'Feier-Stil',
    fills: ['partyGrain', 'partyStyle'],
    askSeed: 'Eher privat unter euch, Bars, oder Clubs?',
    when: ({ vibes }) => vibes.party,
    filled: ({ ledger }) => Boolean(ledger.partyGrain || ledger.partyStyle),
  },
  {
    id: 'partyMusic',
    branch: 'party',
    parentId: 'partyGrain',
    depth: 2,
    topic: 'Musikrichtung',
    fills: ['partyStyle'],
    askSeed: 'Musik — Techno, Schlager, Rock, Live, Mixed?',
    when: ({ vibes, ledger }) =>
      vibes.party &&
      ledger.partyGrain?.value === 'clubs' &&
      Boolean(ledger.partyGrain || ledger.partyStyle),
    filled: ({ ledger }) =>
      // Style schon da → Musik optional (nicht blockieren)
      Boolean(ledger.partyStyle?.value) ||
      /techno|schlager|rock|metal|live|mixed|hip.?hop|house/i.test(
        `${ledger.partyStyle?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },
  {
    id: 'partyDepth',
    branch: 'party',
    parentId: 'partyGrain',
    depth: 2,
    topic: 'Party-Rhythmus / Drinks',
    fills: ['cheapDrinks', 'extraWishes'],
    askSeed: 'Viel ausgehen, Vortrinken — und wie wichtig günstige Drinks?',
    when: ({ vibes, ledger }) => vibes.party && Boolean(ledger.partyGrain || ledger.partyStyle),
    filled: ({ ledger }) =>
      ledger.cheapDrinks != null ||
      /drink|bier|club|bar|nacht|vortrinken/i.test(ledger.extraWishes?.value || ''),
  },

  {
    id: 'spaStyle',
    branch: 'spa',
    depth: 1,
    topic: 'Spa / Wellness',
    fills: ['spaStyle'],
    askSeed: 'Pool, Meer, Massage, Sauna — was ist der Kern?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('spa'),
    filled: ({ ledger }) => Boolean(ledger.spaStyle),
  },
  {
    id: 'spaIntent',
    branch: 'spa',
    parentId: 'spaStyle',
    depth: 2,
    topic: 'Spa-Intent',
    fills: ['spaIntent'],
    askSeed: 'Nur liegen und erholen, oder Wellness aktiv nutzen?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('spa') && Boolean(ledger.spaStyle),
    filled: ({ ledger }) => Boolean(ledger.spaIntent),
  },
  {
    id: 'spaInclude',
    branch: 'spa',
    parentId: 'spaStyle',
    depth: 2,
    topic: 'Spa inklusive?',
    fills: ['extraWishes'],
    askSeed: 'Massage/Sauna schon im Preis, extra, oder egal?',
    when: ({ vibes, ledger }) => vibes.spa && Boolean(ledger.spaStyle || ledger.spaIntent),
    filled: ({ ledger }) =>
      /inklusive|inkl\.|extra|massage|sauna.?preis/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.spaStyle?.value || ''}`,
      ),
  },
  {
    id: 'spaVsBeach',
    branch: 'spa',
    parentId: 'spaStyle',
    depth: 2,
    topic: 'Spa vs Strand',
    fills: ['extraWishes'],
    askSeed: 'Hauptsächlich Spa, Strand+liegen, oder beides?',
    when: ({ vibes, ledger }) => vibes.spa && Boolean(ledger.spaStyle || ledger.spaIntent),
    filled: ({ ledger }) =>
      /strand|beach|beides|nur\s+spa/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.spaStyle?.value || ''}`,
      ),
  },
  {
    id: 'spaDepth',
    branch: 'spa',
    parentId: 'spaStyle',
    depth: 2,
    topic: 'Spa-Tiefe',
    fills: ['extraWishes'],
    askSeed: 'Eher Hotel-Spa am Stück, oder Tages-Therme / Behandlungen?',
    when: ({ vibes, ledger }) => vibes.spa && Boolean(ledger.spaStyle),
    filled: ({ ledger }) =>
      /therme|massage|behandlung|spa.?tag|wellness/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.spaStyle?.value || ''}`,
      ),
  },

  {
    id: 'eventCore',
    branch: 'event',
    depth: 1,
    topic: 'Event / Festival',
    fills: ['highlightWant', 'inspiration'],
    askSeed: 'Welches Event oder Festival — und welche Tage sind Pflicht?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('event') &&
      !/hochzeit|trauung/i.test(ledger.purpose?.value || ''),
    filled: ({ ledger }) =>
      Boolean(ledger.highlightWant?.value) ||
      /festival|konzert|event/i.test(ledger.purpose?.value || ''),
  },
  {
    id: 'weddingWhereWhen',
    branch: 'event',
    depth: 1,
    topic: 'Hochzeit Ort + Tag',
    fills: ['destinationHint', 'dateStart', 'highlightWant'],
    askSeed: 'Wo ist die Hochzeit — und an welchem Tag?',
    when: ({ ledger }) =>
      /hochzeit|trauung/i.test(
        `${ledger.purpose?.value || ''} ${ledger.highlightWant?.value || ''}`,
      ),
    filled: ({ ledger }) =>
      Boolean(ledger.destinationHint?.value) &&
      Boolean(ledger.dateStart?.value),
  },
  {
    id: 'weddingStayTravel',
    branch: 'event',
    parentId: 'weddingWhereWhen',
    depth: 2,
    topic: 'Hochzeit Anreise / Hotel',
    fills: ['mode', 'lodgingKind'],
    askSeed: 'Braucht ihr Flug und Hotel zur Hochzeit — oder nur einen von beiden?',
    when: ({ ledger }) =>
      /hochzeit|trauung/i.test(
        `${ledger.purpose?.value || ''} ${ledger.highlightWant?.value || ''}`,
      ) && Boolean(ledger.destinationHint?.value),
    filled: ({ ledger }) =>
      Boolean(ledger.mode?.value) || Boolean(ledger.lodgingKind?.value),
  },
  {
    id: 'eventDepth',
    branch: 'event',
    parentId: 'eventCore',
    depth: 2,
    topic: 'Event-Tickets / Nähe',
    fills: ['extraWishes', 'locationBias'],
    askSeed: 'Tickets schon da — und Übernachtung nah am Gelände oder egal?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('event') &&
      !/hochzeit|trauung/i.test(ledger.purpose?.value || ''),
    filled: ({ ledger }) =>
      /ticket|gelände|venue|nah am/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.locationBias?.value || ''}`,
      ),
  },

  {
    id: 'tournamentCore',
    branch: 'tournament',
    depth: 1,
    topic: 'Turnier / Spiel',
    fills: ['highlightWant', 'dateStart'],
    askSeed: 'Welches Spiel oder Turnier — und welches Datum ist fix?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('tournament'),
    filled: ({ ledger }) =>
      /turnier|spiel|match|finale|wm|em/i.test(
        `${ledger.highlightWant?.value || ''} ${ledger.purpose?.value || ''}`,
      ),
  },
  {
    id: 'tournamentDepth',
    branch: 'tournament',
    parentId: 'tournamentCore',
    depth: 2,
    topic: 'Stadion / Anreise Spieltag',
    fills: ['localMovePref', 'extraWishes'],
    askSeed: 'Nur Spieltag vor Ort, oder länger — und wie zum Stadion?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('tournament'),
    filled: ({ ledger }) =>
      Boolean(ledger.localMovePref) ||
      /stadion|spieltag|anreise/i.test(ledger.extraWishes?.value || ''),
  },

  {
    id: 'cruiseCore',
    branch: 'cruise',
    depth: 1,
    topic: 'Kreuzfahrt Region',
    fills: ['tripShape', 'destinationHint', 'corridor'],
    askSeed:
      'Wohin soll die Route — Ostsee, Mittelmeer, woanders — und welche Reederei, falls schon klar?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('cruise'),
    filled: ({ ledger }) =>
      Boolean(ledger.destinationHint || ledger.corridor || ledger.cruiseEmbarkPort) ||
      Boolean(ledger.cruiseLinePref) ||
      /ostsee|mittelmeer|norwegen|kanaren|karibik|aida|mein\s*schiff/i.test(
        `${ledger.destinationHint?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },
  {
    id: 'cruiseShipVibe',
    branch: 'cruise',
    parentId: 'cruiseCore',
    depth: 2,
    topic: 'Schiff-Wünsche',
    fills: ['mustHaves', 'wishHaves', 'extraWishes', 'kidsStyle', 'partyStyle', 'spaStyle'],
    askSeed:
      'Was soll das Schiff können — Pool, Rutsche, Laufbahn, Sauna, Kids, Teens, Party oder eher ruhig für Rentner?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('cruise'),
    filled: ({ ledger }) => {
      const am = [
        ...(ledger.mustHaves?.value ?? []),
        ...(ledger.wishHaves?.value ?? []),
        ...(ledger.niceHaves?.value ?? []),
      ];
      const cruiseAmen = [
        'pool',
        'water_slide',
        'running_track',
        'sauna',
        'spa',
        'kids_club',
        'teens_club',
        'party',
        'seniors',
        'quiet',
        'culinary',
      ];
      if (am.some((id) => cruiseAmen.includes(id))) return true;
      if (ledger.kidsStyle || ledger.partyStyle || ledger.spaStyle) return true;
      return /pool|rutsche|laufbahn|sauna|spa|kids|teens?|party|rentner|ruhig|schiff/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.kidsStyle?.value || ''}`,
      );
    },
  },
  {
    id: 'cruiseShipPick',
    branch: 'cruise',
    parentId: 'cruiseShipVibe',
    depth: 2,
    topic: 'Welches Schiff',
    fills: ['cruiseShipName', 'cruiseLinePref'],
    askSeed:
      'Hast du schon ein konkretes Schiff im Kopf — z. B. Mein Schiff 3 oder 7, AIDAnova — oder soll ich passende vorschlagen?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('cruise'),
    filled: ({ ledger }) =>
      Boolean(ledger.cruiseShipName) ||
      ledger.cruiseLinePref?.value === 'open' ||
      /egal\s+schiff|schiff\s+egal|vorschlagen/i.test(ledger.extraWishes?.value || ''),
  },
  {
    id: 'cruiseDepth',
    branch: 'cruise',
    parentId: 'cruiseShipPick',
    depth: 2,
    topic: 'Einschiffen / Kabine / Seetage',
    fills: ['cruiseCabinClass', 'cruiseSeaDaysBias', 'cruiseEmbarkBias', 'extraWishes'],
    askSeed: 'Einschiff-Hafen, Kabine, eher Seetage oder viele Häfen — Allergien?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('cruise'),
    filled: ({ ledger }) =>
      Boolean(ledger.cruiseCabinClass || ledger.cruiseSeaDaysBias || ledger.cruiseEmbarkBias) ||
      /kabine|meerblick|einschiff|hafen|seetag|allergie/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.lodgingKind?.value || ''}`,
      ),
  },

  {
    id: 'kidsStyle',
    branch: 'family',
    depth: 1,
    topic: 'Kinder',
    fills: ['kidsStyle', 'children'],
    askSeed: 'Was mögen die Kinder — Animation, Strand, Ruhe?',
    when: ({ vibes, ledger }) => vibes.kids || (ledger.children?.value ?? 0) > 0,
    filled: ({ ledger }) => Boolean(ledger.kidsStyle || ledger.extraWishes),
  },
  {
    id: 'kidsClubVsTogether',
    branch: 'family',
    parentId: 'kidsStyle',
    depth: 2,
    topic: 'Kids-Club vs. zusammen',
    fills: ['kidsStyle', 'extraWishes'],
    askSeed: 'Kids-Club / Animation ok — oder lieber alles zusammen?',
    when: ({ vibes, ledger }) => vibes.kids || (ledger.children?.value ?? 0) > 0,
    filled: ({ ledger }) =>
      /kids.?club|animation|zusammen|abschieben|betreuung/i.test(
        `${ledger.kidsStyle?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },
  {
    id: 'familyQuietPace',
    branch: 'family',
    depth: 1,
    topic: 'Familien-Tempo',
    fills: ['kidsStyle', 'extraWishes'],
    askSeed: 'Ruhiges Tempo — Nickerchen, Kinderwagen, Nähe Strand?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('family') &&
      /ruhig|nickerchen|kinderwagen|langsam|tempo/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /nickerchen|kinderwagen|ruhig|tempo|strand/i.test(
        `${ledger.kidsStyle?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },

  {
    id: 'romanticCore',
    branch: 'romantic',
    depth: 1,
    topic: 'Romantik / Paar',
    fills: ['locationBias', 'energy'],
    askSeed: 'Eher ruhige Lage und Dinner — oder auch mal Spa light?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('romantic'),
    filled: ({ ledger }) =>
      /ruhe|dinner|romant|spa.?light|candle/i.test(
        `${ledger.energy?.value || ''} ${ledger.extraWishes?.value || ''} ${ledger.locationBias?.value || ''}`,
      ),
  },
  {
    id: 'romanticDepth',
    branch: 'romantic',
    parentId: 'romanticCore',
    depth: 2,
    topic: 'Restaurant-Niveau',
    fills: ['extraWishes'],
    askSeed: 'Restaurant-Niveau — entspannt, gehobene Küche, oder egal?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('romantic'),
    filled: ({ ledger }) =>
      /restaurant|dinner|küche|fine.?dining|gehobene/i.test(ledger.extraWishes?.value || ''),
  },

  {
    id: 'aiHardness',
    branch: 'allInclusive',
    depth: 1,
    topic: 'All-Inclusive Härte',
    fills: ['meals'],
    askSeed: 'Voll-AI, Soft-AI, oder nur Halbpension — und wie wichtig?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('allInclusive'),
    filled: ({ ledger }) =>
      ledger.meals?.value === 'all' ||
      /all.?inclusive|uai|soft.?ai|halbpension/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.lodgingKind?.value || ''}`,
      ),
  },
  {
    id: 'aiResortVsCity',
    branch: 'allInclusive',
    parentId: 'aiHardness',
    depth: 2,
    topic: 'Resort vs. Stadt',
    fills: ['locationBias', 'lodgingKind'],
    askSeed: 'Resort am Pool — oder Stadt mit Ausflügen?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('allInclusive'),
    filled: ({ ledger }) =>
      /resort|stadt|ausflug/i.test(
        `${ledger.locationBias?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ) || Boolean(ledger.lodgingKind),
  },

  {
    id: 'cityFood',
    branch: 'city',
    depth: 1,
    topic: 'Food-Niveau',
    fills: ['extraWishes', 'highlightWant'],
    askSeed: 'Food — Streetfood/Märkte, oder eher Abend-Restaurants? Vegetarisch relevant?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('city') &&
      /food|essen|gastro|kulinar|märkte|street.?food|foodie|vegetar/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /food|essen|gastro|markt|vegetar|restaurant/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.highlightWant?.value || ''}`,
      ),
  },
  {
    id: 'workationStay',
    branch: 'city',
    depth: 1,
    topic: 'Workation Stay',
    fills: ['lodgingKind', 'extraWishes'],
    askSeed: 'Apartment mit stabilem WLAN Pflicht — und wie viele Wochen?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('city') && /workation|remote|wlan|home.?office/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /wlan|apartment|arbeit|workation/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.lodgingKind?.value || ''}`,
      ),
  },
  {
    id: 'photoSpots',
    branch: 'city',
    depth: 1,
    topic: 'Foto / Aussicht',
    fills: ['highlightWant', 'extraWishes'],
    askSeed: 'Skyline / Architektur-Spots — goldene Stunde Pflicht?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('city') &&
      /foto|photogra|skyline|architektur|aussicht|goldene\s*stunde/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /foto|skyline|aussicht|architektur|stunde/i.test(
        `${ledger.highlightWant?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },

  {
    id: 'hikeFitness',
    branch: 'active',
    depth: 1,
    topic: 'Wander-Fitness',
    fills: ['extraWishes', 'highlightWant'],
    askSeed: 'Fitness-Niveau, Hütten ok, und Wetterfenster wichtig?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('active') &&
      /wander|trek|hütte|trail|berg/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /wander|fitness|hütte|trail|wetter/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.highlightWant?.value || ''}`,
      ),
  },
  {
    id: 'bikeStyle',
    branch: 'active',
    depth: 1,
    topic: 'Rad / E-Bike',
    fills: ['extraWishes'],
    askSeed: 'E-Bike Pref, Gepäck am Rad, und Etappen-km grob?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('active') &&
      /e.?bike|radtour|fahrrad|eurovelo|cycling/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /e.?bike|rad|etappe|km/i.test(ledger.extraWishes?.value || ''),
  },
  {
    id: 'surfSpot',
    branch: 'active',
    depth: 1,
    topic: 'Surf / Wassersport',
    fills: ['highlightWant', 'extraWishes'],
    askSeed: 'Spot schon klar — Kurs oder eigenes Board?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('active') &&
      /surf|wellen|wassersport|kite|paddle/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /surf|spot|board|kurs|kite/i.test(
        `${ledger.highlightWant?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },
  {
    id: 'beachPartyMix',
    branch: 'active',
    depth: 1,
    topic: 'Strand + Party Mix',
    fills: ['locationBias', 'extraWishes'],
    askSeed: 'Tag Strand, Nacht Club — Transfer spät ok?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('party') &&
      /(strand|beach).{0,24}(party|club)|(party|club).{0,24}(strand|beach)/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /strand|beach|transfer|club/i.test(
        `${ledger.locationBias?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },

  {
    id: 'skiLevel',
    branch: 'seasonal',
    depth: 1,
    topic: 'Ski-Niveau',
    fills: ['extraWishes', 'highlightWant'],
    askSeed: 'Ski-Niveau, Nähe Lift, Mietwagen nötig?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('seasonal'),
    filled: ({ ledger }) =>
      /ski|piste|lift|niveau|skipass/i.test(
        `${ledger.extraWishes?.value || ''} ${ledger.highlightWant?.value || ''}`,
      ),
  },
  {
    id: 'skiGear',
    branch: 'seasonal',
    parentId: 'skiLevel',
    depth: 2,
    topic: 'Ski Transfer / Auto',
    fills: ['needCar', 'extraWishes'],
    askSeed: 'Auto vor Ort — oder Shuttle zum Lift?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('seasonal'),
    filled: ({ ledger }) =>
      ledger.needCar != null ||
      /shuttle|mietwagen|lift/i.test(ledger.extraWishes?.value || ''),
  },

  {
    id: 'seniorPace',
    branch: 'senior',
    parentId: 'accessNeeds',
    depth: 2,
    topic: 'Tempo / Direktflug',
    fills: ['accessNeeds', 'directFlight', 'extraWishes'],
    askSeed: 'Max. Gehstrecke, Direktflug Prefer, Transfer door-to-door?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('senior'),
    filled: ({ ledger }) =>
      ledger.directFlight != null ||
      /gehstrecke|direkt|door.?to.?door|transfer/i.test(
        `${ledger.extraWishes?.value || ''} ${(ledger.accessNeeds?.value ?? []).join(' ')}`,
      ),
  },

  {
    id: 'lgbtqScene',
    branch: 'party',
    depth: 1,
    topic: 'Nightlife-Szene',
    fills: ['partyStyle', 'extraWishes'],
    askSeed: 'Welche Stadt-Szene schwebt vor — und Safe-Pref wichtig?',
    when: ({ ledger }) =>
      detectCatalogBranches(ledger).includes('party') &&
      /lgbtq|queer|pride|gay|schwulen|lesbisch/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      /szene|safe|pride|queer|lgbtq/i.test(
        `${ledger.partyStyle?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },

  {
    id: 'openClimate',
    branch: 'open_discover',
    depth: 1,
    topic: 'Klima-Fenster',
    fills: ['destinationHint', 'dateMonth'],
    askSeed: 'Welches Klima-Fenster — warm jetzt, oder Schulternaison ok?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('open_discover'),
    filled: ({ ledger }) =>
      Boolean(ledger.dateMonth) ||
      /warm|klima|schulter|sonne/i.test(
        `${ledger.destinationHint?.value || ''} ${ledger.extraWishes?.value || ''}`,
      ),
  },
  {
    id: 'openDealLead',
    branch: 'open_discover',
    depth: 1,
    topic: 'Deal-Lead',
    fills: ['dealHunt', 'budgetVibe'],
    askSeed: 'Deal-first — günstig schlägt Fix-Ziel?',
    when: ({ ledger }) => detectCatalogBranches(ledger).includes('open_discover'),
    filled: ({ ledger }) =>
      ledger.dealHunt != null ||
      ledger.budgetVibe?.value === 'cheap' ||
      /deal|günstig|egal\s*wohin/i.test(ledger.extraWishes?.value || ''),
  },

  {
    id: 'businessHours',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Business Flugfenster',
    fills: ['departAfterHour', 'extraWishes', 'directFlight'],
    askSeed: 'Kein Nachtflug — max Layover, Lounge egal?',
    when: ({ ledger }) =>
      /business|dienstreise|konferenz|nachtflug|lounge/i.test(blob(ledger)) &&
      (ledger.mode?.value === 'fly' || !ledger.mode),
    filled: ({ ledger }) =>
      ledger.directFlight != null ||
      /nachtflug|lounge|layover/i.test(ledger.extraWishes?.value || '') ||
      Boolean(ledger.departAfterHour),
  },
  {
    id: 'roadtripStages',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Roadtrip Etappen',
    fills: ['maxDriveHours', 'extraWishes'],
    askSeed: 'Max. Fahrzeit/Tag, Stellplätze, Fähre im Spiel?',
    when: ({ ledger }) =>
      ledger.tripShape?.value === 'roadtrip' ||
      /roadtrip|camper|wohnmobil|stellplatz/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      Boolean(ledger.maxDriveHours) ||
      /stellplatz|fähre|etappe|camper/i.test(ledger.extraWishes?.value || ''),
  },

  {
    id: 'driveTime',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Max. Auto-Fahrzeit',
    fills: ['maxDriveHours'],
    askSeed: 'Wie weit darf die Autofahrt maximal dauern?',
    when: ({ ledger }) =>
      ledger.mode?.value === 'drive' ||
      ledger.mode?.value === 'unknown' ||
      !ledger.mode,
    filled: ({ ledger }) => Boolean(ledger.maxDriveHours),
  },
  {
    id: 'maxRailH',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Max. Bahn-Dauer',
    fills: ['maxRailHours'],
    askSeed: 'Wie lange darf die Bahn maximal dauern?',
    when: ({ ledger }) =>
      (ledger.mode?.value === 'train' || ledger.modeFallback?.value === 'train') &&
      ledger.mode?.value !== 'mix' &&
      !ledger.maxDriveHours,
    filled: ({ ledger }) =>
      Boolean(ledger.maxRailHours) || Boolean(ledger.maxDriveHours),
  },
  {
    id: 'surfacePref',
    branch: 'mode_deep',
    depth: 1,
    topic: 'FlixTrain vs Bus',
    fills: ['surfacePref'],
    askSeed: 'Bei Spar-Anreise: Zug (FlixTrain) ok — Fernbus eher nicht?',
    when: ({ ledger }) =>
      ledger.mode?.value === 'train' ||
      ledger.mode?.value === 'mix' ||
      ledger.budgetVibe?.value === 'cheap' ||
      ledger.dealHunt?.value === true ||
      /sparfuchs|günstig|billig|hostel|flix|budget|spar.?reise/i.test(blob(ledger)),
    filled: ({ ledger }) =>
      Boolean(ledger.surfacePref) ||
      (ledger.mode?.value === 'fly' &&
        !/sparfuchs|günstig|billig|hostel|flix|budget/i.test(blob(ledger)) &&
        ledger.budgetVibe?.value !== 'cheap' &&
        ledger.dealHunt?.value !== true),
  },
  {
    id: 'directFlight',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Direktflug',
    fills: ['directFlight'],
    askSeed: 'Direktflug Pflicht, oder Umsteigen okay?',
    when: ({ ledger }) => ledger.mode?.value === 'fly' || !ledger.mode,
    filled: ({ ledger }) => ledger.directFlight != null,
  },
  {
    id: 'layover',
    branch: 'mode_deep',
    parentId: 'directFlight',
    depth: 2,
    topic: 'Max. Layover',
    fills: ['maxLayoverHours', 'flightComfort'],
    askSeed: 'Wie lang darf ein Zwischenstopp maximal sein?',
    when: ({ ledger }) =>
      ledger.mode?.value === 'fly' && ledger.directFlight?.value !== true,
    filled: ({ ledger }) =>
      ledger.maxLayoverHours != null ||
      ledger.flightComfort?.value?.maxLayoverHours != null,
  },
  {
    id: 'flightHours',
    branch: 'mode_deep',
    parentId: 'directFlight',
    depth: 2,
    topic: 'Max. Flugdauer',
    fills: ['extraWishes'],
    askSeed: 'Wie lange darf der Flug maximal dauern?',
    when: ({ ledger }) => ledger.mode?.value === 'fly' || ledger.directFlight === true,
    filled: ({ ledger }) =>
      /flug.{0,12}(h|std|stunde)|max.{0,8}flug|nicht länger als \d/i.test(
        ledger.extraWishes?.value || '',
      ),
  },
  {
    id: 'departWindow',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Los- / Ankunftsfenster',
    fills: ['departAfterHour', 'arriveBeforeHour', 'whenFlex'],
    askSeed: 'Ab wann könnt ihr los, und wie spät ankommen?',
    when: ({ ledger }) => Boolean(ledger.mode),
    filled: ({ ledger }) =>
      Boolean(
        ledger.departAfterHour ||
          ledger.arriveBeforeHour ||
          ledger.whenFlex?.value?.outbound?.earliestHour != null,
      ),
  },
  {
    id: 'whenFlex',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Zeitfenster Prefer / Soft',
    fills: ['whenFlex', 'departAfterHour'],
    askSeed:
      'Am liebsten welcher Tag los — und welcher geht auch (z. B. ab einer Uhrzeit)? Rück: Prefer-Tag vs. Soft?',
    when: ({ ledger }) =>
      hasWhenLocal(ledger) &&
      Boolean(ledger.mode) &&
      !ledger.whenFlex &&
      (Boolean(ledger.arrivalFlexDays || ledger.departureFlexDays) ||
        ledger.dateFlex?.value === 'open' ||
        ledger.dateFlex?.value === 'month' ||
        (Boolean(ledger.dateStart) && !ledger.dateEnd)),
    filled: ({ ledger }) =>
      Boolean(ledger.whenFlex?.value?.outbound || ledger.whenFlex?.value?.return) ||
      (Boolean(ledger.dateStart?.value && ledger.dateEnd?.value) &&
        !ledger.arrivalFlexDays &&
        !ledger.departureFlexDays),
  },
  {
    id: 'bags_deep',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Gepäck (Nachschärfen)',
    fills: ['cabinBags', 'checkedBags'],
    askSeed: 'Gepäck nochmal: nur Handgepäck, oder Aufgabe — wie viele Stück?',
    when: ({ ledger }) =>
      ledger.mode?.value === 'fly' &&
      ledger.bookedFlight?.value !== true &&
      ledger.cabinBags == null &&
      ledger.checkedBags == null,
    filled: ({ ledger }) => ledger.cabinBags != null || ledger.checkedBags != null,
  },
  {
    id: 'transfer',
    branch: 'mode_deep',
    depth: 1,
    topic: 'Transfer Hub→Unterkunft',
    fills: ['transferPref', 'bookedTransfer'],
    askSeed: 'Transfer vom Bahnhof/Flughafen — Taxi, ÖPNV oder schon klar?',
    when: ({ ledger }) => ledger.mode?.value === 'fly' || ledger.mode?.value === 'train',
    filled: ({ ledger }) =>
      ledger.bookedTransfer?.value === true || ledger.transferPref != null,
  },
];

export function buildCatalogCtx(
  ledger: ReiseLedger,
  asked: string[] = [],
  extras: CatalogExtra[] = [],
): CatalogCtx {
  return {
    ledger,
    vibes: detectTripVibes(ledger),
    asked,
    extras,
  };
}

export function isQuestionOpen(q: CatalogQuestion, ctx: CatalogCtx): boolean {
  if (ctx.asked.includes(q.id)) return false;
  if (q.when && !q.when(ctx)) return false;
  if (q.filled(ctx)) return false;
  if (q.parentId) {
    const parent = QUESTION_CATALOG.find((x) => x.id === q.parentId);
    if (parent && !parent.filled(ctx) && !ctx.asked.includes(parent.id)) return false;
  }
  return true;
}

const MASTER_HARD = new Set([
  'purpose',
  'adults',
  'when',
  'budget',
  'origin',
  'lodging',
  'bookedBits',
  'needCar',
  'mode',
  'bags',
]);

/**
 * Nächste Katalog-Frage:
 * Master-Hart → aktive Branches (Tiefe 1) → restliche Master → Extras → Tiefe 2.
 */
export function nextCatalogQuestion(
  ledger: ReiseLedger,
  asked: string[] = [],
  extras: CatalogExtra[] = [],
  userLine = '',
): { id: string; topic: string; askSeed: string; branch: CatalogBranch } | null {
  let askedMerged = asked;
  try {
    const { mergeShelfIntoAsked, hydrateShelfAsked } = require('./shelfAskedPrefs') as typeof import('./shelfAskedPrefs');
    void hydrateShelfAsked();
    askedMerged = mergeShelfIntoAsked(ledger, asked);
  } catch {
    askedMerged = asked;
  }
  const ctx = buildCatalogCtx(ledger, askedMerged, extras);
  const branches = new Set(detectCatalogBranches(ledger, userLine));

  const masterHardOpen = QUESTION_CATALOG.filter(
    (q) => q.branch === 'master' && MASTER_HARD.has(q.id) && isQuestionOpen(q, ctx),
  );
  if (masterHardOpen[0]) {
    const q = masterHardOpen[0]!;
    return { id: q.id, topic: q.topic, askSeed: q.askSeed, branch: q.branch };
  }

  for (const depth of [1, 2] as const) {
    for (const q of QUESTION_CATALOG) {
      if (q.depth !== depth) continue;
      if (q.branch === 'master') continue;
      if (!branches.has(q.branch)) continue;
      if (!isQuestionOpen(q, ctx)) continue;
      return { id: q.id, topic: q.topic, askSeed: q.askSeed, branch: q.branch };
    }
  }

  const masterSoftOpen = QUESTION_CATALOG.filter(
    (q) => q.branch === 'master' && !MASTER_HARD.has(q.id) && isQuestionOpen(q, ctx),
  );
  if (masterSoftOpen[0]) {
    const q = masterSoftOpen[0]!;
    return { id: q.id, topic: q.topic, askSeed: q.askSeed, branch: q.branch };
  }

  const extraOpen = extras.find((e) => !e.done && !asked.includes(e.id));
  if (extraOpen) {
    return {
      id: extraOpen.id,
      topic: extraOpen.topic,
      askSeed: extraOpen.askSeed,
      branch: extraOpen.branch || 'master',
    };
  }

  return null;
}

export function catalogIdsPossiblyAnswered(
  ledgerBefore: ReiseLedger,
  ledgerAfter: ReiseLedger,
): string[] {
  const before = buildCatalogCtx(ledgerBefore, []);
  const after = buildCatalogCtx(ledgerAfter, []);
  const hit: string[] = [];
  for (const q of QUESTION_CATALOG) {
    if (!q.filled(before) && q.filled(after)) hit.push(q.id);
  }
  return hit;
}

/**
 * Wenn die Antwort vage/mehrdeutig ist oder Research-kritisch unklar bleibt:
 * Extra-Frage in den Katalog legen (Yorro darf ergänzen).
 */
export function maybeProposeCatalogExtra(
  ledger: ReiseLedger,
  userLine: string,
  lastAskedKey: string | null,
): CatalogExtra | null {
  const t = (userLine || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.length < 4) return null;
  const vague =
    /\b(keine\s+ahnung|egal|weiss\s+nicht|weiß\s+nicht|irgendwie|vielleicht|mal\s+schauen|kommt\s+drauf\s+an)\b/i.test(
      t,
    );
  const idBase = `extra_${(lastAskedKey || 'clar').slice(0, 18)}_${t.slice(0, 12).replace(/\W+/g, '')}`;

  if (vague && lastAskedKey === 'when') {
    return {
      id: `${idBase}_when`,
      topic: 'Zeitfenster nachschärfen',
      askSeed: 'Grober Monat reicht — oder eher ein konkretes Wochenende?',
      branch: 'master',
    };
  }
  if (vague && lastAskedKey === 'budget') {
    return {
      id: `${idBase}_budget`,
      topic: 'Budget-Rahmen',
      askSeed: 'Eher sparsam, mittel, oder darf’s etwas mehr sein?',
      branch: 'master',
    };
  }
  if (vague && (lastAskedKey === 'mode' || lastAskedKey === 'dest')) {
    return {
      id: `${idBase}_mode`,
      topic: 'Anreise-Grenzen',
      askSeed: 'Wie weit darf Auto, Bahn oder Flug maximal dauern?',
      branch: 'mode_deep',
    };
  }
  if (
    /spa|wellness|massage|therme|sauna/.test(t) &&
    !detectCatalogBranches(ledger, t).includes('spa') &&
    !ledger.spaStyle
  ) {
    return {
      id: `${idBase}_spa`,
      topic: 'Spa nachziehen',
      askSeed: 'Pool, Meer, Massage, Sauna — was ist der Kern?',
      branch: 'spa',
    };
  }
  if (
    /party|feiern|club|bars?/.test(t) &&
    !ledger.partyGrain &&
    !ledger.partyStyle
  ) {
    return {
      id: `${idBase}_party`,
      topic: 'Party-Stil nachziehen',
      askSeed: 'Eher privat unter euch, Bars, oder Clubs?',
      branch: 'party',
    };
  }
  // Missverständnis-Risiko: Antwort widerspricht letztem Slot-Kontext stark
  if (
    lastAskedKey === 'origin' &&
    /\b(nicht|nee|nein)\b/.test(t) &&
    /\b(sondern|doch|eigentlich)\b/.test(t)
  ) {
    return {
      id: `${idBase}_origin`,
      topic: 'Startort klarstellen',
      askSeed: 'Von welcher Stadt startet ihr genau?',
      branch: 'master',
    };
  }
  return null;
}
