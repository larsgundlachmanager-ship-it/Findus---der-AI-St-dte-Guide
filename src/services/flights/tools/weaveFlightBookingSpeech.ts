/**
 * Woven booking speech for flight wish — no telegram bullets in audio.
 */

import { formatDateKeySpokenDe } from '../../../utils/dateKeys';

function spokenDay(dateKey: string): string {
  return formatDateKeySpokenDe(dateKey);
}
import type { FlightWishCandidate } from './flightWishTypes';

function fmtPrice(eur: number | null | undefined): string | null {
  if (eur == null || !(eur > 0)) return null;
  return `ab etwa ${Math.round(eur)} Euro`;
}

function fmtLeg(c: FlightWishCandidate): string {
  const when = spokenDay(c.outboundDateKey);
  const price = fmtPrice(c.priceEur);
  const stops =
    c.transfers === 0
      ? 'direkt'
      : c.transfers === 1
        ? 'ein Stop'
        : c.transfers != null
          ? `${c.transfers} Stopps`
          : null;
  const dep = c.departAt ? `Abflug gegen ${c.departAt}` : null;
  return [when, price, stops, dep].filter(Boolean).join(', ');
}

export function weaveFlightBookingSpeech(opts: {
  fromLabel: string;
  toLabel: string;
  whenLabel?: string | null;
  ranked: FlightWishCandidate[];
}): { speech: string; bullets: string[] } {
  const route = `Ab ${opts.fromLabel} nach ${opts.toLabel}`;
  const horizon = opts.whenLabel?.trim();
  const top = opts.ranked[0];
  const alt = opts.ranked[1];

  let speech = route;
  if (horizon) speech += `, ${horizon}`;
  speech +=
    ' — unten hast du die Kiwi- und Vergleichslinks mit vorgefüllten Daten, da siehst du live, was gerade geht.';
  if (top) {
    const leg = fmtLeg(top);
    if (leg) {
      speech += ` Im Fenster um deinen Wunschtag wirkt ${leg} am stimmigsten`;
      if (alt?.priceEur && top.priceEur && alt.priceEur < top.priceEur - 15) {
        speech += `, und ${spokenDay(alt.outboundDateKey)} kann nochmal günstiger sein`;
      }
      speech += '.';
    }
  }

  const bullets: string[] = [
    `${opts.fromLabel} → ${opts.toLabel}`,
    ...(horizon ? [horizon] : []),
  ];
  for (const c of opts.ranked.slice(0, 2)) {
    const line = fmtLeg(c);
    if (line) bullets.push(line);
  }
  if (!bullets.some((b) => /Kiwi|€|Euro|Stop|direkt/i.test(b))) {
    bullets.push('Preis-Links unten prüfen');
  }
  return { speech, bullets: bullets.slice(0, 3) };
}
