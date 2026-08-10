/**
 * Cartesia Inline-Phoneme — DEAKTIVIERT (Hard-Reboot).
 * Native DE-Stimmen (Alina/Sebastian) bekommen unveränderten deutschen Text.
 * Frühere IPA/Sounds-like-Hacks erzeugten amerikanischen Akzent.
 */

export function applyCartesiaInlinePhonemes(text: string): string {
  return text;
}

/** IPA-Spans schützen — falls künftig gezielt eingesetzt. */
export function protectCartesiaIpaSpans(text: string): {
  text: string;
  restore: (s: string) => string;
} {
  const spans: string[] = [];
  const protectedText = text.replace(/<<[^<>]+>>/g, (m) => {
    const i = spans.length;
    spans.push(m);
    return `\uE010${i}\uE011`;
  });
  return {
    text: protectedText,
    restore: (s: string) =>
      s.replace(/\uE010(\d+)\uE011/g, (_, idx: string) => spans[Number(idx)] ?? ''),
  };
}
