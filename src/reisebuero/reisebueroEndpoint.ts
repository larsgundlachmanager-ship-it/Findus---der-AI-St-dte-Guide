/**
 * Brainstorming-Endpoint — Denkpausen und Gruppengespräch, nicht Live-Chat-Speed.
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
  const hanging = /\b(und|aber|oder|dass|weil|also|mit|vom|von|bis|zum|der|die|das|ein|eine)$/iu.test(t);

  if (hanging) return words >= 12 ? 5200 : 4000;
  if (ctx.turnIndex < 2) return short ? 2000 : words >= 16 ? 4800 : 3600;
  if (words >= 18) return 5000;
  if (words >= 10) return 3800;
  if (ctx.lastAskOpen && !short) return 3000;
  if (ctx.lastAskOpen && short && words <= 2) return 2000;
  if (short) return 1600;
  return 2600;
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
    key === 'departWindow'
  );
}
