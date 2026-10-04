/**
 * Reise-Titel für Hub/Shelf — ein Satz der den Trip greift (Struktur, kein Script).
 */

import type { ReiseLedger, ReiseTrip } from './types';
import { looksLikeTripTypePurpose, looksLikeWishDumpPurpose } from './tripPurpose';

const MAX_TITLE = 44;

function amenitySet(ledger: ReiseLedger): Set<string> {
  return new Set(
    [
      ...(ledger.mustHaves?.value ?? []),
      ...(ledger.wishHaves?.value ?? []),
      ...(ledger.niceHaves?.value ?? []),
    ].map(String),
  );
}

function blob(ledger: ReiseLedger): string {
  return [
    ledger.purpose?.value,
    ledger.highlightWant?.value,
    ledger.partyStyle?.value,
    ledger.spaStyle?.value,
    ledger.energy?.value,
    ledger.partyGrain?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Kurzer Ort — erste Stadt, keine Adresse. */
export function tripTitlePlace(trip: ReiseTrip): string | null {
  const hint = (trip.ledger.destinationHint?.value || '').trim();
  if (hint && !/^(offen|egal|irgendwo|egal wohin)$/i.test(hint)) {
    const first = hint
      .split(/\s*(?:,|;|\/|–|—|\bund\b|\bvia\b)\s*/iu)[0]
      ?.trim();
    if (first && first.length >= 2) return first.slice(0, 22);
  }
  const opt =
    trip.options?.find((o) => o.id === trip.selectedOptionId) || trip.options?.[0];
  const place = (opt?.placeName || '').split(',')[0]?.trim();
  if (place && place.length >= 2) return place.slice(0, 22);
  const corridor = (trip.ledger.corridor?.value || '').trim();
  if (corridor) return corridor.slice(0, 22);
  return null;
}

/** Kern-Hook: Zweck / Trip-Art — nie Wish-Schnipsel. */
export function tripTitleHook(ledger: ReiseLedger): string | null {
  const purpose = (ledger.purpose?.value || '').replace(/\s+/g, ' ').trim();
  if (purpose && !looksLikeWishDumpPurpose(purpose)) {
    return purpose.slice(0, 28);
  }

  const a = amenitySet(ledger);
  const t = blob(ledger);
  const adults = ledger.adults?.value ?? 0;
  const kids =
    (ledger.children?.value ?? 0) > 0 ||
    a.has('kids_club') ||
    a.has('baby_bed') ||
    /familie|kinder|kids/.test(t);
  const duo = adults === 2 && !kids;
  const shape = ledger.tripShape?.value;

  if (shape === 'cruise' || a.has('cruise') || a.has('river_cruise') || /kreuzfahrt/.test(t)) {
    return 'Kreuzfahrt';
  }
  if (shape === 'roadtrip' || shape === 'hop' || shape === 'tour') {
    return looksLikeTripTypePurpose(purpose) ? purpose.slice(0, 28) : 'Tour';
  }
  if (a.has('spa') || a.has('sauna') || a.has('massage') || ledger.spaStyle?.value) {
    return duo ? 'Spa zu zweit' : 'Spa-Wochenende';
  }
  if (
    a.has('party') ||
    ledger.partyGrain?.value ||
    /party|nightlife|feiern|männer|maenner|jungs/.test(t)
  ) {
    if (/männer|maenner|jungs/.test(t) || (adults >= 3 && /party|club/.test(t))) {
      return 'Männerwochenende';
    }
    return 'Party-Wochenende';
  }
  if (kids) return 'Familienurlaub';
  if (a.has('sand') || a.has('sea') || /strand|meer|beach/.test(t)) {
    return duo ? 'Strand zu zweit' : 'Strandurlaub';
  }
  if (duo) return 'Kurztrip zu zweit';
  if (/städt|staedt|city/.test(t) || shape === 'stay') return 'Städtetrip';

  const hi = (ledger.highlightWant?.value || '').replace(/\s+/g, ' ').trim();
  if (hi && hi.length >= 4 && hi.length <= 32 && !looksLikeWishDumpPurpose(hi)) {
    return hi.slice(0, 28);
  }
  return null;
}

/** Ein Akzent, der im Hook noch fehlt. */
function tripTitleAccent(ledger: ReiseLedger, used: string): string | null {
  const a = amenitySet(ledger);
  const u = used.toLowerCase();
  const meals = ledger.meals?.value;
  if (meals === 'all' && !/all.?inclusive|ai\b|inklusive/.test(u)) return 'All Inclusive';
  if (a.has('pool') && !/\bpool\b/.test(u)) return 'Pool';
  if ((a.has('spa') || a.has('sauna')) && !/\bspa|thermal|wellness|sauna\b/.test(u)) return 'Spa';
  if (a.has('party') && !/\bparty|club|feier\b/.test(u)) return 'Party';
  if (a.has('grill') && !/\bgrill\b/.test(u)) return 'Grill';
  if (a.has('padel') && !/\bpadel\b/.test(u)) return 'Padel';
  if (a.has('tennis') && !/\btennis\b/.test(u)) return 'Tennis';
  return null;
}

/**
 * Ein Titel, der die Reise greift: Hook · Ort · optional Akzent.
 * Dynamisch aus Ledger/Option — kein fester Satzkatalog.
 */
export function composeTripShelfTitle(trip: ReiseTrip): string {
  const ledger = trip.ledger;
  const hook = tripTitleHook(ledger);
  const place = tripTitlePlace(trip);
  const used = [hook, place].filter(Boolean).join(' ');
  const accent = tripTitleAccent(ledger, used);

  const parts: string[] = [];
  if (hook) parts.push(hook);
  if (place && !(hook && hook.toLowerCase().includes(place.toLowerCase()))) {
    parts.push(place);
  }
  if (accent && parts.length < 3) parts.push(accent);

  if (parts.length) return parts.join(' · ').slice(0, MAX_TITLE);

  const when = ledger.dateStart?.value;
  const n = ledger.adults?.value;
  if (when && n) return `${when} · ${n} Leute`.slice(0, MAX_TITLE);
  if (n) return `${n} Leute`;
  return (trip.name?.trim() && trip.name !== 'Neue Reise' ? trip.name : 'Reise').slice(
    0,
    MAX_TITLE,
  );
}
