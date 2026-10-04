/**
 * Modul-2 Kreuzfahrt Quick-Pitch — teilt cruiseSearch mit Reisebüro.
 * Mit Soft-Fleet-Schiff-Fit (Pool/Rutsche/Kids/Party/Rentner …).
 * Kein Briefing; Top-Struktur + Partner-Links.
 */

import { parseBriefSlots } from '../../reisebuero/parseBriefSlots';
import { cloneEmptyLedger, mergeLedger } from '../../reisebuero/slotLedger';
import {
  buildCruiseSearchBrief,
  cruisePartnerSearchLinks,
  cruiseQuickPitchSkeleton,
} from '../../reisebuero/research/cruiseSearch';
import {
  cruiseShipFitBullets,
  looksLikeCruiseShipFitAsk,
  matchCruiseShipsFromLedger,
  weaveCruiseShipFitSpeech,
} from '../../reisebuero/research/cruiseShipFit';
import { isCruiseQuickPitch } from '../../reisebuero/handoff';

export { isCruiseQuickPitch };

export type CruiseQuickPitchResult = {
  speech: string;
  bullets: string[];
  buttons: Array<{ id: string; label: string; url: string }>;
  suggestReisebuero: boolean;
  shipNames?: string[];
};

export function buildCruiseQuickPitchFromText(userText: string): CruiseQuickPitchResult | null {
  const cruiseCue =
    isCruiseQuickPitch(userText) ||
    looksLikeCruiseShipFitAsk(userText) ||
    /\b(?:kreuzfahrt|mein(?:en|em|e)?\s+schiff|aida|adidia)\b/iu.test(userText || '');
  if (!cruiseCue) return null;

  const ledger = mergeLedger(cloneEmptyLedger(), parseBriefSlots(userText));
  if (!ledger.tripShape) {
    ledger.tripShape = {
      value: 'cruise',
      source: 'inferred',
      hardness: 'wish',
    };
  }
  const brief = buildCruiseSearchBrief(ledger);
  const links = cruisePartnerSearchLinks(ledger);
  const fit = matchCruiseShipsFromLedger(ledger, { userText });
  const shipFitActive = fit.fits.length > 0 && (fit.wants.length > 0 || fit.audiences.length > 0);

  const bullets = shipFitActive
    ? cruiseShipFitBullets(fit)
    : ([
        brief.embarkPort
          ? `Start: ${brief.embarkPort}`
          : brief.embarkBias === 'near_home'
            ? 'Start: DE-Häfen / Nähe'
            : brief.cheapest
              ? 'Start: günstigster Hafen'
              : null,
        brief.when ? `Wann: ${brief.when}` : null,
        brief.cabinClass ? `Kabine: ${brief.cabinClass}` : null,
        brief.fareBundle ? `Tarif: ${brief.fareBundle}` : null,
        brief.amenities.length ? `Wünsche: ${brief.amenities.slice(0, 4).join(', ')}` : null,
      ].filter(Boolean) as string[]);

  const speech = shipFitActive
    ? weaveCruiseShipFitSpeech(fit)
    : cruiseQuickPitchSkeleton(brief);

  return {
    speech,
    bullets: bullets.slice(0, 3),
    buttons: links.slice(0, 4).map((l) => ({
      id: l.id,
      label: l.label.slice(0, 40),
      url: l.url,
    })),
    suggestReisebuero: true,
    shipNames: fit.fits.map((f) => f.ship.name),
  };
}
