/**
 * Voice-first Spickzettel: progressive disclosure.
 * Wahl-Turn → genau die 2 Orte; danach erst sekundäre Actions.
 */

import type { QuickAction } from '../../types/concierge';
import type { PendingNavOffer } from '../navigation/navigationTypes';
import type { ConciergeContext } from './conciergeContext';
import { shortenActionLabel } from './actionLabelShorten';

function speechAlreadyCommitsNav(speech: string): boolean {
  const t = speech.trim();
  if (!t) return false;
  const asksPermission =
    /\b(soll\s+ich|darf\s+ich|sollen\s+wir|wollen\s+wir|möchtest\s+du|moechtest\s+du|willst\s+du)\b/iu.test(
      t,
    ) &&
    /\b(kompass|navigation|route|führ|fuehr)\b/iu.test(t);
  const commits =
    /\b(ich\s+(führ|fuehr|bring|schalt|mach|start)|kompass\s+(?:ist\s+)?(?:an|aktiv)|navigation\s+(?:startet|läuft|laeuft)|gleich\s+los|direkt\s+los)\b/iu.test(
      t,
    );
  if (asksPermission && !commits) return false;
  return commits;
}

/** Rückfrage mit zwei Ort-Optionen. */
export function speechOffersPlaceChoice(
  speech: string,
  offerCount: number,
): boolean {
  if (offerCount < 2) return false;
  const t = speech.trim();
  if (!t) return true;
  return (
    /\b(welchen\s+nehmen\s+wir|welche(?:n)?\s+(?:option|davon)|was\s+nimmst|nehmen\s+wir\?|welches\s+davon|lieber\s+\w+)/iu.test(
      t,
    ) ||
    (/\boder\b/iu.test(t) &&
      /\?/u.test(t) &&
      /\b(nehmen|wollen|geh|option|tipp)/iu.test(t)) ||
    (!speechAlreadyCommitsNav(t) &&
      /\b(tipp|empfehl|option|vorschlag|heute|geht|hier|nähe|naehe)\b/iu.test(t))
  );
}

export function shouldForcePlaceChoiceChips(
  responseSpeech: string,
  ctx: ConciergeContext | null,
): boolean {
  if (!ctx?.primaryOffer || !(ctx.alternatives?.length > 0)) return false;
  // Named single destination — never show competing place chips
  if (ctx.namedDestination) return false;
  // Event-Recherche: Routen + PDF/Tickets — keine 2er-Wahl-Chips erzwingen
  if (ctx.eventResearch?.events?.length) return false;
  // Schon zugesagt / ein Ziel → keine Wahl-Chips
  if (speechAlreadyCommitsNav(responseSpeech)) return false;
  // Food: Orchestrator liefert Speisekarten — keine nav-only Choice-Chips erzwingen
  if (ctx.kind === 'food') return false;
  // Empfehlungs-Turns: immer die 2 Offers als Chips
  if (ctx.kind === 'general' || ctx.kind === 'infra') {
    return true;
  }
  return speechOffersPlaceChoice(
    responseSpeech,
    1 + ctx.alternatives.length,
  );
}

export function buildPlaceChoiceActions(
  primary: PendingNavOffer,
  alternatives: PendingNavOffer[],
): QuickAction[] {
  return [primary, ...alternatives].slice(0, 2).map((o) => ({
    type: 'START_NAVIGATION' as const,
    label: shortenActionLabel(`📍 ${o.name}`),
    payload: {
      targetPoiId: o.poiId,
      destName: o.name,
      destLat: o.lat,
      destLng: o.lng,
    },
  }));
}

export function wantsUberExplicitly(speech: string): boolean {
  return /\b(uber|taxi|fahrt\s+(mit|zum|zur)|bring\s+mich\s+(mit|per)|shuttle)\b/iu.test(
    speech,
  );
}

export function wantsMusicExplicitly(speech: string): boolean {
  return /\b(playlist|musik|spotify|radio|feier|party\s+mix)\b/iu.test(speech);
}
