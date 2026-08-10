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
      const urls: string[] = [];
      for (const b of buttons) {
        const url =
          b.payload &&
          typeof b.payload === 'object' &&
          'url' in b.payload &&
          typeof (b.payload as { url?: unknown }).url === 'string'
            ? (b.payload as { url: string }).url.trim()
            : '';
        if (url && isSafeOfferUrl(url) && !urls.includes(url)) urls.push(url);
      }

      const facts = String(res.draftText ?? '');
      for (let i = 0; i < live.options.length; i++) {
        const opt = live.options[i]!;
        const url = urls[i] ?? urls[0] ?? null;
        menuUrls[opt.id] = url;
        if (url) {
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
          });
        }
        const priceRe = new RegExp(
          `${opt.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]{0,80}?(\\d+[.,]\\d{2}\\s*€|\\d+\\s*€)`,
          'i',
        );
        const pm = facts.match(priceRe) || facts.match(/(\d+[.,]\d{2}\s*€)/);
        if (pm?.[1]) {
          const hint = dishWish
            ? `${dishWish} ~${pm[1]}`
            : `Preis ~${pm[1]}`;
          priceBits.push(`${opt.name}: ${hint}`);
          bulletUpdates[opt.id] = [...opt.bullets.slice(0, 2), hint].slice(
            0,
            3,
          );
        }
      }

      let spokenAppend = '';
      if (priceBits.length) {
        spokenAppend = dishWish
          ? `Kurz zu ${dishWish}: ${priceBits.join(' · ')}.`
          : `Noch zu den Preisen: ${priceBits.join(' · ')}.`;
      } else if (urls.length) {
        spokenAppend = 'Speisekarten habe ich unten verlinkt.';
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
