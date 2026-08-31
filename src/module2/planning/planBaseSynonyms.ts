/**
 * Modul 5 — Basis-Synonyme: Zuhause / Hotel / Ferienwohnung → Plan-Base.
 */

import { useFuturePlanStore } from '../timeline/futurePlanState';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';

export type ResolvedPlanBase = {
  kind: 'home' | 'hotel' | 'other';
  label: string;
  lat: number | null;
  lng: number | null;
  synonym: string;
};

const HOME_RE =
  /\b(zuhause|zu\s*hause|nach\s*hause|heim|meine\s+basis|basis|heisterhoop|privatadresse|meine\s+adresse)\b/iu;
const HOTEL_RE =
  /\b(hotel|unterkunft|ferienwohnung|ferienhaus|apartment|airbnb|hostel|pension|check[\s-]?in|einchecken|auschecken)\b/iu;

export function looksLikeHomeSynonym(text: string): boolean {
  return HOME_RE.test(text || '');
}

export function looksLikeHotelSynonym(text: string): boolean {
  return HOTEL_RE.test(text || '');
}

/**
 * Löst „Zuhause“ / „Hotel“ gegen aktuelle Plan-Base + Memory auf.
 */
export function resolvePlanBaseDestination(
  text: string,
): ResolvedPlanBase | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const plan = useFuturePlanStore.getState().plan;
  const base = plan.base;
  const mem = useUserMemoryStore.getState();

  if (looksLikeHomeSynonym(t) && !looksLikeHotelSynonym(t)) {
    const homeEnt = mem.entities.find(
      (e) =>
        e.type === 'custom' &&
        /\b(zuhause|heim|basis|wohnung|adresse)\b/i.test(e.name),
    );
    const hotelAsHome =
      base?.kind === 'home'
        ? base
        : null;
    const label =
      (hotelAsHome?.label ||
        homeEnt?.name ||
        (base?.kind === 'home' ? base.label : null) ||
        'Zuhause') as string;
    const lat =
      hotelAsHome?.lat ??
      homeEnt?.lat ??
      (base?.kind === 'home' ? base.lat : null) ??
      null;
    const lng =
      hotelAsHome?.lng ??
      homeEnt?.lng ??
      (base?.kind === 'home' ? base.lng : null) ??
      null;
    return {
      kind: 'home',
      label: String(label || 'Zuhause'),
      lat: lat != null && Number.isFinite(lat) ? lat : null,
      lng: lng != null && Number.isFinite(lng) ? lng : null,
      synonym: 'Zuhause',
    };
  }

  if (looksLikeHotelSynonym(t) || (looksLikeHomeSynonym(t) && base?.kind === 'hotel')) {
    const hotelEnt = mem.entities
      .filter((e) => e.type === 'hotel')
      .sort((a, b) => (b.visitedAt || '').localeCompare(a.visitedAt || ''))[0];
    const label =
      (base?.kind === 'hotel' ? base.label : null) ||
      hotelEnt?.name ||
      'Hotel';
    const lat =
      (base?.kind === 'hotel' ? base.lat : null) ??
      hotelEnt?.lat ??
      null;
    const lng =
      (base?.kind === 'hotel' ? base.lng : null) ??
      hotelEnt?.lng ??
      null;
    return {
      kind: 'hotel',
      label: String(label),
      lat: lat != null && Number.isFinite(lat) ? lat : null,
      lng: lng != null && Number.isFinite(lng) ? lng : null,
      synonym: base?.kind === 'hotel' ? 'Hotel' : 'Unterkunft',
    };
  }

  return null;
}

/** Prompt-Zeile für Ingest/Agent. */
export function planBaseSynonymPromptBlock(): string {
  const plan = useFuturePlanStore.getState().plan;
  const base = plan.base;
  const lines = [
    'BASIS-SYNONYME:',
    '- „Zuhause / nach Hause / Heim / Basis“ → Plan-Base kind=home oder private Adresse.',
    '- „Hotel / Unterkunft / Ferienwohnung / einchecken“ → aktuelle Unterkunft (nie Stadtmitte-Fake).',
    '- Wecker/Erinnerung: KEIN Ort nötig.',
    '- Jeder echte Stop braucht wenn möglich lat/lng + Adresse/Label.',
  ];
  if (base) {
    lines.push(
      `Aktuelle Base: kind=${base.kind} label="${base.label}" coords=${
        base.lat != null && base.lng != null
          ? `${base.lat.toFixed(4)},${base.lng.toFixed(4)}`
          : 'fehlt'
      }`,
    );
  } else {
    lines.push('Aktuelle Base: keine gesetzt.');
  }
  return lines.join('\n');
}
