/**
 * Reine Stadt-Chat-Partition — testbar ohne RN/Expo.
 */

import { foldCityKey } from '../../services/navigation/landmarkAliases';

export type CityChatScopeSource =
  | 'explicit'
  | 'conversation'
  | 'active'
  | 'gps'
  | 'profile'
  | 'live_label';

export type CityChatScope = {
  cityHint: string | null;
  cityKey: string;
  source: CityChatScopeSource;
};

/** Kurzes Follow-up / Anapher — Sticky-Stadt (auch Sidequest) behalten. */
export function keepCityStickyForFollowUp(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // Supermarkt-Prospekt / Produktangebot → GPS/Active, nie Flug-Sticky (Athen).
  try {
    const { isSupermarketOfferQuery } = require('../../services/research/supermarketProspectGates') as {
      isSupermarketOfferQuery: (s: string) => boolean;
    };
    if (isSupermarketOfferQuery(t)) return false;
  } catch {
    /* soft */
  }
  // Wetter/Outfit ohne „hier“ → Gesprächsstadt behalten (Athen-Talk → Athen-Wetter)
  if (/\b(wetter|regen|temperatur|anziehen|outfit|wie\s+kalt|wie\s+warm)\b/iu.test(t)) {
    if (/\b(hier|vor\s+ort|wo\s+ich\s+(?:gerade\s+)?(?:bin|stehe))\b/iu.test(t)) {
      return false;
    }
    return true;
  }
  // Neue Suche / Empfehlungsfrage → Sticky nicht behalten
  if (
    /\b(?:wo(?:hin)?|zeig|such|find|empfehl|restaurant|hotel|café|cafe|essen|trinken|parkplatz|kino|museum|tour|rundgang|angebot|prospekt|supermarkt)\b/iu.test(
      t,
    ) &&
    !/\b(?:wie\s+teuer|preis|davon|dazu|ja|nein|ok|okay|gerne|passt)\b/iu.test(t)
  ) {
    return false;
  }
  if (
    /\b(?:ja|nein|ok|okay|gerne|passt|mach|los|klar|wie\s+teuer|preis|tickets?|davon|dazu|dafür|und\s+dann|was\s+noch|mehr\s+dazu|warum|wieso|weshalb|welche\s+uhrzeit)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  // Ultra-kurz + Anapher
  if (t.length <= 16) return true;
  if (
    t.length <= 32 &&
    /\b(?:das|es|dort|da|der|die|den|dem|dieser|dieses)\b/iu.test(t)
  ) {
    return true;
  }
  return false;
}

export function computeCityChatScope(opts: {
  userText?: string | null;
  activeCity?: string | null;
  stickyCity?: string | null;
  explicitCity?: string | null;
  liveInventoryOpen?: boolean;
}): CityChatScope {
  const active = (opts.activeCity || '').trim() || null;
  const activeKey = foldCityKey(active) || 'unknown';
  const text = (opts.userText || '').trim();
  const explicit = (opts.explicitCity || '').trim() || null;

  if (explicit) {
    return {
      cityHint: explicit,
      cityKey: foldCityKey(explicit) || 'unknown',
      source: 'explicit',
    };
  }

  if (!text) {
    return {
      cityHint: active,
      cityKey: activeKey,
      source: 'active',
    };
  }

  const sticky = (opts.stickyCity || '').trim() || null;
  const stickyKey = sticky ? foldCityKey(sticky) || 'unknown' : 'unknown';

  if (sticky && stickyKey !== 'unknown') {
    const keep =
      opts.liveInventoryOpen ||
      keepCityStickyForFollowUp(text) ||
      stickyKey === activeKey;
    if (keep) {
      return {
        cityHint: sticky,
        cityKey: stickyKey,
        source: stickyKey === activeKey ? 'conversation' : 'conversation',
      };
    }
  }

  return {
    cityHint: active,
    cityKey: activeKey,
    source: 'active',
  };
}
