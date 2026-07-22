/** Fügt einen neuen Diktat-Abschnitt an bestehenden Text an (Komma-Trennung). */
export function appendSpeechSegment(base: string, segment: string): string {
  const b = base.trim();
  const s = segment.trim();
  if (!s) return b;
  if (!b) return s;
  return `${b}, ${s}`;
}
