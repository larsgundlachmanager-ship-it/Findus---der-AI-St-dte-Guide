/**
 * @deprecated UI nutzt nur noch `llmFlipchartNotes` (LLM-Labels).
 * Diese Builder bleiben für Offline-Smokes / Ledger-Coverage — nicht für Board-Text.
 */
/**
 * Flipchart-Notizen aus dem Ledger — Sticker, kein Protokoll, kein Radar-Kreis.
 */

import type { MustHaveId, ReiseLedger } from './types';
import { hasUserBudget } from './completeness';
import { looksLikeGarbageFact } from './parseBriefSlots';
import { isJunkPlaceName } from './placeNameSanity';
import { looksLikeWishDumpPurpose, splitWishPhrases } from './tripPurpose';

const AIRPORT_CITIES = new Set(
  [
    'Hamburg',
    'Bremen',
    'Berlin',
    'Hannover',
    'Köln',
    'Düsseldorf',
    'Frankfurt',
    'München',
    'Stuttgart',
    'Dortmund',
  ].map((c) => c.toLowerCase()),
);

function isAirportCityName(name: string): boolean {
  return AIRPORT_CITIES.has((name || '').trim().toLowerCase());
}

export type NoteTier = 'critical' | 'high' | 'wish' | 'optional' | 'nope';

export type FlipchartNote = {
  id: string;
  tier: NoteTier;
  emoji: string;
  label: string;
  /** Sticky-Kategorie (TERMIN, GRUPPE…) — Papier-Look */
  category?: string;
  hint?: string;
  fresh?: boolean;
};

/** Lange Freitext-Sticker kürzen — Flipchart bleibt lesbar. */
export function compactNoteLabel(raw: string, max = 28): string {
  const s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 10 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Passendes Emoji für Flipchart-Sticker — Pins nur wenn Lage/Ort wirklich passt. */
export function emojiForWishText(raw: string, fallback = '✨'): string {
  const t = (raw || '').toLowerCase();
  if (!t.trim()) return fallback === '📌' || fallback === '📍' ? '✨' : fallback;
  if (/^[📌📍✨📝]$/u.test(t.trim())) return '✨';

  // Gruppe / Personen
  if (
    /\b(leute|personen|erwachsene|teilnehmer|reisende|paar|zu zweit|familie|gruppe|männer|maenner|\d+\s*×|\d+\s*x)\b/.test(
      t,
    )
  ) {
    if (/kind|kids|baby|familie/.test(t)) return '🧒';
    if (/paar|zu zweit|2\s*(leute|personen|erwachsene)/.test(t)) return '💑';
    return '👥';
  }
  // Zeitraum / Datum / Nächte
  if (
    /\b(anreise|abreise|reisezeit|reisedaten|nacht|nächte|uebernachtung|übernachtung|aufenthalt|tage|wochenende|september|oktober|november|dezember|januar|februar|märz|maerz|april|mai|juni|juli|august|\d{1,2}\.\d{1,2}\.?|\d{1,2}\.\s*(jan|feb|mär|apr|mai|jun|jul|aug|sep|okt|nov|dez)|\d{4})\b/.test(
      t,
    )
  ) {
    return '📅';
  }
  if (/strand|beach|sand/.test(t)) return '🏖️';
  if (/whirl|jacuzzi|whirlpool/.test(t)) return '♨️';
  if (/pool|schwimmen|baden/.test(t)) return '🏊';
  if (/meer|see|wasser|hafen|boot|segeln|yacht/.test(t)) return '🌊';
  if (/sonne|warm|hitze|sommer|wetter/.test(t)) return '☀️';
  if (/regen|kühl|kalt|schnee/.test(t)) return '🌧️';
  if (/berg|wandern|hike|gipfel/.test(t)) return '🥾';
  if (/ski|piste/.test(t)) return '⛷️';
  if (/hausparty|privat|bude|unter uns|unter euch/.test(t)) return '🏠';
  if (/club|disco|techno|tanz/.test(t)) return '🪩';
  if (/party|feiern|nightlife|open\s*air|festival|partymöglich/.test(t)) return '🎉';
  if (/\bbar\b|bars/.test(t)) return '🍸';
  if (/bier|drinks|cocktails|wein/.test(t)) return /wein/.test(t) ? '🍷' : '🍺';
  if (/essen|food|restaurant|kochen|grill|verpflegung|halbpension|all.?inclusive|selbstversorgung/.test(t)) {
    return /grill/.test(t) ? '🍖' : '🍽️';
  }
  if (/frühstück|fruehstueck|breakfast/.test(t)) return '🥐';
  if (/spa|sauna|wellness|massage/.test(t)) return '🧖';
  if (/kind|kids|baby|familie/.test(t)) return '🧒';
  if (/hund|dog|haustier/.test(t)) return '🐕';
  if (/rad|bike|fahrrad/.test(t)) return '🚲';
  if (/öpnv|oepnv|tram|metro|u-bahn|s-bahn/.test(t)) return '🚇';
  if (/auto|mietwagen|fahren|roadtrip|anfahrt|transfer/.test(t)) return '🚗';
  if (/flug|flughafen|abflug|direktflug|direkt|gepäck|handgepäck|koffer|reisemittel:\s*flug/.test(t)) {
    return '✈️';
  }
  if (/zug|bahn|train|bahncard|reisemittel:\s*bahn/.test(t)) return '🚆';
  if (/bus|fernbus/.test(t)) return '🚌';
  if (/hotel|apartment|ferienhaus|unterkunft|airbnb|camping|wohnung|übernacht/.test(t)) {
    if (/camping/.test(t)) return '⛺';
    if (/ferienhaus|haus/.test(t)) return '🏡';
    if (/apartment|wohnung|airbnb/.test(t)) return '🔑';
    return '🏨';
  }
  if (/budget|günstig|guenstig|preis|schnäppchen|schnaeppchen|deal|€|euro|p\.?\s*p\.?/.test(t)) {
    return /schnäppchen|schnaeppchen|deal/.test(t) ? '🔥' : '💶';
  }
  if (/ruhig|stille|entspann|chill/.test(t)) return '😌';
  if (/aktiv|outdoor|sport|padel|tennis|spike/.test(t)) return '🏃';
  if (/blick|aussicht|view|sunset|sonnenuntergang/.test(t)) return '🌅';
  if (/foto|instagram|schön|schoen|standard/.test(t)) return '📸';
  if (/alter|\d+\s*jahre|junge|mädchen/.test(t)) return '🎂';
  if (/anlass|zweck|männerwochenende|maennerwochenende|reiseart|reisezweck/.test(t)) return '🎯';
  if (
    /\b(abflug|start|von)\b/.test(t) ||
    /\b(hamburg|berlin|münchen|muenchen|köln|koeln|frankfurt|prisdorf)\b/.test(t)
  ) {
    if (/flug|abflug/.test(t)) return '✈️';
    return '🏠';
  }
  if (/richtung|ziel|korridor|nach\s+\p{L}|irgendwo|offen/.test(t)) return emojiForDestination(t);
  if (/kein|ohne|nicht|no-go|nie|muss:\s*kein/.test(t)) return '🚫';
  if (/idee|tipp|vorschlag|wunsch/.test(t)) return '💡';
  if (/frage|\?/.test(t)) return '❓';
  if (/muss|must-?have|pflicht/.test(t)) return '⭐';

  // Nur echte Lage/Ort-Labels dürfen 📍 — nie 📌
  if (fallback === '📍' || /\b(lage|ort|stadt|pin|karte)\b/.test(t)) return '📍';
  if (fallback === '📌') return '✨';
  return fallback === '📌' || fallback === '📍' ? '✨' : fallback;
}

/** true wenn Emoji eine Pinnadel ist (nie Default auf Stickern). */
export function isPinNeedleEmoji(emoji: string): boolean {
  return /^[📌]$/u.test((emoji || '').trim());
}

function emojiForDestination(dest: string): string {
  const t = dest.toLowerCase();
  if (/griech|kreta|rhodos|santorini|athen|kos|korfu/.test(t)) return '🇬🇷';
  if (/spanien|mallorca|ibiza|barcelona|teneriffa|kanar/.test(t)) return '🇪🇸';
  if (/italien|toskana|sizilien|sardinien|rom|mailand/.test(t)) return '🇮🇹';
  if (/frankreich|paris|côte|provence/.test(t)) return '🇫🇷';
  if (/portugal|algarve|lissabon/.test(t)) return '🇵🇹';
  if (/türkei|antalya|bodrum/.test(t)) return '🇹🇷';
  if (/kroat|dalmat|split|dubrovnik/.test(t)) return '🇭🇷';
  if (/österreich|wien|tirol|salzburg/.test(t)) return '🇦🇹';
  if (/schweiz|zürich|bern/.test(t)) return '🇨🇭';
  if (/niederland|amsterdam/.test(t)) return '🇳🇱';
  if (/däni|kopenhagen/.test(t)) return '🇩🇰';
  if (/schweden|stockholm/.test(t)) return '🇸🇪';
  if (/norweg|oslo|fjord/.test(t)) return '🇳🇴';
  if (/thailand|bangkok|phuket/.test(t)) return '🇹🇭';
  if (/usa|florida|new york|kalifornien/.test(t)) return '🇺🇸';
  if (/insel|meer|strand|küste/.test(t)) return '🏝️';
  if (/berg|alpen/.test(t)) return '⛰️';
  return '🗺️';
}

function modeEmoji(m: string): string {
  if (m === 'fly') return '✈️';
  if (m === 'drive') return '🚗';
  if (m === 'train') return '🚆';
  if (m === 'bike') return '🚲';
  if (m === 'daytrip') return '🧭';
  if (m === 'hike') return '🥾';
  if (m === 'camping') return '⛺';
  return '🧭';
}

function moodEmoji(mood: string): string {
  const t = mood.toLowerCase();
  if (/club|disco|techno|tanz/.test(t)) return '🪩';
  if (/hausparty|privat|bude|unter uns|unter euch/.test(t)) return '🏠';
  if (/bar|kneipe|cocktail/.test(t)) return '🍸';
  if (/open\s*air|festival/.test(t)) return '🎪';
  if (/live|konzert/.test(t)) return '🎶';
  if (/strand/.test(t)) return '🏖️';
  return '🎉';
}

const MUST_META: Record<MustHaveId, { emoji: string; label: string; tier: NoteTier }> = {
  sand: { emoji: '🏖️', label: 'Sandstrand', tier: 'critical' },
  pool: { emoji: '🏊', label: 'Pool', tier: 'critical' },
  ferienhaus: { emoji: '🏡', label: 'Ferienhaus', tier: 'critical' },
  sea: { emoji: '🌊', label: 'Am Wasser', tier: 'critical' },
  view: { emoji: '🌅', label: 'Ausblick', tier: 'high' },
  warm: { emoji: '☀️', label: 'Warm / Sonne', tier: 'high' },
  grill: { emoji: '🍖', label: 'Grill', tier: 'high' },
  boat: { emoji: '🚤', label: 'Boot', tier: 'high' },
  rental_car: { emoji: '🚗', label: 'Mietwagen', tier: 'high' },
  padel: { emoji: '🎾', label: 'Padel', tier: 'high' },
  spikeball: { emoji: '🏐', label: 'Spikeball', tier: 'high' },
  paddle: { emoji: '🛶', label: 'Paddeln', tier: 'wish' },
  apartment: { emoji: '🔑', label: 'Ferienwohnung', tier: 'wish' },
  hotel: { emoji: '🏨', label: 'Hotel', tier: 'wish' },
  camping: { emoji: '⛺', label: 'Camping', tier: 'wish' },
  party: { emoji: '🎉', label: 'Party', tier: 'wish' },
  vegan: { emoji: '🌱', label: 'Vegan', tier: 'wish' },
  no_carpet: { emoji: '🚫', label: 'Ohne Teppich', tier: 'wish' },
  spa: { emoji: '🧖', label: 'Spa', tier: 'high' },
  sauna: { emoji: '♨️', label: 'Sauna', tier: 'wish' },
  massage: { emoji: '💆', label: 'Massage', tier: 'wish' },
  tennis: { emoji: '🎾', label: 'Tennis', tier: 'high' },
  wine: { emoji: '🍷', label: 'Wein', tier: 'high' },
  cruise: { emoji: '🛳️', label: 'Kreuzfahrt', tier: 'high' },
  ferry: { emoji: '⛴️', label: 'Fähre', tier: 'high' },
  river_cruise: { emoji: '🏞️', label: 'Flusskreuzfahrt', tier: 'high' },
  water_slide: { emoji: '💦', label: 'Wasserrutsche', tier: 'wish' },
  paddle_board: { emoji: '🏄', label: 'Paddel an Bord', tier: 'wish' },
  culinary: { emoji: '🍽️', label: 'Kulinarik', tier: 'wish' },
  kids_club: { emoji: '🧒', label: 'Kids-Club', tier: 'high' },
  teens_club: { emoji: '🧑', label: 'Teens-Club', tier: 'wish' },
  running_track: { emoji: '🏃', label: 'Laufbahn', tier: 'wish' },
  seniors: { emoji: '🧓', label: 'Senioren-/Ruhe-Tempo', tier: 'wish' },
  adult_only: { emoji: '🔞', label: 'Adult-only', tier: 'high' },
  riding: { emoji: '🐴', label: 'Reiten', tier: 'wish' },
  parking: { emoji: '🅿️', label: 'Parkplatz', tier: 'critical' },
  baby_bed: { emoji: '🍼', label: 'Babybett', tier: 'critical' },
  breakfast: { emoji: '🥐', label: 'Frühstück', tier: 'high' },
  half_board: { emoji: '🍽️', label: 'Halbpension', tier: 'high' },
  quiet: { emoji: '🤫', label: 'ruhig', tier: 'high' },
  short_transfer: { emoji: '🚐', label: 'kurzer Transfer', tier: 'critical' },
  small_hotel: { emoji: '🏡', label: 'kleineres Hotel', tier: 'high' },
};

/** Kategorie-Label für Papier-Sticker (Konzept: TERMIN / GRUPPE / …). */
export function noteCategory(note: Pick<FlipchartNote, 'id' | 'hint' | 'label'>): string {
  if (note.hint && note.hint.length <= 14 && !/Intention/i.test(note.hint)) {
    return note.hint.toUpperCase();
  }
  const id = note.id.replace(/^(must|wish|nice|no):/, '');
  const map: Record<string, string> = {
    when: 'TERMIN',
    adults: 'GRUPPE',
    origin: 'START',
    origins: 'START',
    budget: 'BUDGET',
    budgetVibe: 'BUDGET',
    dest: 'ZIELE',
    purpose: 'ART',
    lodging: 'UNTERKUNFT',
    meals: 'ESSEN',
    weather: 'KLIMA',
    drive: 'ANFAHRT',
    mode: 'ANREISE',
    party: 'NACHTLEBEN',
    partyStyle: 'STIMMUNG',
    spa: 'SPA',
    spaStyle: 'SPA',
    kids: 'KINDER',
    kidsStyle: 'KINDER',
    energy: 'ENERGIE',
    inspo: 'STIL',
    idea: 'IDEE',
    highlight: 'HIGHLIGHT',
    wantH: 'HIGHLIGHT',
    lastH: 'ERINNERUNG',
    deal: 'NO-GO',
    extra: 'WUNSCH',
    transfer: 'TRANSFER',
    bookedStay: 'GEBUCHT',
    bookedFlight: 'GEBUCHT',
    bookedTransfer: 'GEBUCHT',
  };
  if (map[id]) return map[id];
  if (map[note.id]) return map[note.id];
  if (/^must:|^wish:|^nice:/.test(note.id)) {
    const key = note.id.split(':')[1] || '';
    if (map[key]) return map[key];
    return (MUST_META[key as MustHaveId]?.label || key).slice(0, 12).toUpperCase();
  }
  if (note.id.startsWith('intent_')) return 'IDEE';
  if (note.id.startsWith('no:')) return 'NO-GO';
  return 'NOTIZ';
}

const MONTH_DE: Record<string, string> = {
  '01': 'Januar',
  '02': 'Februar',
  '03': 'März',
  '04': 'April',
  '05': 'Mai',
  '06': 'Juni',
  '07': 'Juli',
  '08': 'August',
  '09': 'September',
  '10': 'Oktober',
  '11': 'November',
  '12': 'Dezember',
};

function formatDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Termin notiert';
  return `${Number(m[3])}.${Number(m[2])}.`;
}

/** Getrennte Zeit-Stickers: Anreise / Abreise / Spanne / Nächte / Flex. */
function pushWhenNotes(notes: FlipchartNote[], ledger: ReiseLedger): void {
  const flex = ledger.dateFlex?.value;
  const start = ledger.dateStart?.value;
  const end = ledger.dateEnd?.value;
  const anchor = ledger.dateAnchor?.value;
  const nights = ledger.stayNights?.value;
  const nightsMax = ledger.stayNightsMax?.value;
  const days = ledger.stayDays?.value;
  const monthName = ledger.dateMonth?.value
    ? MONTH_DE[ledger.dateMonth.value.slice(5, 7)] ?? null
    : start
      ? MONTH_DE[start.slice(5, 7)] ?? null
      : end
        ? MONTH_DE[end.slice(5, 7)] ?? null
        : null;
  const part =
    ledger.datePart?.value === 'early'
      ? 'Anfang'
      : ledger.datePart?.value === 'late'
        ? 'Ende'
        : ledger.datePart?.value === 'mid'
          ? 'Mitte'
          : null;

  if (anchor === 'depart' && end) {
    notes.push({
      id: 'depart',
      tier: 'critical',
      emoji: '🛫',
      label: `Abreise ${formatDay(end)}`,
      hint: 'Termin',
    });
    if (flex === 'open' || flex === 'month') {
      notes.push({
        id: 'arriveFlex',
        tier: 'wish',
        emoji: '🧘',
        label: 'davor flexibel',
        hint: 'Anreise',
      });
    }
  } else if (anchor === 'arrive' && start && !end) {
    notes.push({
      id: 'arrive',
      tier: 'critical',
      emoji: '🛬',
      label: `Anreise ${formatDay(start)}`,
      hint: 'Start',
    });
  } else if (start && end) {
    const returnSoft =
      ledger.dateEnd?.hardness === 'optional' ||
      (ledger.dateAnchor?.value === 'arrive' && ledger.dateFlex?.value === 'open');
    if (ledger.dateAnchor?.value === 'presence') {
      notes.push({
        id: 'presence',
        tier: 'critical',
        emoji: '📍',
        label: `Da ${formatDay(start)}–${formatDay(end)}`,
        hint: 'Muss',
      });
      const aFlex = ledger.arrivalFlexDays?.value;
      const dFlex = ledger.departureFlexDays?.value;
      if (aFlex != null && aFlex > 0) {
        notes.push({
          id: 'arriveFlexDays',
          tier: 'wish',
          emoji: '🧘',
          label:
            aFlex === 1
              ? 'Anreise 1 Tag früher ok'
              : `Anreise bis ${aFlex} Tage früher ok`,
          hint: 'Flex',
        });
      }
      if (dFlex != null && dFlex > 0) {
        notes.push({
          id: 'departFlexDays',
          tier: 'wish',
          emoji: '🧘',
          label:
            dFlex === 1
              ? 'Abreise 1 Tag später ok'
              : `Abreise bis ${dFlex} Tage später ok`,
          hint: 'Flex',
        });
      }
    } else if (returnSoft) {
      notes.push({
        id: 'arrive',
        tier: 'critical',
        emoji: '🛬',
        label: `Anreise ${formatDay(start)}`,
        hint: 'Start',
      });
      notes.push({
        id: 'depart',
        tier: 'optional',
        emoji: '🛫',
        label: `Rückreise ${formatDay(end)} optional`,
        hint: 'Rück',
      });
    } else {
      // Klare An-/Abreise statt nur Spanne — Abflugdatum sichtbar
      notes.push({
        id: 'arrive',
        tier: 'critical',
        emoji: '🛬',
        label: `Anreise ${formatDay(start)}`,
        hint: 'Start',
      });
      notes.push({
        id: 'depart',
        tier: 'critical',
        emoji: '🛫',
        label: `Abreise ${formatDay(end)}`,
        hint: 'Rück',
      });
      const aFlex = ledger.arrivalFlexDays?.value;
      const dFlex = ledger.departureFlexDays?.value;
      if (aFlex != null && aFlex > 0) {
        notes.push({
          id: 'arriveFlexDays',
          tier: 'wish',
          emoji: '🧘',
          label:
            aFlex === 1
              ? 'Anreise 1 Tag früher ok'
              : `Anreise bis ${aFlex} Tage früher ok`,
          hint: 'Flex',
        });
      }
      if (dFlex != null && dFlex > 0) {
        notes.push({
          id: 'departFlexDays',
          tier: 'wish',
          emoji: '🧘',
          label:
            dFlex === 1
              ? 'Abreise 1 Tag später ok'
              : `Abreise bis ${dFlex} Tage später ok`,
          hint: 'Flex',
        });
      }
    }
  } else if (start && flex === 'exact') {
    notes.push({
      id: 'arrive',
      tier: 'critical',
      emoji: '🛬',
      label: `Anreise ${formatDay(start)}`,
      hint: 'Start',
    });
  } else {
    const soft: string[] = [];
    if (part && monthName) soft.push(`${part} ${monthName}`);
    else if (monthName && flex !== 'exact') soft.push(monthName);
    if (flex === 'weekend') soft.push('Wochenende');
    if (flex === 'open' && !soft.length) soft.push('Zeit flexibel');
    if (soft.length) {
      notes.push({
        id: 'when',
        tier: flex === 'open' ? 'wish' : 'critical',
        emoji: '📅',
        label: soft.join(' · '),
        hint: 'Zeit',
      });
    }
  }

  if (nights != null && nightsMax != null && nightsMax > nights) {
    notes.push({
      id: 'nights',
      tier: 'wish',
      emoji: '🌙',
      label: `${nights}–${nightsMax} Nächte`,
      hint: 'Dauer',
    });
  } else if (nights != null && !(start && end) && anchor !== 'span') {
    notes.push({
      id: 'nights',
      tier: 'wish',
      emoji: '🌙',
      label: nights === 1 ? '1 Nacht' : `${nights} Nächte`,
      hint: 'Dauer',
    });
  } else if (nights == null && days != null && !(start && end)) {
    const label =
      days % 7 === 0
        ? days / 7 === 1
          ? '1 Woche'
          : `${days / 7} Wochen`
        : `${days} Tage`;
    notes.push({ id: 'nights', tier: 'wish', emoji: '🌙', label, hint: 'Dauer' });
  } else if (start && end && nights != null && nightsMax == null) {
    // Kurzer Dauer-Hinweis neben festem Span
    notes.push({
      id: 'nights',
      tier: 'wish',
      emoji: '🌙',
      label: nights === 1 ? '1 Nacht' : `${nights} Nächte`,
      hint: 'Dauer',
    });
  }
}

function lodgingName(k: string): string {
  if (k === 'apartment' || k === 'airbnb') return 'Apartment';
  if (k === 'ferienhaus') return 'Ferienhaus';
  if (k === 'hostel') return 'Hostel';
  if (k === 'hotel') return 'Hotel';
  return k[0]!.toUpperCase() + k.slice(1);
}

const LODGING_IDS = new Set(['apartment', 'hotel', 'camping', 'ferienhaus']);

export type FlipchartBuildOpts = {
  /**
   * Offene Briefing-Frage — nur als kurzer ❓-Sticker (Thema),
   * nie der volle Speech-Satz. Inhalt kommt erst mit der Antwort.
   */
  openQuestion?: string | null;
  /** Slot-Key der offenen Frage → Kurzlabel „Lage?“ */
  openAskKey?: string | null;
  /** Letzte User-Antwort als Sticker, falls noch kein Slot greift. */
  lastUserLine?: string | null;
};

export function buildFlipchartNotes(
  ledger: ReiseLedger,
  opts?: FlipchartBuildOpts,
): FlipchartNote[] {
  const notes: FlipchartNote[] = [];

  const askKey = (opts?.openAskKey || '').trim() || null;
  const openLabel = (() => {
    try {
      const { shortOpenAskLabel } = require('./boardPins') as typeof import('./boardPins');
      return shortOpenAskLabel(askKey, opts?.openQuestion);
    } catch {
      return askKey ? `${askKey}?` : opts?.openQuestion ? '?' : '';
    }
  })();
  if (openLabel || opts?.openQuestion || askKey) {
    notes.push({
      id: 'openQ',
      tier: 'high',
      emoji: '❓',
      label: openLabel || '?',
      hint: 'Offen',
    });
  }

  pushWhenNotes(notes, ledger);

  if (ledger.adults?.source === 'user' || ledger.adults?.source === 'profile') {
    const n = ledger.adults.value;
    notes.push({
      id: 'people',
      tier: 'critical',
      emoji: '👥',
      label: n === 1 ? 'Allein' : `${n} Leute`,
      hint: 'Gruppe',
    });
  } else if (ledger.adults?.source === 'inferred' && ledger.adults.value) {
    notes.push({
      id: 'people',
      tier: 'optional',
      emoji: '👥',
      label: `ca. ${ledger.adults.value}?`,
      hint: 'Gruppe noch bestätigen',
    });
  }
  if (ledger.children && ledger.children.value > 0) {
    notes.push({
      id: 'kids',
      tier: 'critical',
      emoji: '🧒',
      label: ledger.children.value === 1 ? '1 Kind' : `${ledger.children.value} Kinder`,
    });
  }

  if (ledger.originCity?.source === 'user' && !isJunkPlaceName(ledger.originCity.value)) {
    const multiAir = Boolean(
      ledger.originCities?.value?.length && ledger.originCities.value.length >= 2,
    );
    const homeIsAirport =
      multiAir &&
      ledger.originCities!.value.some(
        (c) => c.toLowerCase() === ledger.originCity!.value.toLowerCase(),
      );
    // Heimat/Start zeigen — außer die Stadt ist schon als Abflug-Chip in der Multi-Liste
    if (!homeIsAirport) {
      const airportCity = isAirportCityName(ledger.originCity.value);
      const flyish =
        !multiAir &&
        (ledger.mode?.value === 'fly' ||
          Boolean(ledger.directFlight?.value) ||
          Boolean(ledger.originCities?.value?.length));
      notes.push({
        id: 'origin',
        tier: 'critical',
        emoji: multiAir ? '🏠' : flyish && airportCity ? '✈️' : '📍',
        label: multiAir
          ? `Start ${ledger.originCity.value}`
          : flyish && airportCity
            ? `Flug ab ${ledger.originCity.value}`
            : flyish
              ? `Start ${ledger.originCity.value}`
              : `ab ${ledger.originCity.value}`,
        hint: 'Start',
      });
    }
  }

  if (hasUserBudget(ledger) && ledger.budgetEur) {
    notes.push({
      id: 'budget',
      tier: 'critical',
      emoji: '💶',
      label: `${ledger.budgetEur.value} € ${ledger.budgetScope?.value === 'per_person' ? 'p.P.' : 'gesamt'}`,
    });
  } else if (ledger.budgetVibe?.value === 'cheap') {
    notes.push({ id: 'budgetVibe', tier: 'wish', emoji: '💸', label: 'eher günstig' });
  } else if (ledger.budgetVibe?.value === 'mid') {
    notes.push({ id: 'budgetVibe', tier: 'wish', emoji: '💶', label: 'ordentlich' });
  } else if (ledger.budgetVibe?.value === 'flex') {
    notes.push({ id: 'budgetVibe', tier: 'wish', emoji: '💶', label: 'Budget offen' });
  }

  const dest = ledger.destinationHint?.value || ledger.corridor?.value;
  if (
    dest &&
    dest !== 'offen' &&
    dest !== 'egal' &&
    (ledger.destinationHint?.source === 'user' || ledger.corridor?.source === 'user')
  ) {
    notes.push({
      id: 'dest',
      tier: ledger.destinationHint ? 'critical' : 'high',
      emoji: emojiForDestination(dest),
      label: dest,
      hint: 'Reiseziel',
    });
  }

  if (ledger.inspiration?.source === 'user') {
    notes.push({
      id: 'inspo',
      tier: 'wish',
      emoji: emojiForWishText(ledger.inspiration.value, '✨'),
      label: `wie ${ledger.inspiration.value}`,
      hint: 'Stil, kein Ziel',
    });
  }

  if (ledger.purpose?.source === 'user' && !looksLikeWishDumpPurpose(ledger.purpose.value)) {
    const p = ledger.purpose.value;
    notes.push({
      id: 'purpose',
      tier: 'wish',
      emoji: emojiForWishText(p, '🎯'),
      label: p.length > 56 ? `${p.slice(0, 54)}…` : p,
    });
  }

  if (ledger.lodgingKind?.source === 'user') {
    const k = ledger.lodgingKind.value;
    const ids = [
      ...(ledger.mustHaves?.value ?? []),
      ...(ledger.wishHaves?.value ?? []),
      ...(ledger.niceHaves?.value ?? []),
    ];
    const hideCamp =
      k === 'camping' &&
      (ids.includes('hotel') || ids.includes('apartment') || Boolean(ledger.lodgingFallback));
    if (!hideCamp) {
      const main = lodgingName(k);
      const fb = ledger.lodgingFallback?.value;
      const fbLabel = fb && fb !== k ? lodgingName(fb) : null;
      const lodgingEmoji =
        k === 'camping'
          ? '⛺'
          : k === 'ferienhaus'
            ? '🏡'
            : k === 'hostel'
              ? '🛏️'
              : k === 'airbnb' || k === 'apartment'
                ? '🔑'
                : '🏨';
      notes.push({
        id: 'lodging',
        tier: 'wish',
        emoji: lodgingEmoji,
        label: fbLabel && fbLabel !== main ? `${main}, sonst ${fbLabel}` : main,
      });
    }
  } else if (ledger.lodgingOpen?.value) {
    notes.push({
      id: 'lodging',
      tier: 'wish',
      emoji: '🏨',
      label: 'Unterkunft egal',
    });
  }

  if (ledger.meals?.source === 'user') {
    const m = ledger.meals.value;
    const soft = ledger.meals.hardness === 'optional' || ledger.meals.hardness === 'wish';
    const base =
      m === 'half'
        ? 'Halbpension'
        : m === 'all'
          ? 'All-inclusive'
          : m === 'breakfast'
            ? 'Frühstück'
            : 'Selbstverpflegung';
    notes.push({
      id: 'meals',
      tier:
        ledger.meals.hardness === 'optional'
          ? 'optional'
          : m === 'self' || soft
            ? 'wish'
            : 'critical',
      emoji: m === 'breakfast' ? '🥐' : m === 'all' ? '🍹' : m === 'self' ? '🛒' : '🍽️',
      label: soft || ledger.meals.hardness === 'optional' ? `${base} wenn geht` : base,
    });
  }

  if (ledger.locationBias?.source === 'user') {
    const b = ledger.locationBias.value;
    if (b === 'cheap_central') notes.push({ id: 'bias', tier: 'wish', emoji: '🏙️', label: 'zentral' });
    else if (b === 'quiet_outskirts') notes.push({ id: 'bias', tier: 'wish', emoji: '🤫', label: 'ruhig' });
    else if (b === 'near_activity') notes.push({ id: 'bias', tier: 'wish', emoji: '🚶', label: 'fußläufig' });
    else notes.push({ id: 'bias', tier: 'wish', emoji: '📍', label: `Lage: ${String(b)}`.slice(0, 28) });
  }

  if (ledger.maxDriveHours?.source === 'user') {
    notes.push({
      id: 'drive',
      tier: 'critical',
      emoji: '⏱️',
      label: `max ${ledger.maxDriveHours.value} h Anfahrt`,
    });
  }
  if (ledger.departAfterHour?.source === 'user' || ledger.arriveBeforeHour?.source === 'user') {
    const bits: string[] = [];
    if (ledger.departAfterHour) bits.push(`los ab ${ledger.departAfterHour.value} Uhr`);
    if (ledger.arriveBeforeHour) bits.push(`an bis ${ledger.arriveBeforeHour.value} Uhr`);
    notes.push({
      id: 'window',
      tier: 'critical',
      emoji: '🕖',
      label: bits.join(', '),
    });
  }

  if (ledger.weatherWant?.source === 'user' && ledger.weatherWant.value !== 'egal') {
    notes.push({
      id: 'weather',
      tier: 'wish',
      emoji: '☀️',
      label:
        ledger.weatherWant.value === 'warm'
          ? 'lieber warm'
          : ledger.weatherWant.value === 'cool'
            ? 'lieber kühl'
            : 'mildes Wetter',
    });
  }

  if (ledger.lastHighlight?.source === 'user' && ledger.lastHighlight.value !== 'keine' && !looksLikeGarbageFact(ledger.lastHighlight.value)) {
    notes.push({
      id: 'lastH',
      tier: 'wish',
      emoji: emojiForWishText(ledger.lastHighlight.value, '🌟'),
      label: ledger.lastHighlight.value.slice(0, 56),
    });
  }
  if (ledger.highlightWant?.source === 'user' && ledger.highlightWant.value !== 'keine' && !looksLikeGarbageFact(ledger.highlightWant.value)) {
    notes.push({
      id: 'wantH',
      tier: ledger.highlightWant.hardness === 'optional' ? 'optional' : 'wish',
      emoji: emojiForWishText(ledger.highlightWant.value, '⭐'),
      label: compactNoteLabel(ledger.highlightWant.value, 30),
    });
  }
  if (ledger.dealbreaker?.source === 'user' && ledger.dealbreaker.value !== 'keine' && !looksLikeGarbageFact(ledger.dealbreaker.value)) {
    notes.push({
      id: 'nogo',
      tier: 'nope',
      emoji: emojiForWishText(ledger.dealbreaker.value, '🚫'),
      label: ledger.dealbreaker.value.slice(0, 56),
    });
  }

  const shown = new Set<string>();
  if (ledger.mustHaves?.source !== 'profile') {
    for (const id of ledger.mustHaves?.value ?? []) {
      const meta = MUST_META[id];
      if (!meta) continue;
      if (id === 'rental_car' && ledger.rentalCar?.value !== true) continue;
      if (LODGING_IDS.has(id)) continue;
      if (id === 'camping') continue;
      if ((id === 'spa' || id === 'sauna' || id === 'massage') && (ledger.spaStyle || /party|männer|maenner/i.test(ledger.purpose?.value ?? ''))) {
        continue;
      }
      shown.add(id);
      notes.push({
        id: `must:${id}`,
        tier: 'critical',
        emoji: meta.emoji,
        label: meta.label,
      });
    }
  }
  for (const id of ledger.wishHaves?.value ?? []) {
    if (shown.has(id)) continue;
    if (id === ledger.lodgingKind?.value || id === ledger.lodgingFallback?.value) continue;
    if (id === 'rental_car' && ledger.rentalCar?.value !== true) continue;
    if (LODGING_IDS.has(id)) continue;
    if ((id === 'spa' || id === 'sauna' || id === 'massage') && (ledger.spaStyle || /party|männer|maenner/i.test(ledger.purpose?.value ?? ''))) {
      continue;
    }
    const meta = MUST_META[id];
    if (!meta) continue;
    notes.push({ id: `wish:${id}`, tier: 'wish', emoji: meta.emoji, label: meta.label });
  }
  for (const id of ledger.niceHaves?.value ?? []) {
    if (shown.has(id)) continue;
    if (LODGING_IDS.has(id)) continue;
    const meta = MUST_META[id];
    if (!meta) continue;
    shown.add(id);
    notes.push({ id: `nice:${id}`, tier: 'optional', emoji: meta.emoji, label: `${meta.label} wenn geht` });
  }

  if (ledger.energy?.source === 'user' && !/party|männer|maenner/i.test(ledger.purpose?.value ?? '')) {
    const e = ledger.energy.value;
    notes.push({
      id: 'energy',
      tier: 'high',
      emoji: e === 'chill_pool' ? '😌' : e === 'active_out' ? '🏃' : '⚖️',
      label:
        e === 'chill_pool'
          ? 'eher chillen'
          : e === 'active_out'
            ? 'eher aktiv unterwegs'
            : 'Mix aus Chill & Action',
    });
  }

  if (
    ledger.mode &&
    ledger.mode.value !== 'unknown' &&
    ledger.mode.source === 'user' &&
    !(ledger.mode.value === 'mix' && (ledger.departAfterHour || ledger.arriveBeforeHour))
  ) {
    const m = ledger.mode.value;
    const label =
      m === 'fly'
        ? 'Flug'
        : m === 'drive'
          ? 'Auto'
          : m === 'train'
            ? 'Bahn'
            : m === 'bike'
              ? 'Rad'
              : m === 'daytrip'
                ? 'Tagestrip'
                : m === 'hike'
                  ? 'Wandern'
                  : m === 'camping'
                    ? 'Camping'
                    : m === 'mix'
                      ? 'Anreise egal'
                      : 'Mix';
    const fb = ledger.modeFallback?.value;
    const fbLabel =
      fb === 'drive'
        ? 'Auto'
        : fb === 'train'
          ? 'Bahn'
          : fb === 'fly'
            ? 'Flug'
            : null;
    const shown = fbLabel ? `${label}, sonst ${fbLabel}` : ledger.mode.hardness === 'wish' ? `${label} wenn passt` : label;
    notes.push({
      id: 'mode',
      tier: ledger.mode.hardness === 'wish' || fbLabel || m === 'mix' ? 'wish' : 'critical',
      emoji: modeEmoji(m),
      label: shown,
    });
  }
  if (ledger.directFlight?.source === 'user' && ledger.directFlight.value) {
    const stops = ledger.maxFlightStops?.value;
    const soft = ledger.directFlight.hardness === 'wish' || (stops != null && stops > 0);
    const layover = ledger.maxLayoverHours?.value;
    let label = 'Direktflug';
    if (soft && stops != null && stops > 0) {
      label = `Direkt bevorzugt · max ${stops} Stopp${stops > 1 ? 's' : ''}`;
    } else if (soft) {
      label = 'Direkt bevorzugt';
    }
    if (layover != null && layover > 0 && soft) {
      label = `${label} · ≤${layover}h`;
    }
    notes.push({
      id: 'directFlight',
      tier: soft ? 'wish' : 'critical',
      emoji: '✈️',
      label,
    });
  } else if (
    ledger.maxFlightStops?.source === 'user' &&
    ledger.maxFlightStops.value != null &&
    ledger.maxFlightStops.value > 0
  ) {
    const stops = ledger.maxFlightStops.value;
    notes.push({
      id: 'directFlight',
      tier: 'wish',
      emoji: '✈️',
      label: `max ${stops} Stopp${stops > 1 ? 's' : ''}`,
    });
  }
  if (ledger.longLayoverExploreHours?.source === 'user') {
    notes.push({
      id: 'longLayover',
      tier: 'wish',
      emoji: '🧭',
      label: `langer Stopp ≥${ledger.longLayoverExploreHours.value} h ok`,
      hint: 'Optional',
    });
  }
  if (ledger.overnightFlightOk?.source === 'user' && ledger.overnightFlightOk.value) {
    notes.push({
      id: 'nightFlight',
      tier: 'wish',
      emoji: '🌙',
      label: 'Nachtflug statt Hotel ok',
      hint: 'Optional',
    });
  }
  if (
    (ledger.cabinBags?.source === 'user' || ledger.checkedBags?.source === 'user') &&
    (ledger.cabinBags != null || ledger.checkedBags != null)
  ) {
    const cabin = ledger.cabinBags?.value ?? 0;
    const checked = ledger.checkedBags?.value ?? 0;
    let bagLabel = 'kein Gepäck';
    if (cabin > 0 && checked > 0) bagLabel = `${cabin} Hand · ${checked} Aufgabe`;
    else if (cabin > 0) bagLabel = cabin === 1 ? '1 Handgepäck' : `${cabin} Handgepäck`;
    else if (checked > 0) bagLabel = checked === 1 ? '1 Aufgabegepäck' : `${checked} Aufgabegepäck`;
    notes.push({
      id: 'bags',
      tier: 'wish',
      emoji: '🧳',
      label: bagLabel,
    });
  }
  if (ledger.needEsim?.source === 'user' && ledger.needEsim.value) {
    notes.push({
      id: 'esim',
      tier: 'wish',
      emoji: '📱',
      label: 'eSIM',
      hint: 'Daten',
    });
  }

  if (ledger.rentalCar?.source === 'user' && ledger.rentalCar.value) {
    notes.push({
      id: 'rental',
      tier: 'high',
      emoji: '🚗',
      label: 'Mietwagen',
    });
  }
  if (ledger.cheapDrinks?.value) {
    notes.push({
      id: 'cheapDrinks',
      tier: 'wish',
      emoji: '🍺',
      label: 'billig & reichlich',
    });
  }
  if (ledger.partyStyle?.source === 'user' && ledger.partyStyle.value !== 'egal' && !looksLikeGarbageFact(ledger.partyStyle.value)) {
    const moods = ledger.partyStyle.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (moods.length >= 2) {
      moods.slice(0, 4).forEach((mood, i) => {
        notes.push({
          id: `mood:${i}`,
          tier: ledger.partyStyle!.hardness === 'optional' ? 'optional' : 'wish',
          emoji: moodEmoji(mood),
          label: mood,
        });
      });
    } else {
      notes.push({
        id: 'party',
        tier: ledger.partyStyle.hardness === 'optional' ? 'optional' : 'wish',
        emoji: moodEmoji(ledger.partyStyle.value),
        label: ledger.partyStyle.value.slice(0, 56),
      });
    }
  } else if (ledger.partyGrain?.source === 'user' && ledger.partyGrain.value) {
    const g = ledger.partyGrain.value;
    const soft = ledger.partyGrain.hardness === 'optional';
    notes.push({
      id: 'partyGrain',
      tier: soft ? 'optional' : g === 'private_house' ? 'wish' : 'wish',
      emoji: g === 'private_house' ? '🏠' : g === 'bars' ? '🍸' : g === 'clubs' ? '🪩' : '🎉',
      label:
        g === 'private_house'
          ? 'Hausparty'
          : g === 'bars'
            ? 'Bars'
            : g === 'clubs'
              ? soft
                ? 'Clubs wenn geht'
                : 'Clubs'
              : 'Feier egal',
    });
  }
  if (ledger.originCities?.value?.length) {
    const cities = ledger.originCities.value.slice(0, 4);
    if (cities.length >= 2) {
      for (const city of cities) {
        notes.push({
          id: `airport:${city}`,
          tier: 'critical',
          emoji: '✈️',
          label: `ab ${city}`,
          hint: 'Flughafen',
        });
      }
    } else {
      notes.push({
        id: 'origins',
        tier: 'critical',
        emoji: '✈️',
        label: `Flug ab ${cities[0]}`,
      });
    }
  }
  if (
    ledger.spaStyle?.source === 'user' &&
    ledger.spaStyle.value !== 'kein Spa' &&
    !/^kein/i.test(ledger.spaStyle.value)
  ) {
    notes.push({
      id: 'spaStyle',
      tier: 'wish',
      emoji: '🧖',
      label: ledger.spaStyle.value.slice(0, 56),
    });
  }
  if (ledger.kidsStyle?.source === 'user') {
    notes.push({
      id: 'kidsStyle',
      tier: 'high',
      emoji: '🧒',
      label: ledger.kidsStyle.value.slice(0, 56),
    });
  }
  if (ledger.tripShape?.source === 'user' || ledger.tripShape?.source === 'inferred') {
    const shape = ledger.tripShape.value;
    notes.push({
      id: 'shape',
      tier: 'high',
      emoji:
        shape === 'cruise'
          ? '🛳️'
          : shape === 'ferry'
            ? '⛴️'
            : shape === 'roadtrip'
              ? '🛣️'
              : '🗺️',
      label:
        shape === 'cruise'
          ? 'Kreuzfahrt'
          : shape === 'ferry'
            ? 'Fähre'
            : shape === 'roadtrip'
              ? 'Roadtrip'
              : shape === 'hop'
                ? 'mehrere Orte'
                : shape === 'tour'
                  ? 'Tour'
                  : shape === 'stay'
                    ? 'eine Basis'
                    : 'Trip',
    });
  }
  if (ledger.cruiseEmbarkPort?.value) {
    notes.push({
      id: 'cruisePort',
      tier: 'high',
      emoji: '⚓',
      label: `ab ${ledger.cruiseEmbarkPort.value}`.slice(0, 56),
    });
  } else if (ledger.cruiseEmbarkBias?.value === 'near_home') {
    notes.push({ id: 'cruisePort', tier: 'wish', emoji: '⚓', label: 'Start nahe / DE-Häfen' });
  } else if (ledger.cruiseEmbarkBias?.value === 'cheapest_anywhere') {
    notes.push({ id: 'cruisePort', tier: 'wish', emoji: '⚓', label: 'günstigster Hafen' });
  }
  if (ledger.cruiseShipName?.value && ledger.cruiseShipName.value !== 'open') {
    notes.push({
      id: 'cruiseShip',
      tier: 'critical',
      emoji: '🚢',
      label: ledger.cruiseShipName.value.slice(0, 56),
    });
  } else if (ledger.cruiseLinePref?.value === 'aida') {
    notes.push({ id: 'cruiseShip', tier: 'high', emoji: '🚢', label: 'AIDA (Schiff offen)' });
  } else if (ledger.cruiseLinePref?.value === 'mein_schiff') {
    notes.push({ id: 'cruiseShip', tier: 'high', emoji: '🚢', label: 'Mein Schiff (Nummer offen)' });
  } else if (ledger.cruiseShipName?.value === 'open') {
    notes.push({ id: 'cruiseShip', tier: 'wish', emoji: '🚢', label: 'Schiff: Vorschlag ok' });
  }
  // Soft-Empfehlungen aus Wünschen (wenn noch kein festes Schiff)
  if (!ledger.cruiseShipName?.value || ledger.cruiseShipName.value === 'open') {
    try {
      const { matchCruiseShipsFromLedger } = require('./research/cruiseShipFit') as {
        matchCruiseShipsFromLedger: (l: typeof ledger) => {
          fits: Array<{ ship: { name: string }; why: string }>;
          wants: string[];
        };
      };
      const fit = matchCruiseShipsFromLedger(ledger);
      if (fit.wants.length && fit.fits.length) {
        for (const f of fit.fits.slice(0, 2)) {
          notes.push({
            id: `cruiseShipSuggest_${f.ship.name.replace(/\s+/g, '_')}`,
            tier: 'wish',
            emoji: '✨',
            label: `passt: ${f.ship.name}`.slice(0, 56),
          });
        }
      }
    } catch {
      /* soft */
    }
  }
  if (ledger.cruiseCabinClass?.value) {
    notes.push({
      id: 'cabin',
      tier: 'wish',
      emoji: '🛏️',
      label:
        ledger.cruiseCabinClass.value === 'suite'
          ? 'Suite'
          : ledger.cruiseCabinClass.value === 'balcony'
            ? 'Balkon'
            : ledger.cruiseCabinClass.value === 'oceanview'
              ? 'Meerblick'
              : 'Innenkabine',
    });
  }
  if (ledger.cruiseSeaDaysBias?.value === 'many_sea') {
    notes.push({ id: 'seaDays', tier: 'wish', emoji: '🌊', label: 'viele Seetage' });
  } else if (ledger.cruiseSeaDaysBias?.value === 'many_ports') {
    notes.push({ id: 'seaDays', tier: 'wish', emoji: '🗺️', label: 'viele Stopps' });
  }
  if (ledger.ideaHook?.source === 'user' && ledger.ideaHook.value !== 'nein') {
    notes.push({
      id: 'idea',
      tier: 'wish',
      emoji: emojiForWishText(ledger.ideaHook.value, '💡'),
      label: compactNoteLabel(ledger.ideaHook.value, 30),
    });
  }
  for (const [i, act] of (ledger.mustActivities?.value ?? []).slice(0, 4).entries()) {
    const a = String(act || '').trim();
    if (!a || looksLikeGarbageFact(a)) continue;
    notes.push({
      id: `act_${i}`,
      tier: 'wish',
      emoji: emojiForWishText(a, '✨'),
      label: compactNoteLabel(a, 28),
      hint: 'Aktivität',
    });
  }
  if (ledger.bahncard?.source === 'user') {
    const bc = ledger.bahncard.value;
    notes.push({
      id: 'bahncard',
      tier: bc === 'none' ? 'optional' : 'wish',
      emoji: '🚆',
      label:
        bc === 'none'
          ? 'keine Bahncard'
          : bc === 'unknown'
            ? 'Bahncard unklar'
            : `eine Person: Bahncard ${bc}`,
      hint: 'Sparpreis',
    });
  }
  if (ledger.travelerAges?.source === 'user' && ledger.travelerAges.value.length) {
    notes.push({
      id: 'ages',
      tier: 'wish',
      emoji: '🎂',
      label: `Alter ${ledger.travelerAges.value.join(', ')} J.`,
      hint: 'pro Person',
    });
  }
  if (ledger.localMovePref?.source === 'user') {
    const m = ledger.localMovePref.value;
    notes.push({
      id: 'localMove',
      tier: 'wish',
      emoji: m === 'rental' ? '🚗' : m === 'walk' ? '🚶' : m === 'oepnv' ? '🚇' : '🧭',
      label:
        m === 'rental'
          ? 'vor Ort Mietwagen'
          : m === 'walk'
            ? 'vor Ort zu Fuß'
            : m === 'oepnv'
              ? 'vor Ort ÖPNV'
              : 'vor Ort Mix',
      hint: 'Vor Ort',
    });
  }
  if (
    ledger.extraWishes?.source === 'user' &&
    ledger.extraWishes.value !== 'keine' &&
    !looksLikeGarbageFact(ledger.extraWishes.value)
  ) {
    const amenText = [
      ...(ledger.mustHaves?.value ?? []),
      ...(ledger.wishHaves?.value ?? []),
      ...(ledger.niceHaves?.value ?? []),
    ].join(' ');
    const parts = splitWishPhrases(ledger.extraWishes.value);
    const items = (parts.length ? parts : [ledger.extraWishes.value]).filter((line) => {
      if (/pool/i.test(line) && amenText.includes('pool')) return false;
      if (/party/i.test(line) && amenText.includes('party')) return false;
      if (/club/i.test(line) && /club|party/i.test(amenText)) return false;
      return true;
    });
    const soft =
      ledger.extraWishes.hardness === 'optional' ||
      /wenn geht|cool|nice|easy|optional|bonus/iu.test(ledger.extraWishes.value);
    items.slice(0, 4).forEach((line, i) => {
      notes.push({
        id: i === 0 ? 'extra' : `extra:${i}`,
        tier: soft ? 'optional' : 'wish',
        emoji: emojiForWishText(line, '✨'),
        label: compactNoteLabel(line, 34),
      });
    });
  }
  if (ledger.bookedStay?.value) {
    notes.push({
      id: 'bookedStay',
      tier: 'critical',
      emoji: '✅',
      label: ledger.bookedFlight?.value === false ? 'Hotel gebucht · Flug suchen' : 'Hotel gebucht',
    });
  }
  if (ledger.bookedFlight?.value) {
    notes.push({
      id: 'bookedFlight',
      tier: 'critical',
      emoji: '✅',
      label: ledger.bookedStay?.value === false ? 'Flug gebucht · Hotel suchen' : 'Flug gebucht',
    });
  }
  if (ledger.bookedRail?.value) {
    notes.push({ id: 'bookedRail', tier: 'critical', emoji: '✅', label: 'Bahn gebucht' });
  }
  if (ledger.bookedBus?.value) {
    notes.push({ id: 'bookedBus', tier: 'critical', emoji: '✅', label: 'Fernbus gebucht' });
  }
  if (ledger.bookedCar?.value) {
    notes.push({ id: 'bookedCar', tier: 'critical', emoji: '✅', label: 'Mietwagen gebucht' });
  }
  if (ledger.needCar?.value === true && ledger.bookedCar?.value !== true) {
    notes.push({ id: 'needCar', tier: 'critical', emoji: '🚗', label: 'Noch Mietwagen' });
  }
  for (const [i, act] of (ledger.bookedActivities?.value ?? []).slice(0, 3).entries()) {
    if (!act?.name) continue;
    notes.push({
      id: `bookedAct_${i}`,
      tier: 'critical',
      emoji: '🎟️',
      label: compactNoteLabel(`${act.name} gebucht`, 32),
    });
  }
  if (ledger.bookedStay?.value === true && ledger.bookedFlight?.value === false) {
    notes.push({ id: 'scopeFlight', tier: 'critical', emoji: '✈️', label: 'Nur Flug' });
  }
  if (ledger.bookedFlight?.value === true && ledger.bookedStay?.value === false) {
    notes.push({ id: 'scopeStay', tier: 'critical', emoji: '🏨', label: 'Nur Hotel' });
  }
  {
    let focus: import('./gapInventory').ResearchFocus = 'full';
    try {
      const { effectiveResearchFocus } = require('./gapInventory') as typeof import('./gapInventory');
      focus = effectiveResearchFocus(ledger);
    } catch {
      focus = ledger.researchFocus?.value ?? 'full';
    }
    if (focus === 'flight' && !notes.some((n) => n.id === 'scopeFlight' || n.id === 'researchFocus')) {
      notes.push({ id: 'researchFocus', tier: 'critical', emoji: '✈️', label: 'Schnell: nur Flüge' });
    } else if (focus === 'stay' && !notes.some((n) => n.id === 'scopeStay' || n.id === 'researchFocus')) {
      notes.push({ id: 'researchFocus', tier: 'critical', emoji: '🏨', label: 'Schnell: nur Hotels' });
    } else if (focus === 'activity' && !notes.some((n) => n.id === 'researchFocus')) {
      notes.push({ id: 'researchFocus', tier: 'critical', emoji: '🎟️', label: 'Schnell: nur Aktivitäten' });
    }
  }
  if (ledger.inventoryMode?.value === 'gap_fill') {
    notes.push({ id: 'inventoryGap', tier: 'high', emoji: '🧩', label: 'Lücken füllen' });
  }
  if (ledger.bookedTransfer?.value) {
    notes.push({ id: 'bookedTransfer', tier: 'critical', emoji: '✅', label: 'Transfer gebucht' });
  }
  if (ledger.transferPref?.value && ledger.transferPref.value !== 'unsure') {
    const tp = ledger.transferPref.value;
    notes.push({
      id: 'transfer',
      tier: 'high',
      emoji: tp === 'taxi' ? '🚕' : tp === 'public' ? '🚇' : tp === 'package' ? '📦' : '🚶',
      label:
        tp === 'taxi'
          ? 'Taxi-Transfer'
          : tp === 'public'
            ? 'ÖPNV-Transfer'
            : tp === 'package'
              ? 'Transfer inkl.'
              : tp === 'rental'
                ? 'Mietwagen-Transfer'
                : 'zu Fuß',
    });
  }
  for (const [i, line] of (ledger.intentNotes?.value ?? []).slice(0, 3).entries()) {
    if (looksLikeGarbageFact(line)) continue;
    if (hasUserBudget(ledger) && /\b(budget|€|euro)\b/iu.test(line) && !/\b(bier|party|pool)\b/iu.test(line)) {
      continue;
    }
    notes.push({
      id: `intent_${i}`,
      tier: 'optional',
      emoji: emojiForWishText(line, '💭'),
      label: compactNoteLabel(line, 28),
      hint: 'Intention',
    });
  }

  // Board-Pins: jede Antwort sofort (Vorschau), außer Struktur-Sticker deckt denselben askKey
  try {
    const { structuredCoversAsk } = require('./boardPins') as typeof import('./boardPins');
    for (const pin of ledger.boardPins?.value ?? []) {
      if (!pin?.label) continue;
      if (pin.askKey && structuredCoversAsk(pin.askKey, ledger)) continue;
      if (notes.some((n) => n.id === pin.id || n.label.toLowerCase() === pin.label.toLowerCase())) continue;
      notes.push({
        id: pin.id,
        tier: pin.kind === 'answer' ? 'wish' : 'optional',
        emoji: emojiForWishText(pin.label, '✨'),
        label: compactNoteLabel(pin.label, 32),
        hint: pin.kind === 'preview' ? 'Vorschau' : 'Gerade gesagt',
      });
    }
  } catch {
    /* soft */
  }

  const shownNos = new Set<string>();
  for (const id of ledger.hardNos?.value ?? []) {
    const meta = MUST_META[id];
    if (!meta || shownNos.has(id)) continue;
    shownNos.add(id);
    notes.push({
      id: `no:${id}`,
      tier: 'nope',
      emoji: '🚫',
      label: `kein ${meta.label}`,
    });
  }

  // Letzte User-Antwort anpinnen, wenn noch kein frischer Sticker dazu
  const last = (opts?.lastUserLine || '').replace(/\s+/g, ' ').trim();
  if (
    last.length >= 4 &&
    last.length <= 80 &&
    !looksLikeGarbageFact(last) &&
    !/^\?/u.test(last) &&
    !/\b(was\s+war\s+die\s+frage)\b/iu.test(last)
  ) {
    const compact = compactNoteLabel(last, 32);
    const already = notes.some((n) => {
      if (n.id === 'openQ' || n.id === 'lastAns') return false;
      const lab = n.label.toLowerCase();
      const c = compact.toLowerCase();
      if (lab === c) return true;
      if (c.length >= 8 && lab.includes(c.slice(0, 10))) return true;
      return false;
    });
    if (!already) {
      notes.push({
        id: 'lastAns',
        tier: 'wish',
        emoji: emojiForWishText(last, '✨'),
        label: compact,
        hint: 'Gerade gesagt',
      });
    }
  }

  // Coverage: alle restlichen User-Slots, die noch keinen Sticker haben
  appendMissingUserSlots(notes, ledger);

  const order: Record<NoteTier, number> = { critical: 0, high: 1, wish: 2, optional: 3, nope: 4 };
  // Offene Frage oben halten
  notes.sort((a, b) => {
    if (a.id === 'openQ') return -1;
    if (b.id === 'openQ') return 1;
    return order[a.tier] - order[b.tier];
  });
  return notes;
}

const SKIP_COVERAGE_KEYS = new Set([
  'originLat',
  'originLng',
  'recapDone',
  'searchReady',
  'intentNotes',
  'boardPins',
  'mustHaves',
  'wishHaves',
  'niceHaves',
  'hardNos',
  'mustActivities',
  'needEsim',
  'budgetScope',
  'dateAnchor',
  'dateFlex',
  'dateMonth',
  'datePart',
  'dateStart',
  'dateEnd',
  'stayNights',
  'stayNightsMax',
  'stayDays',
  'arrivalFlexDays',
  'departureFlexDays',
  'energy',
  'tripShape',
  'modeFallback',
  'lodgingOpen',
]);

function formatSlotValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || looksLikeGarbageFact(s)) return null;
    return compactNoteLabel(s, 30);
  }
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (typeof v[0] === 'number') return v.map(String).join('/');
    if (typeof v[0] === 'string') return compactNoteLabel(v.filter(Boolean).join(', '), 30);
    return null;
  }
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      if (s.length > 2 && s.length < 40) return compactNoteLabel(s, 28);
    } catch {
      /* soft */
    }
  }
  return null;
}

function appendMissingUserSlots(notes: FlipchartNote[], ledger: ReiseLedger): void {
  const have = new Set(notes.map((n) => n.id));
  const L = ledger as unknown as Record<string, { value?: unknown; source?: string; hardness?: string } | null>;
  for (const [key, entry] of Object.entries(L)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.source !== 'user' && entry.source !== 'profile') continue;
    if (SKIP_COVERAGE_KEYS.has(key)) continue;
    if (have.has(key) || have.has(`cov:${key}`)) continue;
    // schon durch speziellen Sticker abgedeckt?
    const aliases: Record<string, string[]> = {
      adults: ['people'],
      children: ['kids'],
      budgetEur: ['budget'],
      budgetVibe: ['budgetVibe'],
      originCity: ['origin'],
      originCities: ['origins'],
      destinationHint: ['dest'],
      corridor: ['dest'],
      lodgingKind: ['lodging'],
      lodgingFallback: ['lodging'],
      lodgingOpen: ['lodging'],
      locationBias: ['bias'],
      highlightWant: ['wantH'],
      lastHighlight: ['lastH'],
      dealbreaker: ['nogo'],
      extraWishes: ['extra'],
      purpose: ['purpose'],
      meals: ['meals'],
      weatherWant: ['weather'],
      travelerAges: ['ages'],
      bahncard: ['bahncard'],
      partyStyle: ['party'],
      directFlight: ['directFlight'],
      cabinBags: ['bags'],
      checkedBags: ['bags'],
      maxDriveHours: ['drive'],
      departAfterHour: ['window'],
      arriveBeforeHour: ['window'],
    };
    const aliasHit = (aliases[key] || []).some((a) => have.has(a) || [...have].some((id) => id.startsWith(a)));
    if (aliasHit) continue;
    // must/wish ids already as must:pool etc.
    if (key === 'mode' && have.has('mode')) continue;
    const label = formatSlotValue(entry.value);
    if (!label) continue;
    const soft = entry.hardness === 'optional' || entry.hardness === 'wish';
    notes.push({
      id: `cov:${key}`,
      tier: soft ? 'optional' : 'wish',
      emoji: emojiForWishText(label, '✨'),
      label: key === 'directFlight' && entry.value === true ? 'Direktflug' : label,
      hint: 'Brief',
    });
    have.add(`cov:${key}`);
  }
}

export function flipchartBudget(ledger: ReiseLedger): { eur: number; scope: string } | null {
  if (!hasUserBudget(ledger) || !ledger.budgetEur) return null;
  return {
    eur: ledger.budgetEur.value,
    scope: ledger.budgetScope?.value === 'per_person' ? 'p.P.' : 'gesamt',
  };
}
