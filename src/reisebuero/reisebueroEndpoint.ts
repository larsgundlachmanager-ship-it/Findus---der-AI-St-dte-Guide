/**
 * Reisebüro Endpoint — Gesprächstempo.
 * Kurzantworten schnell; Monologe (Akt 1 Dump) geduldig.
 */

const SHORT_ACK =
  /^(ja|nein|nee|nö|ok|okay|klar|genau|passt|gut|vier|drei|zwei|eins|ein|eine|\d{1,2})\b/iu;

export function isShortClosedAnswer(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (!t) return false;
  if (words <= 4 && SHORT_ACK.test(t)) return true;
  if (words <= 3 && /\b(stück|leute|personen|mann|jungs)\b/iu.test(t)) return true;
  return false;
}

export function reisebueroEndpointDelayMs(
  text: string,
  ctx: { turnIndex: number; lastAskOpen: boolean },
): number {
  const t = text.replace(/\s+/g, ' ').trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const short = isShortClosedAnswer(t);
  const hanging = /\b(und|aber|oder|dass|weil|also|mit|vom|von|bis|zum|dann|noch)$/iu.test(t);

  if (hanging) return 1100;
  if (short) return 550;
  // Langer Plan-Dump — nicht mitten im Satz abschneiden.
  if (words >= 40) return 1400;
  if (words >= 22) return 1100;
  if (words >= 12) return 850;
  if (ctx.turnIndex < 2 && ctx.lastAskOpen) return 800;
  return 650;
}

export function isOpenAskKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return (
    key === 'purpose' ||
    key === 'mode' ||
    key === 'when' ||
    key === 'lodging' ||
    key === 'energy' ||
    key === 'driveTime' ||
    key === 'adults' ||
    key === 'budget' ||
    key === 'locationBias' ||
    key === 'lastTrip' ||
    key === 'highlight' ||
    key === 'dealbreaker' ||
    key === 'extraWishes' ||
    key === 'partyStyle' ||
    key === 'spaStyle' ||
    key === 'kidsStyle' ||
    key === 'tripShape' ||
    key === 'ideaHook' ||
    key === 'rentalCar' ||
    key === 'dest' ||
    key === 'weather' ||
    key === 'wrap_up' ||
    key === 'origin' ||
    key === 'directFlight' ||
    key === 'departWindow' ||
    key === 'partyGrain' ||
    key === 'ready_announce' ||
    key === 'transfer' ||
    key === 'bookedBits' ||
    key === 'rentalCar'
  );
}
