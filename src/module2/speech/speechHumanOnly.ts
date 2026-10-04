/**
 * Worker-Labels (Sticky-Auftrag, Task-Loop, Gap-Engine) dürfen die Stimme nie erreichen.
 * Planung bleibt in Briefs — gesprochen wird nur Umgangssprache.
 */

const DROP_SENTENCE =
  /\b(Sticky-Auftrag|Task-Loop|Gap-Engine|OffeneTasks|NochBlocker|HerleitenZuerst|Open-World|Kontrolldistanz|ROOT\s+behalten|Wunsch=|Bekannt=|Presence=|Anchor=|Gap=)\b/i;

const DROP_CLAUSE =
  /\b(?:Sticky-Auftrag\[[^\]]*\]|Task-Loop|Gap-Engine(?:\s+aktiv)?|Open-World|Kontrolldistanz|ROOT\s+behalten)[^.!?]*(?:[.!?]|$)/gi;

export function stripInternalWorkerSpeech(text: string): string {
  let s = (text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(DROP_CLAUSE, ' ');
  const parts = s
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => !DROP_SENTENCE.test(p));
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}
