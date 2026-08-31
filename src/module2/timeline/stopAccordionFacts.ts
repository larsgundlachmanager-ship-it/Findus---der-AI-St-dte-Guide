/**
 * Zwei präzise, belegte Stichpunkte für die aufgeklappte Stop-Karte.
 * Keine Adressen, GPS oder erfundenen Fakten.
 */

function clockHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function noteParts(notes: string | null | undefined): string[] {
  return (notes ?? '')
    .split(/[·\n|;]/)
    .map((s) => s.replace(/^[•\-\*]\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(
      (s) =>
        !/\b\d{1,3}\.\d{4,}\b/.test(s) &&
        !/\b\d{5}\b/.test(s) &&
        !/\b\d{1,3}°/.test(s),
    );
}

export function stopAccordionFacts(input: {
  atMs: number | null;
  endMs: number | null;
  notes?: string | null;
}): string[] {
  const out: string[] = [];
  const arrive = input.atMs != null ? clockHm(input.atMs) : '';
  const leave = input.endMs != null ? clockHm(input.endMs) : '';
  let dwellMin: number | null = null;
  if (
    input.atMs != null &&
    input.endMs != null &&
    input.endMs > input.atMs
  ) {
    dwellMin = Math.max(1, Math.round((input.endMs - input.atMs) / 60_000));
  }

  if (arrive) {
    out.push(
      dwellMin != null
        ? `Ankunft ${arrive} · ca. ${dwellMin} Min vor Ort`
        : `Ankunft ${arrive}`,
    );
  }

  const parts = noteParts(input.notes);
  const tourEnd = parts.find((s) => /fertig|danach/i.test(s));
  if (tourEnd && !out.some((b) => b.includes(tourEnd))) {
    out.push(tourEnd);
  } else if (leave && dwellMin != null) {
    out.push(`Weiter ab ${leave}`);
  } else {
    const extra = parts.find(
      (s) =>
        !/^\s*ca\.\s*\d+\s*Min vor Ort/i.test(s) &&
        !out.some((b) => b.includes(s)),
    );
    if (extra) {
      out.push(extra.length > 80 ? `${extra.slice(0, 77).trim()}…` : extra);
    }
  }

  return out.slice(0, 2);
}
