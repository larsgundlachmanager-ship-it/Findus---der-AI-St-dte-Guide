/**
 * Welche Vertiefung als Nächstes — Struktur, kein Wortlaut.
 */

import type { MustHaveId, ReiseLedger } from './types';

type VibeGap = { key: string; label: string; tier: 'red' | 'yellow' | 'green' };

export type TripVibe = {
  party: boolean;
  spa: boolean;
  kids: boolean;
  wine: boolean;
  sport: boolean;
  water: boolean;
  hop: boolean;
};

function blob(ledger: ReiseLedger): string {
  return [
    ledger.purpose?.value,
    ledger.energy?.value,
    ledger.partyStyle?.value,
    ledger.spaStyle?.value,
    ledger.kidsStyle?.value,
    ledger.tripShape?.value,
    ledger.ideaHook?.value,
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

function amenity(ledger: ReiseLedger, id: MustHaveId): boolean {
  return (ledger.mustHaves?.value ?? []).includes(id) || (ledger.wishHaves?.value ?? []).includes(id);
}

export function detectTripVibes(ledger: ReiseLedger): TripVibe {
  const t = blob(ledger);
  const kidsCount = ledger.children?.value ?? 0;
  return {
    party:
      amenity(ledger, 'party') ||
      /party|feier|club|kneipe|männerwochenende|maennerwochenende|jungs/.test(t),
    spa:
      (amenity(ledger, 'spa') || amenity(ledger, 'sauna') || amenity(ledger, 'massage')) &&
      ledger.spaStyle?.value !== 'kein Spa' &&
      !/party|männer|maenner|jungs|feier/i.test(ledger.purpose?.value ?? ''),
    kids: kidsCount > 0 || /kind|familie|tui|kinderclub|animation/.test(t),
    wine: amenity(ledger, 'wine') || /wein|winzer|weinfest/.test(t),
    sport:
      amenity(ledger, 'tennis') ||
      amenity(ledger, 'riding') ||
      amenity(ledger, 'padel') ||
      amenity(ledger, 'paddle') ||
      /tennis|reit|padel|sport|camp/.test(t),
    water:
      amenity(ledger, 'sea') ||
      amenity(ledger, 'sand') ||
      amenity(ledger, 'paddle') ||
      amenity(ledger, 'boat') ||
      /meer|strand|kanu|kajak|boot/.test(t),
    hop:
      /rumreisen|rundreise|roadtrip|mehrere\s+st[aä]dt|städte\s*hop|staedte\s*hop|kreuzfahrt/.test(
        t,
      ) || ledger.tripShape?.value === 'hop' ||
      ledger.tripShape?.value === 'roadtrip' ||
      ledger.tripShape?.value === 'cruise',
  };
}

export function vibeGaps(ledger: ReiseLedger): VibeGap[] {
  const v = detectTripVibes(ledger);
  const gaps: VibeGap[] = [];
  if (v.party && !ledger.partyStyle) {
    gaps.push({ key: 'partyStyle', label: 'Feier-Korn', tier: 'yellow' });
  }
  if (v.spa && !ledger.spaStyle) {
    gaps.push({ key: 'spaStyle', label: 'Spa-Korn', tier: 'yellow' });
  }
  if (v.kids && !ledger.kidsStyle) {
    gaps.push({ key: 'kidsStyle', label: 'Kinder', tier: 'yellow' });
  }
  if ((v.wine || v.hop) && !ledger.tripShape) {
    gaps.push({ key: 'tripShape', label: 'Reiseform', tier: 'yellow' });
  }
  return gaps;
}

export function probeDirection(key: string): string {
  switch (key) {
    case 'partyStyle':
      return 'Feier-Korn: Clubs vs Bars vs Tanzen, Größe, Open Air — nicht ob sie feiern wollen';
    case 'spaStyle':
      return 'Spa-Korn: Pool vs Sand/Meer vs Massage vs Sauna; Adult-only nur wenn Kinder unklar';
    case 'kidsStyle':
      return 'Kinder: was sie mögen; Kids-Club / Familienhaus / Abgeben nur wenn offen';
    case 'tripShape':
      return 'Reiseform: ein Hub vs mehrere Orte vs Roadtrip vs Kreuzfahrt — als Frage, ohne Live-Fakten';
    case 'origin':
      return 'Startort: von wo los, oder woanders treffen — keine Stadt als Pflichtziel';
    case 'directFlight':
      return 'Direktflug ja/nein, nur wenn Flug schon steht';
    case 'wrap_up':
      return 'Abschluss: Suche starten? Keine neue Kategorie';
    case 'weather':
      return 'Wetter: eher warm / egal — kurz';
    case 'ideaHook':
      return 'Eine passende Idee als Frage, nur wenn der Vibe sitzt — User darf nein sagen';
    default:
      return '';
  }
}

export function shouldFloatIdea(ledger: ReiseLedger, asked: string[]): boolean {
  if (ledger.ideaHook) return false;
  if (asked.includes('ideaHook') || asked.includes('wrap_up')) return false;
  const v = detectTripVibes(ledger);
  if (v.party) return false;
  const nights = ledger.stayNights?.value ?? 0;
  if (v.kids && ledger.kidsStyle && v.sport) return true;
  if (v.hop && !ledger.tripShape) return true;
  if (nights >= 6 && v.wine && !ledger.tripShape) return true;
  return false;
}

export function vibeDigest(ledger: ReiseLedger): string {
  const v = detectTripVibes(ledger);
  const bits: string[] = [];
  if (v.party) bits.push(ledger.partyStyle ? `Party (${ledger.partyStyle.value})` : 'Party (Korn offen)');
  if (v.spa) bits.push(ledger.spaStyle ? `Spa (${ledger.spaStyle.value})` : 'Spa (Korn offen)');
  if (v.kids) {
    const n = ledger.children?.value;
    bits.push(
      ledger.kidsStyle
        ? `Kinder${n ? ` ${n}` : ''} (${ledger.kidsStyle.value})`
        : `Kinder${n ? ` ${n}` : ''} (Setup offen)`,
    );
  }
  if (v.wine) bits.push('Wein');
  if (v.sport) bits.push('Sport');
  if (v.water) bits.push('Wasser');
  if (ledger.tripShape) bits.push(`Form ${ledger.tripShape.value}`);
  else if (v.hop) bits.push('Form offen (Hop/Roadtrip/Kreuzfahrt?)');
  return bits.join(' · ') || 'noch kein klares Vibe';
}
