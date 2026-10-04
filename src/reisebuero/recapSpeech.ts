/**
 * Akt-2 Recap-Speech: eine flüssige Kurz-Zusammenfassung mit Trip-Titel.
 * Kultur: FINDUS_SPEECH_CULTURE_BLOCK — weben, kein Slot-Ablesen, kein Telegramm.
 */

import type { MustHaveId, ReiseLedger } from './types';
import { hasUserBudget } from './completeness';
import { looksLikeWishDumpPurpose } from './tripPurpose';
import { weaveSpokenFacts } from './briefingSpeech';

function ihr(ledger: ReiseLedger): boolean {
  return (ledger.adults?.value ?? 1) > 1;
}

function formatDayDe(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = Number(m[3]);
  const mo = Number(m[2]);
  const months = [
    '',
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];
  return `${d}. ${months[mo] || m[2]}`;
}

function softOpt(hardness: string | undefined | null): boolean {
  return hardness === 'optional' || hardness === 'wish';
}

const MUST_DE: Partial<Record<MustHaveId, string>> = {
  pool: 'Pool',
  sand: 'Sandstrand',
  party: 'Party',
  sea: 'am Wasser',
  warm: 'Wärme',
  grill: 'Grill',
  apartment: 'Apartment',
  hotel: 'Hotel',
  ferienhaus: 'Ferienhaus',
  spa: 'Spa',
};

function amenLabel(id: MustHaveId): string {
  return MUST_DE[id] || id;
}

export function tripTitle(ledger: ReiseLedger): string {
  const p = ledger.purpose?.value?.trim();
  if (p && p.length >= 2 && !looksLikeWishDumpPurpose(p)) return p;
  const dest = ledger.destinationHint?.value?.trim();
  if (dest && dest !== 'offen' && dest !== 'egal') return dest;
  if (ledger.adults?.value) return `${ledger.adults.value}-Personen-Trip`;
  return 'Trip';
}

/** Kurzes Delta nach Patch — keine zweite volle Zusammenfassung. */
export function composeRecapPatchAck(ledger: ReiseLedger): string {
  const pl = ihr(ledger);
  const title = tripTitle(ledger);
  return pl
    ? `Hab ich mitgezogen — ${title} bleibt der Rahmen. Passt das so, oder fehlt noch was?`
    : `Hab ich mitgezogen — ${title} bleibt der Rahmen. Passt das so, oder fehlt noch was?`;
}

/**
 * Eine flüssige Zusammenfassung (max. ~4 Sätze) — hart vorne, Rest verdichtet.
 */
export function composeRecapSpeech(ledger: ReiseLedger): string {
  const pl = ihr(ledger);
  const your = pl ? 'euer' : 'dein';
  const title = tripTitle(ledger);
  const chunks: string[] = [];

  // Wann + wer
  const whenBits: string[] = [];
  const returnSoft =
    ledger.dateEnd?.hardness === 'optional' ||
    (ledger.dateAnchor?.value === 'arrive' && ledger.dateFlex?.value === 'open');
  if (ledger.dateStart?.value && ledger.dateEnd?.value && ledger.dateStart.value !== ledger.dateEnd.value) {
    whenBits.push(
      returnSoft
        ? `ab ${formatDayDe(ledger.dateStart.value)}, Rückreise um den ${formatDayDe(ledger.dateEnd.value)} herum`
        : `${formatDayDe(ledger.dateStart.value)} bis ${formatDayDe(ledger.dateEnd.value)}`,
    );
  } else if (ledger.dateStart?.value) {
    whenBits.push(`ab ${formatDayDe(ledger.dateStart.value)}`);
  } else if (ledger.dateWindow?.value || ledger.dateMonth?.value) {
    whenBits.push(String(ledger.dateWindow?.value || ledger.dateMonth?.value));
  }
  if (ledger.stayNights?.value && ledger.stayNightsMax?.value && ledger.stayNightsMax.value > ledger.stayNights.value) {
    whenBits.push(`${ledger.stayNights.value} bis ${ledger.stayNightsMax.value} Nächte`);
  } else if (ledger.stayNights?.value) {
    whenBits.push(`${ledger.stayNights.value} Nächte`);
  }
  if (ledger.adults?.value) {
    whenBits.push(ledger.adults.value === 1 ? 'allein' : `${ledger.adults.value} Leute`);
  }

  chunks.push(
    whenBits.length
      ? `Kurz check: ${your} ${title} — ${weaveSpokenFacts(whenBits)}.`
      : `Kurz check: ${your} ${title}.`,
  );

  // Vibe + Stay in einem Atemzug
  const mid: string[] = [];
  const style = (ledger.partyStyle?.value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasHouse = style.some((s) => /hausparty|privat/i.test(s)) || ledger.partyGrain?.value === 'private_house';
  const hasClubs = style.some((s) => /club/i.test(s)) || ledger.partyGrain?.value === 'clubs';
  if (hasHouse && hasClubs) mid.push('Party privat und Clubs');
  else if (hasHouse) mid.push('Party eher privat');
  else if (hasClubs) mid.push('eher Clubs');
  else if (ledger.spaStyle?.value) mid.push(`Spa ${String(ledger.spaStyle.value).slice(0, 40)}`);
  else if (/party|männer|maenner|jungs/i.test(ledger.purpose?.value ?? '')) mid.push('Party dabei');

  if (ledger.lodgingKind?.value) {
    const main =
      ledger.lodgingKind.value === 'apartment' || ledger.lodgingKind.value === 'airbnb'
        ? 'Apartment'
        : ledger.lodgingKind.value === 'ferienhaus'
          ? 'Ferienhaus'
          : ledger.lodgingKind.value === 'hotel'
            ? 'Hotel'
            : ledger.lodgingKind.value;
    const fb = ledger.lodgingFallback?.value;
    mid.push(
      fb && fb !== ledger.lodgingKind.value
        ? `${main} zuerst, ${fb === 'hotel' ? 'Hotel' : fb} als Notfall`
        : main,
    );
  }
  if (ledger.meals?.value === 'all') {
    mid.push(softOpt(ledger.meals.hardness) ? 'AI wenn’s passt' : 'All Inclusive');
  } else if (ledger.meals?.value === 'self') {
    mid.push('selbst kochen');
  }
  const skipParty = hasHouse || hasClubs;
  const musts = (ledger.mustHaves?.value ?? [])
    .filter((x) => x !== 'party' || !skipParty)
    .map(amenLabel)
    .slice(0, 3);
  if (musts.length) mid.push(musts.join(', '));
  if (mid.length) chunks.push(`Dazu ${weaveSpokenFacts(mid)}.`);

  // Prefer-/Soft-Fenster — eigener Atemzug (nicht im Budget-Tail verstecken)
  const flex = ledger.whenFlex?.value;
  const WD_FULL: Record<string, string> = {
    mo: 'Montag',
    di: 'Dienstag',
    mi: 'Mittwoch',
    do: 'Donnerstag',
    fr: 'Freitag',
    sa: 'Samstag',
    so: 'Sonntag',
  };
  if (flex?.outbound?.preferWeekday || flex?.return?.preferWeekday) {
    const bits: string[] = [];
    if (flex.outbound?.preferWeekday) {
      const prefer = WD_FULL[flex.outbound.preferWeekday] || flex.outbound.preferWeekday;
      const softs = (flex.outbound.softWeekdays ?? [])
        .map((w) => WD_FULL[w] || w)
        .filter(Boolean);
      const clock =
        flex.outbound.earliestHour != null ? ` ab ${flex.outbound.earliestHour} Uhr` : '';
      bits.push(
        softs.length
          ? `Los lieber ${prefer}${clock} — ${weaveSpokenFacts(softs)} geht auch`
          : `Los lieber ${prefer}${clock}`.trim(),
      );
    }
    if (flex.return?.preferWeekday) {
      const prefer = WD_FULL[flex.return.preferWeekday] || flex.return.preferWeekday;
      const softs = (flex.return.softWeekdays ?? [])
        .map((w) => WD_FULL[w] || w)
        .filter(Boolean);
      bits.push(
        softs.length
          ? `Rück lieber ${prefer} — ${weaveSpokenFacts(softs)} geht auch`
          : `Rück lieber ${prefer}`,
      );
    }
    if (bits.length) chunks.push(weaveSpokenFacts(bits) + '.');
  } else if (ledger.departAfterHour?.value != null) {
    chunks.push(`Los ab ${ledger.departAfterHour.value} Uhr.`);
  }

  // Anreise + Budget — ein gesprochener Atemzug
  const tail: string[] = [];
  const home = ledger.originCity?.value;
  const airs = ledger.originCities?.value ?? [];
  let startBit: string | null = null;
  if (home && airs.length && !airs.some((c) => c.toLowerCase() === home.toLowerCase())) {
    startBit = `Los in ${home}, Flieger ab ${airs.slice(0, 3).join(', ')}`;
  } else if (home || airs.length) {
    startBit = `Los in ${airs.length ? airs.slice(0, 3).join(', ') : home}`;
  }
  let modeBit: string | null = null;
  if (ledger.mode?.value && ledger.mode.value !== 'unknown') {
    modeBit =
      ledger.mode.value === 'mix'
        ? 'Anreise egal'
        : ledger.mode.value === 'fly'
          ? 'mit dem Flieger'
          : ledger.mode.value === 'train'
            ? 'mit der Bahn'
            : ledger.mode.value === 'drive'
              ? 'mit dem Auto'
              : ledger.mode.value;
  }
  if (startBit && modeBit?.startsWith('mit ') && !/Flieger|Bahn|Auto/i.test(startBit)) {
    tail.push(`${startBit} ${modeBit}`);
  } else {
    if (startBit) tail.push(startBit);
    if (modeBit && !(startBit && /Flieger/i.test(startBit) && /Flieger/i.test(modeBit))) {
      tail.push(modeBit);
    }
  }
  if (ledger.maxDriveHours?.value) tail.push(`höchstens ${ledger.maxDriveHours.value} Stunden Anfahrt`);
  if (hasUserBudget(ledger)) {
    const scope = ledger.budgetScope?.value === 'total' ? 'gesamt' : 'pro Person';
    tail.push(`Budget so um ${ledger.budgetEur!.value} Euro ${scope}`);
  } else if (ledger.budgetVibe?.value) {
    tail.push(`eher ${ledger.budgetVibe.value}`);
  }
  if (ledger.destinationHint?.value && ledger.destinationHint.value !== 'offen') {
    tail.push(`Richtung ${ledger.destinationHint.value}`);
  }

  if (ledger.lodgingKind?.value && ledger.lodgingFallback?.value) {
    /* schon in mid */
  } else if (ledger.lodgingFallback?.value && !mid.some((m) => /sonst/i.test(m))) {
    tail.push(`Notfall ${ledger.lodgingFallback.value}`);
  }

  if (ledger.surfacePref?.value === 'train_ok_bus_no' || ledger.surfacePref?.value === 'train_only') {
    tail.push('Zug ja, Bus eher nicht');
  }

  const hops = ledger.hopStops?.value;
  if (hops && hops.length >= 2) {
    tail.push(`über ${weaveSpokenFacts(hops.map((h) => h.city))}`);
  }

  // Inventar kurz
  const booked: string[] = [];
  if (ledger.bookedFlight?.value) booked.push('Flug');
  if (ledger.bookedRail?.value) booked.push('Bahn');
  if (ledger.bookedStay?.value) booked.push('Stay');
  if (ledger.bookedCar?.value) booked.push('Mietwagen');
  if (booked.length) {
    const gap =
      ledger.inventoryMode?.value === 'gap_fill'
        ? ' — Rest suche ich'
        : ledger.inventoryMode?.value === 'add_on'
          ? ' — Add-on'
          : '';
    tail.push(`${weaveSpokenFacts(booked)} schon gebucht${gap}`);
  }
  try {
    const { effectiveResearchFocus } = require('./gapInventory') as typeof import('./gapInventory');
    const focus = effectiveResearchFocus(ledger);
    if (focus === 'flight') tail.push('ich such nur die Flüge');
    else if (focus === 'stay') tail.push('ich such nur die Unterkunft');
    else if (focus === 'activity') tail.push('ich such nur Aktivitäten und Events');
  } catch {
    /* soft */
  }

  if (tail.length) chunks.push(weaveSpokenFacts(tail) + '.');

  chunks.push(pl ? 'Passt das so — oder fehlt euch noch was?' : 'Passt das so — oder fehlt noch was?');

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

/** Kurz-Hints für LLM-Polish (Fakten, kein Wortlaut-Zwang). */
export function recapFactHints(ledger: ReiseLedger): string[] {
  const hints: string[] = [`Titel/Reiseart: ${tripTitle(ledger)}`];
  if (ledger.dateStart?.value) hints.push(`Start: ${ledger.dateStart.value}`);
  if (ledger.dateEnd?.value) {
    hints.push(
      ledger.dateEnd.hardness === 'optional'
        ? `Ende optional: ${ledger.dateEnd.value}`
        : `Ende: ${ledger.dateEnd.value}`,
    );
  }
  if (ledger.stayNights?.value) {
    hints.push(
      ledger.stayNightsMax?.value && ledger.stayNightsMax.value > ledger.stayNights.value
        ? `Nächte: ${ledger.stayNights.value}–${ledger.stayNightsMax.value}`
        : `Nächte: ${ledger.stayNights.value}`,
    );
  }
  if (ledger.adults?.value) hints.push(`Personen: ${ledger.adults.value}`);
  if (ledger.partyGrain?.value) hints.push(`Feier: ${ledger.partyGrain.value}`);
  if (ledger.meals?.value) {
    hints.push(
      `Verpflegung: ${ledger.meals.value}${softOpt(ledger.meals.hardness) ? ' (nice-to-have)' : ''}`,
    );
  }
  if (ledger.lodgingKind?.value) hints.push(`Unterkunft: ${ledger.lodgingKind.value}`);
  if (ledger.lodgingFallback?.value) hints.push(`Notfall-Stay: ${ledger.lodgingFallback.value}`);
  if (ledger.whenFlex?.value) {
    const f = ledger.whenFlex.value;
    if (f.outbound?.preferWeekday) {
      hints.push(
        `Los Prefer ${f.outbound.preferWeekday}${f.outbound.earliestHour != null ? ` Soft ab ${f.outbound.earliestHour}` : ''}`,
      );
    }
    if (f.return?.preferWeekday) hints.push(`Rück Prefer ${f.return.preferWeekday}`);
  }
  if (ledger.hopStops?.value?.length) {
    hints.push(`Hops: ${ledger.hopStops.value.map((h) => h.city).join('→')}`);
  }
  if (ledger.surfacePref?.value) hints.push(`Surface: ${ledger.surfacePref.value}`);
  if (ledger.accessNeeds?.value?.length) hints.push(`Zugang: ${ledger.accessNeeds.value.join(',')}`);
  if (hasUserBudget(ledger)) hints.push(`Budget: ${ledger.budgetEur!.value}`);
  if (ledger.dealHunt?.value) hints.push('Günstig/Deal-Fokus: ja');
  if (ledger.mustHaves?.value?.length) hints.push(`Must: ${ledger.mustHaves.value.join(',')}`);
  if (ledger.originCity?.value) hints.push(`Startort: ${ledger.originCity.value}`);
  if (ledger.mode?.value) hints.push(`Anreise: ${ledger.mode.value}`);
  if (ledger.bahncard?.value) hints.push(`Bahncard: ${ledger.bahncard.value}`);
  if (ledger.inventoryMode?.value) hints.push(`Inventar: ${ledger.inventoryMode.value}`);
  return hints;
}
