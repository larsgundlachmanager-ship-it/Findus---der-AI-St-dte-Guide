/**
 * Action-Buttons: Affiliate > Maps; Gastro Maps+Menü; etc.
 */

import type { QuickAction } from '../../types/concierge';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import type { PitchKind, PitchOptionCard } from './types';

function label(s: string): string {
  return shortenActionLabel(s, 28);
}

export function buildPitchActions(opts: {
  kind: PitchKind;
  name: string;
  lat: number;
  lng: number;
  mapsUrl: string;
  menuUrl?: string | null;
  bookingUrl?: string | null;
  ticketUrl?: string | null;
  websiteUrl?: string | null;
  role?: 'favorite' | 'alternative' | 'out_of_box';
}): QuickAction[] {
  const actions: QuickAction[] = [];
  const medal =
    opts.role === 'favorite' ? '🥇' : opts.role === 'alternative' ? '🥈' : '✨';

  if (opts.kind === 'hotel' && opts.bookingUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: label(`${medal} ${opts.name}`),
      payload: { url: opts.bookingUrl, destName: opts.name },
    });
    return actions;
  }

  if (opts.kind === 'tour' && opts.ticketUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: label(`${medal} Ticket`),
      payload: { url: opts.ticketUrl, destName: opts.name },
    });
  }

  // Maps immer für Gastro/Sight/Kino (Bilder) — außer Hotel mit Affiliate-only
  if (!(opts.kind === 'hotel' && opts.bookingUrl)) {
    actions.push({
      type: 'OPEN_URL',
      label: label(`🗺️ ${opts.name}`),
      payload: { url: opts.mapsUrl, destName: opts.name },
    });
  }

  if (
    (opts.kind === 'food' || opts.kind === 'bar') &&
    opts.menuUrl
  ) {
    actions.push({
      type: 'OPEN_URL',
      label: label(opts.kind === 'bar' ? '🍹 Karte' : '🍽 Speisekarte'),
      payload: { url: opts.menuUrl, destName: opts.name },
    });
  }

  if (opts.kind === 'cinema' && opts.websiteUrl) {
    actions.push({
      type: 'OPEN_URL',
      label: label('🌐 Programm'),
      payload: { url: opts.websiteUrl, destName: opts.name },
    });
  }

  if (!actions.length) {
    actions.push({
      type: 'START_NAVIGATION',
      label: label(`📍 ${opts.name}`),
      payload: {
        destName: opts.name,
        destLat: opts.lat,
        destLng: opts.lng,
      },
    });
  }

  return actions.slice(0, 3);
}

export function mergeActionUpdates(
  card: PitchOptionCard,
  patch: Partial<PitchOptionCard>,
): PitchOptionCard {
  return {
    ...card,
    ...patch,
    actions: patch.actions ?? card.actions,
    bullets: patch.bullets ?? card.bullets,
  };
}
