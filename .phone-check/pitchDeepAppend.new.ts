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

  if (opts.req.kind !== 'food' && opts.req.kind !== 'bar') return;

  void (async () => {
    try {
      const { runGastroMenuDeepResearch } = await import(
        '../agents/gastroMenuDeepResearch'
      );
      const queryHint =
        opts.req.kind === 'bar' ? 'Getränkekarte Drinks' : 'Speisekarte Menu';
      const dishBit = dishWish ? ` ${dishWish} Preis` : '';
      const res = await runGastroMenuDeepResearch({
        userText: `${opts.req.title} ${opts.req.context} ${queryHint}${dishBit}`,
        venues: opts.options.map((c) => ({
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
        live.options.map(async (opt) => {
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
        const needle = opt.name.toLowerCase().slice(0, 18);
        const byName = namedUrls.find((u) =>
          u.label.toLowerCase().includes(needle),
        );
        const fromBtn = asMenu(byName?.url, byName?.label);
        const fromDeep = deepById.get(opt.id) ?? null;
        const fromSeed = asMenu(live.options[index]?.menuUrl);
        return fromDeep || fromBtn || fromSeed || null;
      };

      const facts = String(res.draftText ?? '');
      for (let i = 0; i < live.options.length; i++) {
        const opt = live.options[i]!;
        const url = pickUrlForVenue(opt, i);
        const menuOrSite = url || opt.websiteUrl || null;
        menuUrls[opt.id] = url;
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
        const priceRe = new RegExp(
          `${opt.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]{0,80}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
          'i',
        );
        const dishPriceRe = dishWish
          ? new RegExp(
              `${dishWish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]{0,40}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
              'i',
            )
          : null;
        const pm =
          facts.match(priceRe) ||
          (dishPriceRe ? facts.match(dishPriceRe) : null) ||
          facts.match(/(\d+[.,]\d{2}\s*€)/);
        if (pm?.[1]) {
          const hint = dishWish ? `${dishWish} ~${pm[1]}` : `Preis ~${pm[1]}`;
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
