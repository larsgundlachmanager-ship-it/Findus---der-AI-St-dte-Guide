/**
 * „Wie spät ist es?“ — eine lokale Uhrzeit, kein UTC/Zeitzonen-Vortrag.
 */

export function isLocalTimeAsk(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return false;
  if (
    /\b(wecker|timer|flug|bahn|leave|abfahrt|ankunft|öffnungs|oeffnungs|kino|termin)\b/iu.test(
      t,
    )
  ) {
    return false;
  }
  return (
    /\bwie\s+sp(?:ä|ae)t\b/iu.test(t) ||
    /\b(?:welche|wie\s*viel)\s+uhr(?:zeit)?\b/iu.test(t) ||
    /\b(?:aktuelle\s+)?uhrzeit\b/iu.test(t) ||
    /\bwie\s+viel\s+uhr\b/iu.test(t)
  );
}

export function formatLocalTimeSpeech(nowMs = Date.now()): string {
  const d = new Date(nowMs);
  const hm = d.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Es ist ${hm} Uhr.`;
}

export function prepareLocalTimeFollowUp(text: string): {
  speech: string;
  bullets: string[];
  cardTitle: string;
} | null {
  if (!isLocalTimeAsk(text)) return null;
  const speech = formatLocalTimeSpeech();
  const hm = speech.replace(/^Es ist\s+/i, '').replace(/\s*Uhr\.?$/i, '').trim();
  return {
    speech,
    bullets: [hm.includes(':') ? hm : speech],
    cardTitle: 'Uhrzeit',
  };
}
