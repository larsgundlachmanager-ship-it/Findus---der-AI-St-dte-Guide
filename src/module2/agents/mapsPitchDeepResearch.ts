/**
 * Slow-Lane: Google-Maps-Pitch für Hotels / Museen / Venues nachreichen.
 */

import type { AgentResult, Module2ActionButton } from '../types';
import { shortenActionLabel } from '../../services/concierge/actionLabelShorten';
import {
  buildMapsVenuePitch,
  detectMapsPitchKind,
  type HotelSellFacts,
  type MapsPitchKind,
} from '../../services/research/venueMapsPitch';
import type { HotelLiveStay } from '../../services/concierge/hotelAvailabilityService';
import {
  buildGetYourGuideSearchUrl,
  preferTicketSource,
} from '../../services/affiliate/affiliateService';
import {
  classifyVenueOfferKind,
  shouldDiscoverVenueOffers,
} from '../../services/research/venueOfferDiscovery';

export type MapsPitchVenueInput = {
  name: string;
  placeId?: string | null;
  lat?: number | null;
  lng?: number | null;
  websiteUrl?: string | null;
  /** Hotel live sell */
  stay?: HotelLiveStay | null;
  role?: HotelSellFacts['role'];
  bookUrl?: string | null;
};

export type MapsPitchDeepInput = {
  userText: string;
  kind?: MapsPitchKind;
  city?: string | null;
  venues: MapsPitchVenueInput[];
  alreadySaid: string;
  anchor: { lat: number; lng: number };
  checkin?: string;
  checkout?: string;
  adults?: number;
  signal?: AbortSignal;
};

function looksNovel(pitch: string, already: string): boolean {
  const a = already.toLowerCase();
  const tokens = pitch
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 5)
    .slice(0, 12);
  let hit = 0;
  for (const w of tokens) if (a.includes(w)) hit += 1;
  return hit < Math.max(4, Math.floor(tokens.length * 0.55));
}

export async function runMapsPitchDeepResearch(
  input: MapsPitchDeepInput,
): Promise<AgentResult> {
  const kind =
    input.kind ??
    detectMapsPitchKind(input.userText + ' ' + (input.venues[0]?.name ?? ''));
  const venues = input.venues.slice(0, 2);
  if (!venues.length) {
    return {
      agent: 'deep_research',
      ok: true,
      draftText: '',
      slowLane: true,
      meta: { silent: true, reason: 'no_venues' },
    };
  }

  const findings: string[] = [];
  const buttons: Module2ActionButton[] = [];
  let spokenExtra = '';

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i]!;
    const hotelSell: HotelSellFacts | null =
      kind === 'hotel' &&
      v.stay &&
      input.checkin &&
      input.checkout &&
      v.stay.priceTotal != null
        ? {
            stay: v.stay,
            role: v.role ?? (i === 0 ? 'günstigste' : 'qualität'),
            checkin: input.checkin,
            checkout: input.checkout,
            adults: input.adults ?? 2,
            distHint: null,
          }
        : null;

    try {
      const pitch = await buildMapsVenuePitch({
        kind,
        query: `${v.name} ${input.city ?? ''}`.trim(),
        placeId: v.placeId,
        lat: v.lat ?? input.anchor.lat,
        lng: v.lng ?? input.anchor.lng,
        userText: input.userText,
        hotelSell,
        signal: input.signal,
      });

      if (!pitch.spokenPitch.trim()) continue;
      if (!looksNovel(pitch.spokenPitch, input.alreadySaid + spokenExtra)) {
        // trotzdem Buttons nachreichen
      } else {
        spokenExtra = spokenExtra
          ? `${spokenExtra} ${pitch.spokenPitch}`
          : pitch.spokenPitch;
        findings.push(`${v.name}: Maps-Pitch + Reviews verdichtet`);
      }

      const bookUrl = v.bookUrl || v.stay?.bookUrl || null;
      if (bookUrl) {
        const price =
          v.stay?.priceTotal != null
            ? ` ab ${Math.round(v.stay.priceTotal)}€`
            : '';
        let tracked = bookUrl;
        try {
          const { normalizeAffiliateUrl } = require('../../services/affiliate/affiliateService') as {
            normalizeAffiliateUrl: (u: string) => string;
          };
          tracked = normalizeAffiliateUrl(bookUrl);
        } catch {
          /* soft */
        }
        buttons.push({
          id: `pitch_book_${i}`,
          label: shortenActionLabel(
            `🏨 ${v.name.split(/[|,]/)[0]!.trim().slice(0, 12)}${price}`,
          ),
          payload: {
            kind: 'deep_link',
            url: tracked,
            destName: v.name.split(/[|,]/)[0]!.trim(),
          },
        });
      }
      const web = pitch.place?.websiteUri || v.websiteUrl;
      if (web && kind !== 'hotel') {
        buttons.push({
          id: `pitch_web_${i}`,
          label: shortenActionLabel(
            `${v.name.slice(0, 12)} → Web`,
          ),
          payload: { kind: 'deep_link', url: web },
        });
      }
      if (kind === 'museum' || kind === 'attraction') {
        const offerKind = classifyVenueOfferKind(
          v.name,
          input.userText + ' ' + (input.city ?? ''),
        );
        const ticketQ = `${v.name} ${input.city ?? ''} Tickets`.trim();
        const url =
          preferTicketSource({
            kind:
              offerKind === 'museum'
                ? 'museum'
                : offerKind === 'harbor' || offerKind === 'attraction_tour'
                  ? 'tour'
                  : 'attraction',
            query: ticketQ,
          }).url || buildGetYourGuideSearchUrl(ticketQ);
        buttons.push({
          id: `pitch_tickets_${i}`,
          label: shortenActionLabel(
            offerKind === 'harbor' ? '⛴️ Touren' : '🎫 Tickets',
          ),
          payload: {
            kind: 'deep_link',
            url,
          },
        });
      } else if (shouldDiscoverVenueOffers(v.name, input.userText)) {
        const ticketQ = `${v.name} ${input.city ?? ''}`.trim();
        buttons.push({
          id: `pitch_tickets_${i}`,
          label: shortenActionLabel('🎟️ Tickets'),
          payload: {
            kind: 'deep_link',
            url: preferTicketSource({ kind: 'generic', query: ticketQ }).url,
          },
        });
      }
    } catch {
      /* soft */
    }
  }

  if (!spokenExtra.trim() && !buttons.length) {
    return {
      agent: 'deep_research',
      ok: true,
      draftText: '',
      slowLane: true,
      meta: { silent: true, reason: 'no_pitch' },
    };
  }

  // Hotel: Fast-Lane hat schon gepitcht — Slow-Lane nur Buttons (kein 2./8× Vorlesen)
  if (kind === 'hotel') {
    return {
      agent: 'deep_research',
      ok: true,
      draftText: '',
      bullets: findings.slice(0, 3),
      buttons: buttons.slice(0, 4),
      slowLane: true,
      meta: {
        silent: true,
        mapsPitch: true,
        kind,
        spokenExtra: null,
      },
    };
  }

  const draft = spokenExtra.trim()
    ? [
        'FAKTEN Maps-Pitch Deep-Research (nicht wörtlich vorlesen):',
        ...findings,
        `Pitch-Text: ${spokenExtra}`,
        'FLOW: Kurz nachreichen — Flair/Reviews. Keine Doppel-Begrüßung.',
      ].join('\n')
    : '';

  return {
    agent: 'deep_research',
    ok: true,
    draftText: draft,
    bullets: findings.slice(0, 3),
    buttons: buttons.slice(0, 4),
    slowLane: true,
    meta: {
      silent: !draft,
      mapsPitch: true,
      kind,
      spokenExtra: spokenExtra.trim() || null,
    },
  };
}
