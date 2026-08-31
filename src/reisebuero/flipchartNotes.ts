/**
 * Flipchart-Notizen aus dem Ledger — Sticker, kein Protokoll, kein Radar-Kreis.
 */

import type { MustHaveId, ReiseLedger } from './types';
import { hasUserBudget } from './completeness';
import { looksLikeGarbageFact } from './parseBriefSlots';

export type NoteTier = 'critical' | 'high' | 'wish' | 'optional' | 'nope';

export type FlipchartNote = {
  id: string;
  tier: NoteTier;
  emoji: string;
  label: string;
  hint?: string;
  fresh?: boolean;
};

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
  party: { emoji: '🍻', label: 'Kneipen', tier: 'wish' },
  vegan: { emoji: '🌱', label: 'Vegan', tier: 'wish' },
  no_carpet: { emoji: '🚫', label: 'Ohne Teppich', tier: 'wish' },
  spa: { emoji: '🧖', label: 'Spa', tier: 'high' },
  sauna: { emoji: '♨️', label: 'Sauna', tier: 'wish' },
  massage: { emoji: '💆', label: 'Massage', tier: 'wish' },
  tennis: { emoji: '🎾', label: 'Tennis', tier: 'high' },
  wine: { emoji: '🍷', label: 'Wein', tier: 'high' },
  cruise: { emoji: '🛳️', label: 'Kreuzfahrt', tier: 'high' },
  kids_club: { emoji: '🧒', label: 'Kids-Club', tier: 'high' },
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

function monthHint(ledger: ReiseLedger): string | null {
  const flex = ledger.dateFlex?.value;
  const start = ledger.dateStart?.value;
  const end = ledger.dateEnd?.value;
  const nights = ledger.stayNights?.value;
  const days = ledger.stayDays?.value;
  const monthName = ledger.dateMonth?.value
    ? MONTH_DE[ledger.dateMonth.value.slice(5, 7)] ?? null
    : start
      ? MONTH_DE[start.slice(5, 7)] ?? null
      : null;
  const part =
    ledger.datePart?.value === 'early'
      ? 'Anfang'
      : ledger.datePart?.value === 'late'
        ? 'Ende'
        : ledger.datePart?.value === 'mid'
          ? 'Mitte'
          : null;
  const nightBit =
    nights != null
      ? `${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}`
      : days == null
        ? null
        : days % 7 === 0
          ? days / 7 === 1
            ? '1 Woche'
            : `${days / 7} Wochen`
          : `${Math.max(1, days - 1)} Nächte`;
  const bits: string[] = [];
  if (start && end) {
    bits.push(`${formatDay(start)}–${formatDay(end)}`);
    if (nightBit) bits.push(nightBit);
    return bits.join(' · ');
  }
  if (part && monthName) bits.push(`${part} ${monthName}`);
  else if (monthName && flex !== 'exact') bits.push(monthName);
  if (flex === 'weekend') bits.push('Wochenende');
  if (flex === 'open') bits.push('flexibel');
  if (start && flex === 'exact') bits.unshift(formatDay(start));
  if (nightBit) bits.push(nightBit);
  if (bits.length) return bits.join(' · ');
  return null;
}

function formatDay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Termin notiert';
  return `${Number(m[3])}.${Number(m[2])}.`;
}

function lodgingName(k: string): string {
  if (k === 'apartment' || k === 'airbnb') return 'Apartment';
  if (k === 'ferienhaus') return 'Ferienhaus';
  if (k === 'hostel') return 'Hostel';
  if (k === 'hotel') return 'Hotel';
  return k[0]!.toUpperCase() + k.slice(1);
}

const LODGING_IDS = new Set(['apartment', 'hotel', 'camping', 'ferienhaus']);

export function buildFlipchartNotes(ledger: ReiseLedger): FlipchartNote[] {
  const notes: FlipchartNote[] = [];

  const when = monthHint(ledger);
  if (when) {
    notes.push({ id: 'when', tier: 'critical', emoji: '📅', label: when, hint: 'Zeit' });
  }

  if (ledger.adults?.source === 'user' || ledger.adults?.source === 'profile') {
    const n = ledger.adults.value;
    notes.push({
      id: 'people',
      tier: 'critical',
      emoji: '👥',
      label: n === 1 ? 'Allein' : `${n} Leute`,
      hint: 'Gruppe',
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

  if (ledger.originCity?.source === 'user') {
    notes.push({
      id: 'origin',
      tier: 'critical',
      emoji: '📍',
      label: `ab ${ledger.originCity.value}`,
      hint: 'Start',
    });
  }

  if (hasUserBudget(ledger) && ledger.budgetEur) {
    notes.push({
      id: 'budget',
      tier: 'critical',
      emoji: '💶',
      label: `${ledger.budgetEur.value} € ${ledger.budgetScope?.value === 'per_person' ? 'p.P.' : 'gesamt'}`,
    });
  } else if (ledger.budgetVibe?.value === 'cheap') {
    notes.push({ id: 'budgetVibe', tier: 'wish', emoji: '💶', label: 'günstig' });
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
      emoji: dest.toLowerCase().includes('griech') ? '🇬🇷' : '📍',
      label: dest,
      hint: 'Reiseziel',
    });
  }

  if (ledger.inspiration?.source === 'user') {
    notes.push({
      id: 'inspo',
      tier: 'wish',
      emoji: '✨',
      label: `wie ${ledger.inspiration.value}`,
      hint: 'Stil, kein Ziel',
    });
  }

  if (ledger.purpose?.source === 'user') {
    const p = ledger.purpose.value;
    notes.push({
      id: 'purpose',
      tier: 'wish',
      emoji: '🎯',
      label: p.length > 22 ? `${p.slice(0, 20)}…` : p,
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
      notes.push({
        id: 'lodging',
        tier: 'wish',
        emoji: k === 'hostel' ? '🛏️' : k === 'airbnb' || k === 'apartment' ? '🔑' : '🏨',
        label: fbLabel ? `${main}, sonst ${fbLabel}` : main,
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
    notes.push({
      id: 'meals',
      tier: m === 'self' ? 'wish' : 'critical',
      emoji: '🍽️',
      label:
        m === 'half'
          ? 'Halbpension'
          : m === 'all'
            ? 'All-inclusive'
            : m === 'breakfast'
              ? 'Frühstück'
              : 'Selbstverpflegung',
    });
  }

  if (ledger.locationBias?.source === 'user') {
    const b = ledger.locationBias.value;
    if (b === 'cheap_central') notes.push({ id: 'bias', tier: 'wish', emoji: '🏙️', label: 'zentral' });
    if (b === 'quiet_outskirts') notes.push({ id: 'bias', tier: 'wish', emoji: '🤫', label: 'ruhig' });
    if (b === 'near_activity') notes.push({ id: 'bias', tier: 'wish', emoji: '🚶', label: 'fußläufig' });
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
      emoji: '🌟',
      label: ledger.lastHighlight.value.slice(0, 22),
    });
  }
  if (ledger.highlightWant?.source === 'user' && ledger.highlightWant.value !== 'keine' && !looksLikeGarbageFact(ledger.highlightWant.value)) {
    notes.push({
      id: 'wantH',
      tier: 'wish',
      emoji: '⭐',
      label: ledger.highlightWant.value.slice(0, 22),
    });
  }
  if (ledger.dealbreaker?.source === 'user' && ledger.dealbreaker.value !== 'keine' && !looksLikeGarbageFact(ledger.dealbreaker.value)) {
    notes.push({
      id: 'nogo',
      tier: 'nope',
      emoji: '🚫',
      label: ledger.dealbreaker.value.slice(0, 22),
    });
  }

  const shown = new Set<string>();
  if (ledger.mustHaves?.source !== 'profile') {
    for (const id of ledger.mustHaves?.value ?? []) {
      const meta = MUST_META[id];
      if (!meta) continue;
      if (id === 'rental_car' && ledger.rentalCar?.value !== true) continue;
      if (id === 'party' && ledger.partyStyle) continue;
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
    if (id === 'party' && ledger.partyStyle) continue;
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
      label: e === 'chill_pool' ? 'Chillen' : e === 'active_out' ? 'Aktiv' : 'Mix',
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
      emoji: '🧭',
      label: shown,
    });
  }
  if (ledger.directFlight?.source === 'user' && ledger.directFlight.value) {
    notes.push({
      id: 'directFlight',
      tier: 'critical',
      emoji: '✈️',
      label: 'Direktflug',
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
  if (ledger.partyStyle?.source === 'user' && ledger.partyStyle.value !== 'egal' && !looksLikeGarbageFact(ledger.partyStyle.value)) {
    notes.push({
      id: 'party',
      tier: 'high',
      emoji: '🍻',
      label: ledger.partyStyle.value.slice(0, 28),
    });
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
      label: ledger.spaStyle.value.slice(0, 28),
    });
  }
  if (ledger.kidsStyle?.source === 'user') {
    notes.push({
      id: 'kidsStyle',
      tier: 'high',
      emoji: '🧒',
      label: ledger.kidsStyle.value.slice(0, 28),
    });
  }
  if (ledger.tripShape?.source === 'user' || ledger.tripShape?.source === 'inferred') {
    const shape = ledger.tripShape.value;
    notes.push({
      id: 'shape',
      tier: 'high',
      emoji: shape === 'cruise' ? '🛳️' : shape === 'roadtrip' ? '🛣️' : '🗺️',
      label:
        shape === 'cruise'
          ? 'Kreuzfahrt'
          : shape === 'roadtrip'
            ? 'Roadtrip'
            : shape === 'hop'
              ? 'mehrere Orte'
              : shape === 'tour'
                ? 'Tour'
                : 'ein Ort',
    });
  }
  if (ledger.ideaHook?.source === 'user' && ledger.ideaHook.value !== 'nein') {
    notes.push({
      id: 'idea',
      tier: 'wish',
      emoji: '💡',
      label: ledger.ideaHook.value.slice(0, 22),
    });
  }
  if (
    ledger.extraWishes?.source === 'user' &&
    ledger.extraWishes.value !== 'keine' &&
    !looksLikeGarbageFact(ledger.extraWishes.value)
  ) {
    notes.push({
      id: 'extra',
      tier: 'wish',
      emoji: '📝',
      label: ledger.extraWishes.value.slice(0, 22),
    });
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

  const order: Record<NoteTier, number> = { critical: 0, high: 1, wish: 2, optional: 3, nope: 4 };
  notes.sort((a, b) => order[a.tier] - order[b.tier]);
  return notes;
}

export function flipchartBudget(ledger: ReiseLedger): { eur: number; scope: string } | null {
  if (!hasUserBudget(ledger) || !ledger.budgetEur) return null;
  return {
    eur: ledger.budgetEur.value,
    scope: ledger.budgetScope?.value === 'per_person' ? 'p.P.' : 'gesamt',
  };
}
