/**
 * Magazin-Optionstyp — Stadt · Stay-Spur · Flugfenster (UI-Badge).
 */

import type { ReiseLedger, ReiseOption } from './types';

export type MagazineOptionKind = 'city' | 'lodging_track' | 'flight_window';

export function magazineOptionKind(opt: ReiseOption): MagazineOptionKind {
  const notes = (opt.decisionNotes ?? []).join(' ');
  if (/^Fenster:|Fenster:/im.test(notes) || /Fenster:/i.test(notes)) return 'flight_window';
  if (/^Stay-Spur:|Stay-Spur:/im.test(notes) || /Stay-Spur:/i.test(notes)) return 'lodging_track';
  return 'city';
}

export function magazineOptionKindLabel(kind: MagazineOptionKind): string {
  if (kind === 'flight_window') return 'Flugfenster';
  if (kind === 'lodging_track') return 'Stay-Spur';
  return 'Stadt';
}

/**
 * Erstspur + Notfall-Lodging als zwei Magazin-Karten (spezifischer Brief / nur 1 Stadt).
 */
export function expandLodgingTrackOptions(
  options: ReiseOption[],
  ledger: ReiseLedger,
): ReiseOption[] {
  const kind = ledger.lodgingKind?.value;
  const fb = ledger.lodgingFallback?.value;
  if (!kind || !fb || kind === fb) return options;

  const already = options.filter((o) =>
    (o.decisionNotes ?? []).some((d) => /^Stay-Spur:/i.test(d)),
  );
  if (already.length >= 2) return options;

  const base = options[0];
  if (!base) return options;

  const label = (k: string) =>
    k === 'apartment' || k === 'airbnb'
      ? 'Apartment'
      : k === 'ferienhaus'
        ? 'Ferienhaus'
        : k === 'hotel'
          ? 'Hotel'
          : k;

  const pickStay = (want: string) =>
    (base.stays ?? []).find((s) => {
      const blob = `${s.name || ''} ${s.why || ''} ${s.id || ''}`.toLowerCase();
      if (want === 'apartment' || want === 'airbnb') return /apart|airbnb|ferienwohnung|flat/i.test(blob);
      if (want === 'hotel') return /hotel|resort|inn/i.test(blob) && !/apart/i.test(blob);
      if (want === 'ferienhaus') return /ferienhaus|villa|haus/i.test(blob);
      return false;
    }) || null;

  const primaryStay = pickStay(kind) || (base.stays ?? [])[0] || null;
  const fallbackStay = pickStay(fb) || (base.stays ?? []).find((s) => s.id !== primaryStay?.id) || null;

  const clone = (suffix: string, spur: string, stay: typeof primaryStay): ReiseOption => ({
    ...base,
    id: `${base.id}_${suffix}`,
    title: `${base.title} · ${spur}`.slice(0, 72),
    selectedStayId: stay?.id ?? base.selectedStayId,
    stayName: stay?.name ?? base.stayName,
    stayBookUrl: stay?.bookUrl ?? base.stayBookUrl,
    stayPriceEur: stay?.priceEur ?? base.stayPriceEur,
    photoUrl: stay?.photoUrl ?? base.photoUrl,
    decisionNotes: [
      ...(base.decisionNotes ?? []).filter((d) => !/^Stay-Spur:/i.test(d)),
      `Stay-Spur: ${spur}`,
    ],
  });

  const primary = clone('erst', `Erstspur ${label(kind)}`, primaryStay);
  const secondary = clone('notfall', `Notfall ${label(fb)}`, fallbackStay || primaryStay);
  primary.matchScore = Math.min(99, (base.matchScore || 70) + 2);
  secondary.matchScore = Math.max(40, (base.matchScore || 70) - 3);

  // Nur wenn wenig Städte — sonst Städte behalten und Spuren nicht verdoppeln
  if (options.length === 1) return [primary, secondary];
  if (options.length === 2 && magazineOptionKind(options[1]!) === 'city') {
    return [primary, secondary, ...options.slice(1)];
  }
  return options;
}
