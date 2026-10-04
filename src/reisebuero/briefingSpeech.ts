/**
 * Reine Speech-Guards für Briefing — ohne Store/RN (smoke-fähig).
 * Kultur: FINDUS_SPEECH_CULTURE_BLOCK — mündlich weben, kein Telegramm.
 */

/** Fakten in einen gesprochenen Satz weben (kein Mittepunkt, kein Abhaken). */
export function weaveSpokenFacts(parts: string[]): string {
  const clean = parts
    .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} und ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} und ${clean[clean.length - 1]}`;
}

export function ensureBriefingQuestion(speech: string, question: string): string {
  const s = (speech || '').trim();
  if (!s) {
    const q = (question || 'Was soll ich noch festhalten?').trim().replace(/\?+$/, '?');
    return q.endsWith('?') ? q : `${q}?`;
  }
  if (/\?/.test(s)) return s;
  // Ready/Keep-Talking laden schon zur Suche ein — keine zweite Präzisieren-Frage dranhängen
  if (
    /\b(suche tippen|suche starten|recherche starten|soll ich (?:die )?suche|wenn'?s passt|wenn es passt)\b/iu.test(
      s,
    )
  ) {
    return s;
  }
  if (/^(notiert|alles klar|klar|ok|okay)\.?$/iu.test(s)) return s;
  const q = (question || 'Was soll ich noch festhalten?').trim().replace(/\?+$/, '?');
  if (!q || /erzähl los|suche tippen/iu.test(q)) return s;
  return `${s.replace(/[.!]+$/, '')}. ${q.endsWith('?') ? q : `${q}?`}`;
}

export function keepTalkingAlreadyNudged(
  asked: string[],
  searchReadyAnnounced?: boolean,
): boolean {
  return (
    asked.includes('keep_talking') ||
    asked.includes('ready_announce') ||
    Boolean(searchReadyAnnounced)
  );
}

export function pickOpeningGreeting(name: string, tripId = ''): { speech: string; hint: string } {
  const n = (name || '').trim();
  const variants = n
    ? [
        `Hey ${n}, was steht auf dem Plan?`,
        `Jo ${n}, wie kann ich dir helfen?`,
        `Hey ${n} — womit starten wir?`,
      ]
    : [
        `Hey, was steht auf dem Plan?`,
        `Jo, wie kann ich dir helfen?`,
        `Hey — womit starten wir?`,
      ];
  let h = 0;
  for (let i = 0; i < tripId.length; i += 1) h = (h + tripId.charCodeAt(i) * (i + 1)) % variants.length;
  const speech = (variants[h] || variants[0]!).slice(0, 72);
  return { speech, hint: 'Erzähl los' };
}
