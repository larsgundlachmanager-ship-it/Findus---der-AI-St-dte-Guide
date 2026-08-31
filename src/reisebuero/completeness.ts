import type { ReiseLedger } from './types';
import { isAirportVisible } from './slotLedger';
import { vibeGaps } from './vibeProbes';

export type GapTier = 'red' | 'yellow' | 'green';

export type CompletenessGap = {
  key: string;
  label: string;
  tier: GapTier;
};

export function hasUserBudget(ledger: ReiseLedger): boolean {
  return Boolean(ledger.budgetEur && ledger.budgetEur.source === 'user');
}

export type BriefPath = 'party' | 'family' | 'couple' | 'chill' | 'senior' | 'default';

export function briefingPath(ledger: ReiseLedger): BriefPath {
  const blob = [
    ledger.purpose?.value,
    ledger.energy?.value,
    ledger.extraWishes?.value,
    ledger.kidsStyle?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if ((ledger.children?.value ?? 0) > 0 || /baby|neugeboren|familie|kinder/.test(blob)) return 'family';
  if (/party|jungs|männer|maenner|feier|trinken/.test(blob)) return 'party';
  if (/überrasch|ueberrasch|jahrestag|romantik|\bpaar\b/.test(blob)) return 'couple';
  if (/pension|rente|senior|ruhestand/.test(blob)) return 'senior';
  if (
    /spa|wellness|relax|chill|quatsch|beste freundin|freundinnen/.test(blob) &&
    (ledger.adults?.value ?? 2) <= 2
  ) {
    return 'chill';
  }
  return 'default';
}

function hasWhen(ledger: ReiseLedger): boolean {
  if (ledger.mode?.value === 'daytrip') return true;
  if (ledger.dateStart) return true;
  const path = briefingPath(ledger);
  if (path === 'party' || path === 'default') return false;
  if (ledger.dateMonth && (ledger.stayDays || ledger.stayNights || ledger.dateFlex?.value === 'weekend')) {
    return true;
  }
  if (ledger.dateFlex?.value === 'open') return false;
  if (ledger.dateFlex?.value === 'month' && ledger.dateMonth) return true;
  return false;
}

function hasLodging(ledger: ReiseLedger): boolean {
  return Boolean(ledger.lodgingKind || ledger.lodgingOpen?.value);
}

function needsOriginAsk(ledger: ReiseLedger): boolean {
  return ledger.originCity?.source !== 'user';
}

function gap(key: string, label: string): CompletenessGap {
  return { key, label, tier: 'red' };
}

function hardFactOrder(path: BriefPath): Array<{ key: string; label: string }> {
  switch (path) {
    case 'party':
      return [
        { key: 'adults', label: 'Gruppe' },
        { key: 'origin', label: 'Start' },
        { key: 'when', label: 'Zeitraum' },
        { key: 'budget', label: 'Budget' },
        { key: 'driveTime', label: 'Anfahrt' },
        { key: 'departWindow', label: 'Los / Ankunft' },
      ];
    case 'family':
      return [
        { key: 'adults', label: 'Gruppe' },
        { key: 'mode', label: 'Anreise' },
        { key: 'driveTime', label: 'Anfahrt' },
        { key: 'when', label: 'Zeitraum' },
        { key: 'budget', label: 'Budget' },
        { key: 'lodging', label: 'Unterkunft' },
      ];
    case 'couple':
      return [
        { key: 'adults', label: 'Gruppe' },
        { key: 'when', label: 'Zeitraum' },
        { key: 'budget', label: 'Budget' },
        { key: 'lodging', label: 'Unterkunft' },
      ];
    case 'chill':
      return [
        { key: 'adults', label: 'Gruppe' },
        { key: 'when', label: 'Zeitraum' },
        { key: 'origin', label: 'Start' },
        { key: 'budget', label: 'Budget' },
        { key: 'lodging', label: 'Unterkunft' },
      ];
    case 'senior':
      return [
        { key: 'adults', label: 'Gruppe' },
        { key: 'when', label: 'Zeitraum' },
        { key: 'budget', label: 'Budget' },
        { key: 'locationBias', label: 'Gegend' },
        { key: 'lodging', label: 'Unterkunft' },
        { key: 'mode', label: 'Anreise' },
      ];
    default:
      return [
        { key: 'adults', label: 'Gruppe' },
        { key: 'origin', label: 'Start' },
        { key: 'when', label: 'Zeitraum' },
        { key: 'budget', label: 'Budget' },
        { key: 'mode', label: 'Anreise' },
        { key: 'lodging', label: 'Unterkunft' },
      ];
  }
}

function isHardFilled(ledger: ReiseLedger, key: string): boolean {
  if (key === 'adults') return Boolean(ledger.adults);
  if (key === 'when') return hasWhen(ledger);
  if (key === 'budget') return hasUserBudget(ledger);
  if (key === 'mode') return Boolean(ledger.mode && ledger.mode.value !== 'unknown');
  if (key === 'lodging') return hasLodging(ledger) || !needsNight(ledger);
  if (key === 'driveTime') {
    if (briefingPath(ledger) === 'party') return Boolean(ledger.maxDriveHours);
    return ledger.mode?.value !== 'drive' || Boolean(ledger.maxDriveHours);
  }
  if (key === 'origin') return ledger.mode?.value === 'daytrip' || !needsOriginAsk(ledger);
  if (key === 'locationBias') return Boolean(ledger.locationBias || ledger.extraWishes);
  if (key === 'departWindow') {
    return Boolean(ledger.departAfterHour || ledger.arriveBeforeHour);
  }
  return true;
}

/** Rot — ohne das bleibt Suche grau. Reihenfolge = Ping-Pong-Pfad. */
export function searchReadyGaps(ledger: ReiseLedger): CompletenessGap[] {
  return hardFactOrder(briefingPath(ledger))
    .filter((g) => !isHardFilled(ledger, g.key))
    .map((g) => gap(g.key, g.label));
}

export function isPartyTrip(ledger: ReiseLedger): boolean {
  const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
  if (ids.includes('party')) return true;
  return /party|feier|männerwochenende|maennerwochenende|jungs/i.test(ledger.purpose?.value ?? '');
}

function isThinLedger(ledger: ReiseLedger): boolean {
  if (briefingPath(ledger) !== 'default') return false;
  return (
    !ledger.purpose &&
    !ledger.destinationHint &&
    !ledger.corridor &&
    !ledger.lodgingKind &&
    !hasWhen(ledger)
  );
}

/** Eine Lücke nach der anderen — Hard Facts in Pfad-Reihenfolge, dann max. ein Fit. */
export function conversationGaps(ledger: ReiseLedger, asked: string[] = []): CompletenessGap[] {
  // Leeres Overlay: erst Reiseart, nicht „Allein oder zu mehreren?“
  if (isThinLedger(ledger) && !asked.includes('purpose')) {
    return [{ key: 'purpose', label: 'Reiseart', tier: 'yellow' }];
  }
  const reds = searchReadyGaps(ledger);
  if (reds.length) return [reds[0]!];
  const path = briefingPath(ledger);
  if (path === 'party' && !hasLodging(ledger) && !asked.includes('lodging')) {
    return [{ key: 'lodging', label: 'Unterkunft', tier: 'yellow' }];
  }
  if (path === 'family' && !asked.includes('extraWishes') && !ledger.extraWishes) {
    const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
    if (!ids.includes('baby_bed') && !ids.includes('parking') && !ids.includes('kids_club')) {
      return [{ key: 'extraWishes', label: 'Noch wichtig', tier: 'yellow' }];
    }
  }
  if (path === 'couple' && !ledger.locationBias && !asked.includes('locationBias')) {
    return [{ key: 'locationBias', label: 'Lage', tier: 'yellow' }];
  }
  if (path === 'chill') {
    const spaIds = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
    if (spaIds.some((id) => id === 'spa' || id === 'sauna' || id === 'massage') && !ledger.spaStyle && !asked.includes('spaStyle')) {
      return [{ key: 'spaStyle', label: 'Spa', tier: 'yellow' }];
    }
    if (!asked.includes('extraWishes') && !ledger.dealbreaker && !ledger.extraWishes) {
      return [{ key: 'extraWishes', label: 'No-Go', tier: 'yellow' }];
    }
  }
  if (path === 'senior' && ledger.mode?.value === 'fly' && ledger.directFlight == null && !asked.includes('directFlight')) {
    return [{ key: 'directFlight', label: 'Direktflug', tier: 'yellow' }];
  }
  const vibes = vibeGaps(ledger).filter((g) => {
    if (g.key === 'partyStyle') return false;
    if (g.key === 'spaStyle') return false;
    if (g.key === 'kidsStyle') return path === 'family' && !ledger.kidsStyle && !ledger.extraWishes;
    if (g.key === 'tripShape') return !ledger.tripShape;
    if (asked.includes(g.key)) return false;
    return true;
  });
  if (vibes[0]) return [vibes[0]];
  return [];
}

export function isCityTrip(ledger: ReiseLedger): boolean {
  return /städt|staedt|city|party|männer|maenner|jungs/i.test(ledger.purpose?.value ?? '');
}

export function needsRentalAsk(ledger: ReiseLedger): boolean {
  if (ledger.rentalCar != null) return false;
  const ids = [...(ledger.mustHaves?.value ?? []), ...(ledger.wishHaves?.value ?? [])];
  if (ids.includes('rental_car')) return false;
  if (isPartyTrip(ledger) || isCityTrip(ledger)) return false;
  if (ledger.locationBias?.value === 'cheap_central') return false;
  if (ledger.locationBias?.value === 'quiet_outskirts') {
    const k = ledger.lodgingKind?.value;
    return k === 'apartment' || k === 'ferienhaus' || k === 'airbnb';
  }
  return false;
}

export function completenessGaps(ledger: ReiseLedger): CompletenessGap[] {
  return conversationGaps(ledger);
}

export function needsNight(ledger: ReiseLedger): boolean {
  const m = ledger.mode?.value;
  if (m === 'daytrip') return false;
  return true;
}

export function isBriefComplete(ledger: ReiseLedger): boolean {
  return searchReadyGaps(ledger).length === 0;
}

/** Nächste ungefüllte Lücke — nach Hard Facts + max. 1 Vertiefung: Abschluss. */
export function nextQuestionKey(
  ledger: ReiseLedger,
  asked: string[] = [],
): CompletenessGap {
  const next = conversationGaps(ledger, asked)[0];
  if (next) return next;
  if (!ledger.recapDone && !asked.includes('wrap_up')) {
    return { key: 'wrap_up', label: 'Abschluss', tier: 'green' };
  }
  return { key: 'keep_talking', label: 'Vibe', tier: 'green' };
}

export function buildRecapLines(ledger: ReiseLedger): string[] {
  const lines: string[] = [];
  if (ledger.mode) {
    const alt = ledger.modeFallback
      ? `, sonst ${modeLabel(ledger.modeFallback.value)}`
      : ledger.mode.hardness === 'wish'
        ? ' (wenn passt)'
        : '';
    lines.push(`Anreise: ${modeLabel(ledger.mode.value)}${alt}`);
  }
  if (ledger.corridor) lines.push(`Korridor: ${ledger.corridor.value}`);
  if (ledger.destinationHint) lines.push(`Ort: ${ledger.destinationHint.value}`);
  if (ledger.stayNights) lines.push(`${ledger.stayNights.value} Nächte`);
  else if (ledger.stayDays) lines.push(`${ledger.stayDays.value} Tage`);
  if (ledger.dateMonth) lines.push(monthLabelFromKey(ledger.dateMonth.value));
  if (ledger.datePart) {
    lines.push(ledger.datePart.value === 'early' ? 'Anfang' : ledger.datePart.value === 'late' ? 'Ende' : 'Mitte');
  }
  if (ledger.dateFlex) lines.push(`Zeit: ${ledger.dateFlex.value}`);
  if (ledger.dateStart) lines.push(`ab ${ledger.dateStart.value}`);
  if (ledger.dateEnd) lines.push(`bis ${ledger.dateEnd.value}`);
  if (ledger.adults) lines.push(`${ledger.adults.value} Personen`);
  if (hasUserBudget(ledger)) {
    lines.push(
      `Budget ${ledger.budgetEur!.value} € ${ledger.budgetScope?.value === 'per_person' ? 'p.P.' : 'gesamt'}`,
    );
  }
  if (ledger.budgetVibe) lines.push(`Preisgefühl ${ledger.budgetVibe.value}`);
  if (ledger.lodgingKind) {
    const fb = ledger.lodgingFallback?.value;
    lines.push(fb ? `${ledger.lodgingKind.value}, sonst ${fb}` : ledger.lodgingKind.value);
  }
  if (ledger.maxDriveHours) lines.push(`max. ${ledger.maxDriveHours.value} h Fahrt`);
  if (ledger.energy) lines.push(energyLabel(ledger.energy.value));
  if (ledger.locationBias) lines.push(biasLabel(ledger.locationBias.value));
  if (ledger.purpose) lines.push(ledger.purpose.value);
  if (ledger.mustHaves?.value.length) {
    lines.push(`Must: ${ledger.mustHaves.value.join(', ')}`);
  }
  if (ledger.wishHaves?.value.length) {
    lines.push(`Wish: ${ledger.wishHaves.value.join(', ')}`);
  }
  if (ledger.inspiration) lines.push(`Stil wie ${ledger.inspiration.value}`);
  if (ledger.lastHighlight) lines.push(`letztes Highlight: ${ledger.lastHighlight.value}`);
  if (ledger.highlightWant) lines.push(`Highlight: ${ledger.highlightWant.value}`);
  if (ledger.partyStyle) lines.push(`Feiern: ${ledger.partyStyle.value}`);
  if (ledger.spaStyle) lines.push(`Spa: ${ledger.spaStyle.value}`);
  if (ledger.children) lines.push(`${ledger.children.value} Kinder`);
  if (ledger.kidsStyle) lines.push(`Kinder: ${ledger.kidsStyle.value}`);
  if (ledger.tripShape) lines.push(`Form: ${ledger.tripShape.value}`);
  if (ledger.ideaHook) lines.push(`Idee: ${ledger.ideaHook.value}`);
  if (ledger.dealbreaker) lines.push(`No-Go: ${ledger.dealbreaker.value}`);
  if (isAirportVisible(ledger) && ledger.airportIata) {
    lines.push(`Abflug ${ledger.airportIata.value}`);
  }
  if (ledger.driverName) lines.push(`${ledger.driverName.value} fährt`);
  return lines;
}

function modeLabel(m: string): string {
  switch (m) {
    case 'fly':
      return 'Flug';
    case 'drive':
      return 'Auto';
    case 'train':
      return 'Bahn';
    case 'bike':
      return 'Fahrrad';
    case 'hike':
      return 'Wandern';
    case 'daytrip':
      return 'Tagestrip';
    case 'camping':
      return 'Camping';
    case 'mix':
      return 'Anreise egal';
    default:
      return m;
  }
}

function energyLabel(e: string | null): string {
  if (e === 'chill_pool') return 'eher chillen / Pool';
  if (e === 'active_out') return 'eher aktiv draußen';
  if (e === 'mixed') return 'Mix Chill + Aktiv';
  return '';
}

function biasLabel(b: string | null): string {
  if (b === 'quiet_outskirts') return 'ruhige Lage';
  if (b === 'cheap_central') return 'günstig zentral';
  if (b === 'near_activity') return 'nah an der Aktivität';
  return '';
}

function monthLabelFromKey(ym: string): string {
  const mm = ym.slice(5, 7);
  const names: Record<string, string> = {
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
  return names[mm] || ym;
}
