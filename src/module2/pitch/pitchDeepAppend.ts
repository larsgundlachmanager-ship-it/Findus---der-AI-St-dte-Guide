/**
 * Deep nachreichen: Preise / Menü — flüssig anhängen.
 */

import { isSafeOfferUrl } from '../planning/offerActionUtils';
import type { PitchDeepAppend, PitchKind, PitchOptionCard, PitchRequest } from './types';
import { buildPitchActions } from './pitchActions';

export type PitchSession = {
  requestId: string;
  selectedOptionId: string | null;
  options: PitchOptionCard[];
  kind: PitchKind;
  dishWish: string | null;
};

const sessions = new Map<string, PitchSession>();

export function registerPitchSession(s: PitchSession): void {
  sessions.set(s.requestId, s);
}

export function selectPitchOption(requestId: string, optionId: string): void {
  const s = sessions.get(requestId);
  if (!s) return;
  s.selectedOptionId = optionId;
  const chosen = s.options.find((o) => o.id === optionId);
  if (chosen?.name) {
    try {
      const { setLastPlaceName } = require('../context/shortTermContext') as {
        setLastPlaceName: (n: string | null) => void;
      };
      setLastPlaceName(chosen.name);
    } catch {
      /* soft */
    }
  }
}

export function getPitchSession(requestId: string): PitchSession | null {
  return sessions.get(requestId) ?? null;
}

export function clearPitchSession(requestId: string): void {
  sessions.delete(requestId);
}

/**
 * Startet Deep parallel. Callback wenn Append bereit.
 * Respektiert Tap: nur gewählte Option nach Select (Filter im Callback).
 */
export function startPitchDeepAppend(opts: {
  req: PitchRequest;
  options: PitchOptionCard[];
  onAppend: (append: PitchDeepAppend) => void;
}): void {
  const dishWish =
    opts.req.wishes.find((w) => w.kind === 'dish')?.text ?? null;

  registerPitchSession({
    requestId: opts.req.requestId,
    selectedOptionId: null,
    options: opts.options,
    kind: opts.req.kind,
    dishWish,
  });

  const blob = `${opts.req.title} ${opts.req.context}`;
  const rentalAsk =
    /\b(sup|stand[\s-]?up|paddle|verleih|miete|surf(?:brett)?|kajak|kanu|fahrradverleih|bike\s*rental)\b/i.test(
      blob,
    );

  const both = opts.options.slice(0, 2);

  // Hotel: Booking-Link für BEIDE Optionen nachziehen
  if (opts.req.kind === 'hotel') {
    void (async () => {
      try {
        const actionUpdates: Record<string, ReturnType<typeof buildPitchActions>> =
          {};
        const bulletUpdates: Record<string, string[]> = {};
        const priceBits: string[] = [];
        for (const opt of both) {
          let booking = String(opt.bookingUrl || '').trim();
          if (!booking || !isSafeOfferUrl(booking)) {
            try {
              const { buildPitchHotelBookingUrl } = require('./pitchBookingUrl') as {
                buildPitchHotelBookingUrl: (
                  name: string,
                  ctx: string,
                  city?: string | null,
                ) => string | null;
              };
              booking =
                buildPitchHotelBookingUrl(
                  opt.name,
                  `${opts.req.title} ${opts.req.context}`,
                  opts.req.cityHint,
                ) || '';
            } catch {
              booking = '';
            }
          }
          if (booking && isSafeOfferUrl(booking)) {
            actionUpdates[opt.id] = buildPitchActions({
              kind: 'hotel',
              name: opt.name,
              lat: opt.lat,
              lng: opt.lng,
              mapsUrl: opt.mapsUrl,
              bookingUrl: booking,
              websiteUrl: opt.websiteUrl,
              role: opt.role === 'out_of_box' ? 'alternative' : opt.role,
              suppressNav: true,
            });
          }
          const priceHint = (opt.bullets ?? []).find((b) => /\d+\s*€|€\s*\d+/u.test(b));
          if (priceHint) priceBits.push(`${opt.name}: ${priceHint}`);
          if (priceHint) {
            bulletUpdates[opt.id] = [priceHint, ...(opt.bullets ?? [])]
              .filter((b, i, a) => a.indexOf(b) === i)
              .slice(0, 3);
          }
        }
        if (!Object.keys(actionUpdates).length && !priceBits.length) return;
        opts.onAppend({
          requestId: opts.req.requestId,
          optionId: null,
          spokenAppend: priceBits.length
            ? `Noch zu den Preisen: ${priceBits.join(' · ')}.`
            : '',
          bulletUpdates,
          actionUpdates,
        });
      } catch {
        /* soft */
      }
    })();
    return;
  }

  // Kino: Ticket-Link + Preis für BEIDE Kinos nachziehen
  if (opts.req.kind === 'cinema') {
    void (async () => {
      try {
        const actionUpdates: Record<string, ReturnType<typeof buildPitchActions>> =
          {};
        const bulletUpdates: Record<string, string[]> = {};
        const priceBits: string[] = [];
        for (const opt of both) {
          const ticket = String(opt.ticketUrl || '').trim();
          const site = String(opt.websiteUrl || '').trim();
          const link = (ticket && isSafeOfferUrl(ticket) ? ticket : null) ||
            (site && isSafeOfferUrl(site) ? site : null);
          if (link) {
            actionUpdates[opt.id] = buildPitchActions({
              kind: 'cinema',
              name: opt.name,
              lat: opt.lat,
              lng: opt.lng,
              mapsUrl: opt.mapsUrl,
              websiteUrl: opt.websiteUrl,
              websiteLabel: 'Programm',
              ticketUrl: ticket && isSafeOfferUrl(ticket) ? ticket : null,
              role: opt.role === 'out_of_box' ? 'alternative' : opt.role,
              suppressNav: true,
            });
          }
          const priceHint = (opt.bullets ?? []).find((b) =>
            /\b(ticket|eintritt|preis|\d+[.,]?\d*\s*€)/iu.test(b),
          );
          if (priceHint) {
            priceBits.push(`${opt.name}: ${priceHint}`);
            bulletUpdates[opt.id] = [priceHint, ...(opt.bullets ?? [])]
              .filter((b, i, a) => a.indexOf(b) === i)
              .slice(0, 3);
          }
        }
        if (!Object.keys(actionUpdates).length && !priceBits.length) return;
        opts.onAppend({
          requestId: opts.req.requestId,
          optionId: null,
          spokenAppend: priceBits.length
            ? `Kurz zu den Tickets: ${priceBits.join(' · ')}.`
            : '',
          bulletUpdates,
          actionUpdates,
        });
      } catch {
        /* soft */
      }
    })();
    return;
  }

  // Gastro-Menü ODER Verleih-Preise (SUP/…) — Call-3-ähnlich nachhängen
  if (opts.req.kind !== 'food' && opts.req.kind !== 'bar' && !rentalAsk) {
    return;
  }

  if (rentalAsk && opts.req.kind !== 'food' && opts.req.kind !== 'bar') {
    void (async () => {
      try {
        const { fetchRentalPriceFromWebsite } = await import(
          '../../services/research/rentalPriceFromWebsite'
        );
        const priceBits: string[] = [];
        const bulletUpdates: Record<string, string[]> = {};
        const actionUpdates: Record<string, ReturnType<typeof buildPitchActions>> =
          {};
        // Immer beide Optionen parallel
        await Promise.all(
          both.map(async (opt) => {
            const url = String(opt.websiteUrl || opt.menuUrl || '').trim();
            if (!/^https?:\/\//i.test(url) || !isSafeOfferUrl(url)) return;
            const hit = await fetchRentalPriceFromWebsite({ url });
            if (hit?.label) {
              priceBits.push(`${opt.name}: ${hit.label}`);
              bulletUpdates[opt.id] = [
                hit.label,
                ...(opt.bullets ?? []).slice(0, 2),
              ].slice(0, 3);
            }
            actionUpdates[opt.id] = buildPitchActions({
              kind: opts.req.kind,
              name: opt.name,
              lat: opt.lat,
              lng: opt.lng,
              mapsUrl: opt.mapsUrl,
              menuUrl: opt.menuUrl,
              websiteUrl: opt.websiteUrl,
              role: opt.role === 'out_of_box' ? 'alternative' : opt.role,
              suppressNav: true,
            });
          }),
        );
        if (!priceBits.length && !Object.keys(actionUpdates).length) return;
        opts.onAppend({
          requestId: opts.req.requestId,
          optionId: null,
          spokenAppend: priceBits.length
            ? `Kurz zu den Preisen: ${priceBits.join(' · ')}.`
            : '',
          bulletUpdates,
          actionUpdates,
        });
      } catch {
        /* soft */
      }
    })();
    return;
  }

  void (async () => {
    try {
      // Top-2 Pitch: IMMER Speisekarte + Preis für beide Optionen nachholen
      const forceMenu = true;
      const forcePrice = true;

      const { runGastroMenuDeepResearch } = await import(
        '../agents/gastroMenuDeepResearch'
      );
      const queryHint =
        opts.req.kind === 'bar' ? 'Getränkekarte Drinks' : 'Speisekarte Menu';
      const dishBit =
        forcePrice && dishWish
          ? ` ${dishWish} Preis`
          : forcePrice
            ? ' Preis'
            : dishWish
              ? ` ${dishWish}`
              : '';
      const res = await runGastroMenuDeepResearch({
        userText: `${opts.req.title} ${opts.req.context} ${queryHint}${dishBit}`,
        venues: both.map((c) => ({
          name: c.name,
          websiteUrl: c.websiteUrl ?? null,
          menuUrl: c.menuUrl ?? null,
        })),
        alreadySaid: '',
      });

      const live = getPitchSession(opts.req.requestId);
      if (!live) return;

      const menuUrls: Record<string, string | null> = {};
      const actionUpdates: Record<string, ReturnType<typeof buildPitchActions>> =
        {};
      const bulletUpdates: Record<string, string[]> = {};
      const priceBits: string[] = [];

      const buttons = res.buttons ?? [];
      type NamedUrl = { url: string; label: string };
      const namedUrls: NamedUrl[] = [];
      for (const b of buttons) {
        const url =
          b.payload &&
          typeof b.payload === 'object' &&
          'url' in b.payload &&
          typeof (b.payload as { url?: unknown }).url === 'string'
            ? (b.payload as { url: string }).url.trim()
            : '';
        if (!url || !isSafeOfferUrl(url)) continue;
        if (namedUrls.some((u) => u.url === url)) continue;
        namedUrls.push({
          url,
          label: String((b as { label?: string }).label ?? ''),
        });
      }

      const asMenu = (url: string | null | undefined, label = ''): string | null => {
        const u = String(url ?? '').trim();
        if (!u || !isSafeOfferUrl(u)) return null;
        const lab = String(label || '').toLowerCase();
        if (
          /\b(speisekarte|menü|menue|karte|menu)\b/i.test(lab) &&
          !/maps|google/i.test(lab)
        ) {
          return u;
        }
        try {
          const { isMenuAssetUrl } = require('../planning/offerActionUtils') as {
            isMenuAssetUrl: (x: string) => boolean;
          };
          return isMenuAssetUrl(u) ? u : null;
        } catch {
          return /speisekarte|\/ugd\/|\.pdf|\/menu/i.test(u) ? u : null;
        }
      };

      const { findDeepestMenuLink } = await import(
        '../../services/actionBoard/menuDeepLink'
      );
      const deepKind = opts.req.kind === 'bar' ? 'drinks' : 'food';
      const deepHits = await Promise.all(
        live.options.slice(0, 2).map(async (opt) => {
          const site = String(opt.websiteUrl || '').trim();
          if (!site) return { id: opt.id, url: null as string | null };
          try {
            const hit = await findDeepestMenuLink({
              websiteUrl: site,
              kind: deepKind,
              signal: opts.req.signal,
            });
            return { id: opt.id, url: hit?.url ?? null };
          } catch {
            return { id: opt.id, url: null };
          }
        }),
      );
      const deepById = new Map(deepHits.map((h) => [h.id, h.url]));

      const pickUrlForVenue = (
        opt: PitchOptionCard,
        index: number,
      ): string | null => {
        const needle = opt.name.toLowerCase().slice(0, 12);
        const byName = namedUrls.find(
          (u) =>
            u.label.toLowerCase().includes(needle) ||
            needle.length >= 4 && u.url.toLowerCase().includes(needle.slice(0, 6)),
        );
        // Button-Payload destName match (beide Optionen)
        let fromBtnPayload: string | null = null;
        for (const b of buttons) {
          const dest =
            b.payload &&
            typeof b.payload === 'object' &&
            'destName' in b.payload
              ? String((b.payload as { destName?: string }).destName ?? '')
              : '';
          const url =
            b.payload &&
            typeof b.payload === 'object' &&
            'url' in b.payload
              ? String((b.payload as { url?: string }).url ?? '')
              : '';
          if (
            dest &&
            url &&
            dest.toLowerCase().includes(needle) &&
            isSafeOfferUrl(url)
          ) {
            fromBtnPayload = asMenu(url, String((b as { label?: string }).label ?? '')) || url;
            break;
          }
        }
        const fromBtn = asMenu(byName?.url, byName?.label);
        const fromDeep = deepById.get(opt.id) ?? null;
        const fromSeed = asMenu(live.options[index]?.menuUrl);
        const fromSite =
          opt.websiteUrl && isSafeOfferUrl(opt.websiteUrl) ? opt.websiteUrl : null;
        return fromDeep || fromBtnPayload || fromBtn || fromSeed || fromSite || null;
      };

      const facts = String(res.draftText ?? '');
      const usedPriceHints = new Set<string>();
      const targetOpts = live.options.slice(0, 2);
      for (let i = 0; i < targetOpts.length; i++) {
        const opt = targetOpts[i]!;
        const url = pickUrlForVenue(opt, i);
        const menuOrSite = url || opt.websiteUrl || null;
        menuUrls[opt.id] = url;
        // Immer Actions für beide Optionen (Link nachholen)
        if (menuOrSite) {
          actionUpdates[opt.id] = buildPitchActions({
            kind: opts.req.kind,
            name: opt.name,
            lat: opt.lat,
            lng: opt.lng,
            mapsUrl: opt.mapsUrl,
            menuUrl: url,
            bookingUrl: opt.bookingUrl,
            ticketUrl: opt.ticketUrl,
            websiteUrl: opt.websiteUrl,
            role: opt.role === 'out_of_box' ? 'alternative' : opt.role,
            suppressNav: true,
          });
        }
        const esc = opt.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const venueLineRe = new RegExp(
          `${esc}[^\\n]{0,120}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
          'i',
        );
        const dishPriceRe = dishWish
          ? new RegExp(
              `${esc}[^\\n]{0,80}?${dishWish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]{0,40}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
              'i',
            )
          : null;
        // Nie den ersten €-Treffer der ganzen Facts für Option 2 wiederverwenden
        const pm =
          facts.match(venueLineRe) ||
          (dishPriceRe ? facts.match(dishPriceRe) : null);
        let priceToken = pm?.[1]?.trim() || null;
        if (priceToken && usedPriceHints.has(`${opt.id}:${priceToken}`)) {
          priceToken = null;
        }
        // Fallback nur wenn genau eine Venue-Zeile mit diesem Namen und Preis
        if (!priceToken) {
          const lines = facts.split(/\n+/).filter((ln) =>
            ln.toLowerCase().includes(opt.name.toLowerCase().slice(0, 8)),
          );
          for (const ln of lines) {
            const m = ln.match(/(\d+[.,]\d{2}\s*€|\d+\s*€)/);
            if (m?.[1] && !usedPriceHints.has(m[1])) {
              priceToken = m[1];
              break;
            }
          }
        }
        if (priceToken) {
          usedPriceHints.add(priceToken);
          usedPriceHints.add(`${opt.id}:${priceToken}`);
          const hint = dishWish ? `${dishWish} ~${priceToken}` : `Preis ~${priceToken}`;
          priceBits.push(`${opt.name}: ${hint}`);
          const kept = opt.bullets.filter(
            (b) =>
              !/^(ambiente|frische\s+gerichte|freundliche\s+bedienung)/i.test(b),
          );
          bulletUpdates[opt.id] = [hint, ...kept].filter(Boolean).slice(0, 3);
        }
      }

      let spokenAppend = '';
      if (priceBits.length) {
        spokenAppend = dishWish
          ? `Kurz zu ${dishWish}: ${priceBits.join(' · ')}.`
          : `Noch zu den Preisen: ${priceBits.join(' · ')}.`;
      }
      // Auch ohne Preis: Links für beide Optionen trotzdem pushen
      if (!spokenAppend && !Object.keys(actionUpdates).length) return;

      opts.onAppend({
        requestId: opts.req.requestId,
        optionId: live.selectedOptionId,
        spokenAppend,
        bulletUpdates,
        actionUpdates,
        menuUrls,
      });
    } catch {
      /* soft */
    }
  })();
}
