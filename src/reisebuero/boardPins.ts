/**
 * Flipchart-Pins: jede User-Antwort sofort sichtbar (Vorschau),
 * strukturierte Ledger-Slots ersetzen denselben askKey später.
 */

import type { LedgerEntry, ReiseLedger } from './types';

export type BoardPin = {
  /** Stabil: ask:<key> oder echo:<slug> */
  id: string;
  askKey?: string | null;
  label: string;
  raw?: string;
  /** preview = Code/Parser-Echo; answer = feste Antwort */
  kind: 'preview' | 'answer';
};

const ASK_HINT: Record<string, string> = {
  locationBias: 'Lage',
  geo: 'Lage',
  origin: 'Start',
  ages: 'Alter',
  adults: 'Gruppe',
  when: 'Zeit',
  budget: 'Budget',
  lodging: 'Unterkunft',
  mode: 'Anreise',
  meals: 'Essen',
  localMove: 'vor Ort',
  transfer: 'Transfer',
  rentalCar: 'Mietwagen',
  directFlight: 'Direktflug',
  bags: 'Gepäck',
  highlight: 'Highlight',
  lastTrip: 'Zuletzt',
  dealbreaker: 'No-Go',
  extraWishes: 'Wünsche',
  purpose: 'Art',
  partyStyle: 'Party',
  partyGrain: 'Feier',
  spaStyle: 'Spa',
  kidsStyle: 'Kids',
  tripShape: 'Form',
  weather: 'Wetter',
  dest: 'Ziel',
  driveTime: 'Fahrt',
  departWindow: 'Fenster',
  comfort: 'Komfort',
  bookedBits: 'Gebucht',
  needCar: 'Mietwagen',
  ideaHook: 'Idee',
  keep_talking: 'Noch was',
  ready_announce: 'Suchen',
  wrap_up: 'Suchen',
};

/** Offene Frage auf dem Board: nur Kurz-Thema + ❓, nie der Speech-Satz. */
export function shortOpenAskLabel(
  askKey?: string | null,
  _fullQuestion?: string | null,
): string {
  if (askKey && ASK_HINT[askKey]) return `${ASK_HINT[askKey]}?`;
  return '?';
}

export function askHintLabel(askKey?: string | null): string | null {
  if (!askKey) return null;
  return ASK_HINT[askKey] ?? null;
}

/** Strukturierter Sticker deckt diesen askKey schon ab → Preview-Pin weglassen. */
export function structuredCoversAsk(askKey: string | null | undefined, ledger: ReiseLedger): boolean {
  if (!askKey) return false;
  switch (askKey) {
    case 'locationBias':
    case 'geo':
      return Boolean(ledger.locationBias);
    case 'origin':
      return Boolean(ledger.originCity);
    case 'ages':
      return Boolean(ledger.travelerAges?.value?.length || ledger.bahncard);
    case 'adults':
      return Boolean(ledger.adults && (ledger.adults.source === 'user' || ledger.adults.source === 'profile'));
    case 'when':
      return Boolean(ledger.dateStart || ledger.dateFlex || ledger.dateMonth || ledger.stayNights || ledger.stayDays);
    case 'budget':
      return Boolean(ledger.budgetEur || ledger.budgetVibe);
    case 'lodging':
      return Boolean(ledger.lodgingKind || ledger.lodgingOpen);
    case 'mode':
      return Boolean(ledger.mode && ledger.mode.value !== 'unknown');
    case 'meals':
      return Boolean(ledger.meals);
    case 'localMove':
      return Boolean(ledger.localMovePref);
    case 'transfer':
      return Boolean(ledger.transferPref);
    case 'rentalCar':
      return ledger.rentalCar != null;
    case 'directFlight':
      return ledger.directFlight != null;
    case 'bags':
      return ledger.cabinBags != null || ledger.checkedBags != null;
    case 'highlight':
      return Boolean(ledger.highlightWant);
    case 'lastTrip':
      return Boolean(ledger.lastHighlight);
    case 'dealbreaker':
      return Boolean(ledger.dealbreaker);
    case 'extraWishes':
      return Boolean(ledger.extraWishes || ledger.mustHaves?.value?.length || ledger.wishHaves?.value?.length);
    case 'purpose':
      return Boolean(ledger.purpose);
    case 'partyStyle':
    case 'partyGrain':
      return Boolean(ledger.partyStyle || ledger.partyGrain);
    case 'spaStyle':
      return Boolean(ledger.spaStyle);
    case 'kidsStyle':
      return Boolean(ledger.kidsStyle);
    case 'tripShape':
      return Boolean(ledger.tripShape);
    case 'weather':
      return Boolean(ledger.weatherWant);
    case 'dest':
      return Boolean(ledger.destinationHint || ledger.corridor);
    case 'driveTime':
      return Boolean(ledger.maxDriveHours);
    case 'departWindow':
      return ledger.departAfterHour != null || ledger.arriveBeforeHour != null;
    case 'bookedBits':
      return (
        ledger.bookedFlight != null ||
        ledger.bookedStay != null ||
        ledger.bookedRail != null ||
        ledger.bookedBus != null ||
        ledger.needCar != null
      );
    case 'needCar':
      return ledger.needCar != null || ledger.bookedCar != null || ledger.rentalCar != null;
    default:
      return false;
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/giu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

function compactLabel(askKey: string | null | undefined, text: string): string {
  const raw = (text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const hint = askKey ? ASK_HINT[askKey] : null;
  // Antwortkern: Füllwörter weg, kurz halten — Frage nie mitschreiben
  let core = raw
    .replace(
      /\b(also|irgendwie|eigentlich|halt|schon|mal|einfach|vielleicht|eher|würde|wuerde|gerne|bitte|ja|nee|nein|nö)\b/giu,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!core) core = raw;
  if (core.length > 28) core = `${core.slice(0, 26).trim()}…`;
  if (hint) {
    // „Lage: ruhig“ — Thema klar, ohne die Frage zu wiederholen
    if (new RegExp(`^${hint}\\b`, 'i').test(core)) return core.slice(0, 32);
    return `${hint}: ${core}`.slice(0, 32);
  }
  return core.slice(0, 32);
}

/** Mindestens ein Pin aus der User-Äußerung — auch bei schwachem Parser. */
export function pinUserAnswer(
  askedKey: string | null | undefined,
  text: string,
): BoardPin | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 2) return null;
  // Reine Meta / Mic-Noise ohne Inhalt
  if (/^(äh+|hm+|ähm+|ah+|ja\.?|ok\.?|okay\.?)$/iu.test(t)) return null;
  if (/\b(was\s+war\s+die\s+frage)\b/iu.test(t)) return null;

  const label = compactLabel(askedKey, t);
  if (!label) return null;

  if (askedKey && ASK_HINT[askedKey]) {
    return {
      id: `ask:${askedKey}`,
      askKey: askedKey,
      label,
      raw: t.slice(0, 160),
      kind: 'answer',
    };
  }
  return {
    id: `echo:${slug(t) || String(t.length)}`,
    askKey: askedKey ?? null,
    label,
    raw: t.slice(0, 160),
    kind: 'preview',
  };
}

export function boardPinsEntry(pins: BoardPin[]): LedgerEntry<BoardPin[]> {
  return { value: pins, source: 'user', hardness: 'wish' };
}

export function mergeBoardPinLists(
  prev: BoardPin[] | null | undefined,
  next: BoardPin[] | null | undefined,
): BoardPin[] {
  const out = [...(prev ?? [])];
  for (const pin of next ?? []) {
    const clean: BoardPin = {
      ...pin,
      label: pin.label.replace(/\s+/g, ' ').trim().slice(0, 48),
      raw: pin.raw?.replace(/\s+/g, ' ').trim().slice(0, 160),
    };
    if (!clean.label) continue;
    const idx = out.findIndex(
      (p) =>
        p.id === clean.id ||
        (clean.askKey && p.askKey === clean.askKey) ||
        p.label.toLowerCase() === clean.label.toLowerCase(),
    );
    if (idx >= 0) out[idx] = clean;
    else out.push(clean);
  }
  return out.slice(-16);
}
