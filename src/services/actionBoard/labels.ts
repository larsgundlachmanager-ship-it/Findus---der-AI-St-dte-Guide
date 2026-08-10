/**
 * ActionBoard Labels — 🥇/🥈 für Favoriten, konkrete Einzel-Labels sonst.
 */

import { shortenActionLabel } from '../concierge/actionLabelShorten';
import type { ActionEntity, ActionOpportunityKind } from './types';

const INTENT_EMOJI: Partial<Record<ActionOpportunityKind, string>> = {
  route: '📍',
  maps: '🗺️',
  menu_food: '📜',
  menu_drinks: '🍹',
  reserve_table: '📅',
  tickets: '🎟️',
  tour_guide: '🗣️',
  hotel_book: '🛏️',
  esim: '📱',
  wifi_place: '📶',
  expand: '✨',
  weather: '🌦️',
  transit: '🚇',
  taxi: '🚕',
  parking: '🅿️',
  luggage: '🧳',
  phone: '📞',
  website: '🔗',
  shopping: '🛒',
};

const INTENT_WORD: Partial<Record<ActionOpportunityKind, string>> = {
  route: 'Route',
  maps: 'Maps',
  menu_food: 'Speisekarte',
  menu_drinks: 'Getränkekarte',
  reserve_table: 'Tisch reservieren',
  tickets: 'Tickets',
  tour_guide: 'Führung',
  hotel_book: 'Hotel buchen',
  esim: 'eSIM holen',
  wifi_place: 'WLAN-Ort',
  expand: 'Noch mehr',
  weather: 'Wetter',
  transit: 'ÖPNV',
  taxi: 'Taxi',
  parking: 'Parken',
  luggage: 'Gepäck',
  phone: 'Anrufen',
  website: 'Webseite',
  shopping: 'Shop',
};

/** Mediale Kurz-Labels für 1./2. Wahl — Namen nur in a11y/payload. */
export function medalIntentLabel(
  kind: ActionOpportunityKind,
  rank: 1 | 2,
  opts?: { pending?: boolean; affiliate?: boolean },
): string {
  const word = INTENT_WORD[kind] ?? 'Öffnen';
  const medal = rank === 1 ? '🥇' : '🥈';
  const pending = opts?.pending ? '…' : '';
  const star = opts?.affiliate ? '*' : '';
  return shortenActionLabel(`${medal} ${word}${pending}${star}`);
}

/** Einzel-Entity: Name + Intent (z. B. Hotel). */
export function singleEntityLabel(
  kind: ActionOpportunityKind,
  entityName: string,
  opts?: { pending?: boolean; affiliate?: boolean },
): string {
  const emoji = INTENT_EMOJI[kind] ?? '🔗';
  const word = INTENT_WORD[kind] ?? 'Öffnen';
  const name = entityName.replace(/\s+/g, ' ').trim();
  const pending = opts?.pending ? '…' : '';
  const star = opts?.affiliate ? '*' : '';
  if (kind === 'hotel_book') {
    return shortenActionLabel(`${emoji} Hotel buchen${pending}${star}`);
  }
  if (kind === 'expand') {
    return shortenActionLabel(`${emoji} Noch mehr${pending}`);
  }
  if (name && (kind === 'route' || kind === 'maps' || kind === 'website')) {
    const short = name.length > 16 ? `${name.slice(0, 14).trim()}…` : name;
    return shortenActionLabel(`${emoji} ${short}${pending}${star}`);
  }
  return shortenActionLabel(`${emoji} ${word}${pending}${star}`);
}

export function labelForOpportunity(
  kind: ActionOpportunityKind,
  entity: ActionEntity | undefined,
  opts?: {
    multiChoice?: boolean;
    pending?: boolean;
    affiliate?: boolean;
  },
): string {
  if (opts?.multiChoice && entity) {
    if (kind === 'hotel_book') {
      const short = entity.name.split(/[|,]/)[0]!.trim().slice(0, 12);
      const medal = entity.rank === 1 ? '🥇' : '🥈';
      const pending = opts?.pending ? '…' : '';
      const star = opts?.affiliate ? '*' : '';
      return shortenActionLabel(`${medal} ${short}${pending}${star}`);
    }
    return medalIntentLabel(kind, entity.rank, opts);
  }
  if (entity && (kind === 'hotel_book' || !opts?.multiChoice)) {
    if (kind === 'hotel_book') {
      const short = entity.name.split(/[|,]/)[0]!.trim().slice(0, 14);
      const emoji = INTENT_EMOJI.hotel_book ?? '🛏️';
      const pending = opts?.pending ? '…' : '';
      const star = opts?.affiliate ? '*' : '';
      return shortenActionLabel(`${emoji} ${short}${pending}${star}`);
    }
    if (opts?.multiChoice === false && entity.rank === 1) {
      return singleEntityLabel(kind, entity.name, opts);
    }
  }
  if (entity && opts?.multiChoice !== false && entity.rank) {
    // Default: bei ≥2 Entities Medaillen — Aufrufer setzt multiChoice
  }
  if (entity) {
    return singleEntityLabel(kind, entity.name, opts);
  }
  return singleEntityLabel(kind, '', opts);
}

export function accessibilityLabelFor(
  kind: ActionOpportunityKind,
  entityName?: string,
): string {
  const word = INTENT_WORD[kind] ?? 'Aktion';
  return entityName ? `${word}: ${entityName}` : word;
}
