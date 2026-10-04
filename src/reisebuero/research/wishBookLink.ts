/**
 * Ticket-/Club-Deeplinks: OSM-Website zuerst, sonst GYG/Tiqets mit Stadt + Datum.
 * Yorro verkauft nichts — nur Partner-Suche, so weit wie möglich vorausgefüllt.
 * Kein affiliateService-Import (RN) — nur leichte Deep-Link-Helfer.
 */

import {
  toTiqetsDeepLanding,
  withGygDateAdults,
} from '../../services/affiliate/partnerBookingDeepLink';
import type { ReiseLedger, ReiseOption } from '../types';
import type { WishEvidence } from './wishEvidenceHarvest';

function dateIso(ledger: ReiseLedger, opt: ReiseOption): string | null {
  return (
    ledger.dateStart?.value ||
    opt.comboWindows?.[0]?.checkin ||
    opt.transports?.[0]?.departDateKey ||
    null
  );
}

function adultsOf(ledger: ReiseLedger): number {
  const n = ledger.adults?.value;
  return n != null && n > 0 ? Math.min(8, Math.floor(n)) : 2;
}

function ticketQuery(id: string, ev: WishEvidence | undefined, opt: ReiseOption): string {
  const named = (ev?.name || '').trim();
  const place = (opt.placeName || '').trim();
  if (named && place && !named.toLowerCase().includes(place.toLowerCase())) {
    return `${named} ${place}`;
  }
  if (named) return named;
  const labels: Record<string, string> = {
    club: 'nightclub',
    activity: 'tickets',
    stadium: 'tickets stadium',
    tour: 'guided tour',
    sight: 'tickets sightseeing',
    museum: 'museum tickets',
    concert: 'concert festival tickets',
    padel: 'padel',
    tennis: 'tennis court',
  };
  const hint = labels[id] || id;
  return [hint, place].filter(Boolean).join(' ').trim() || place;
}

function gygSearch(q: string, adults: number, date: string | null): string {
  const base = `https://www.getyourguide.com/s/?q=${encodeURIComponent(q)}&partner_id=ZVQGONB&cmp=findus_app`;
  return withGygDateAdults(base, { adults, dateIso: date, query: q });
}

function tiqetsSearch(q: string, adults: number, date: string | null): string {
  const landing = `https://www.tiqets.com/de/search/?q=${encodeURIComponent(q)}`;
  return toTiqetsDeepLanding(landing, { dateIso: date, adults });
}

export function wishChapterBookUrl(
  mustHaveId: string,
  ev: WishEvidence | undefined,
  opt: ReiseOption,
  ledger: ReiseLedger,
): string | null {
  const site = (ev?.bookUrl || '').trim();
  if (/^https?:\/\//i.test(site) && !/facebook|instagram|twitter/i.test(site)) {
    return site;
  }
  const q = ticketQuery(mustHaveId, ev, opt);
  if (!q) return null;
  const date = dateIso(ledger, opt);
  const adults = adultsOf(ledger);
  const clubby = /club|activity|tour|padel|tennis|boat|concert/i.test(mustHaveId);
  return clubby ? gygSearch(q, adults, date) : tiqetsSearch(q, adults, date);
}

/** Wiki-Beats wenn OSM/Web kein Foto haben — stadt-agnostisch. */
export function wishPhotoWikiTitles(mustHaveId: string): string[] {
  const id = (mustHaveId || '').toLowerCase();
  if (id === 'club') return ['Nightclub', 'Discothek', 'Nightclub interior'];
  if (id === 'sand' || id === 'sea') return ['Beach', 'Strand', 'Coast'];
  if (id === 'padel') return ['Padel', 'Padel court'];
  if (id === 'tennis') return ['Tennis court', 'Tennis'];
  if (id === 'stadium') return ['Football stadium', 'Stadion'];
  if (id === 'tour') return ['Sightseeing', 'City tour'];
  if (id === 'sight') return ['Landmark', 'Sehenswürdigkeit'];
  if (id === 'museum') return ['Museum', 'Art museum'];
  if (id === 'concert') return ['Concert', 'Music festival', 'Open air concert'];
  if (id === 'boat') return ['Marina', 'Boat rental'];
  if (id === 'activity') return ['Nightlife', 'Concert'];
  if (id === 'pool') return ['Hotel swimming pool', 'Swimming pool'];
  if (id === 'grill') return ['Barbecue', 'Grill'];
  if (id === 'spa' || id === 'sauna') return ['Spa', 'Sauna'];
  return [];
}
