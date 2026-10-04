/**
 * Evidence-Buttons: Speisekarte/Maps/Ticket vor generischem Web-suchen.
 */

export type EvidenceButtonLike = {
  type?: string;
  label?: string;
  payload?: Record<string, unknown> | null;
};

function scoreButton(b: EvidenceButtonLike): number {
  const label = String(b.label || '').toLowerCase();
  const url = String(b.payload?.url || '');
  if (/speisekarte|menu|menü/.test(label) || /menu|speisekarte/i.test(url)) return 100;
  if (/ticket|eintritt|buchen|booking/.test(label)) return 90;
  if (/maps|karte|google/.test(label) || /google\.com\/maps|maps\.app/i.test(url))
    return 80;
  if (/website|webseite|homepage/.test(label)) return 70;
  if (/web\s*suchen|google\s*suchen|im\s*web/.test(label)) return 10;
  if (b.type === 'START_NAVIGATION') return 60;
  if (b.type === 'OPEN_URL' && url) return 50;
  return 40;
}

/** Sortiert Buttons: Evidence-Links vor generischem Web-suchen. */
export function prioritizeEvidenceButtons<T extends EvidenceButtonLike>(
  buttons: T[],
  opts?: { max?: number },
): T[] {
  const max = opts?.max ?? 5;
  return [...buttons]
    .sort((a, b) => scoreButton(b) - scoreButton(a))
    .slice(0, max);
}

/** Drop „Web suchen“ wenn bereits Venue-URL/Speisekarte vorhanden. */
export function dropGenericWebWhenEvidence<T extends EvidenceButtonLike>(
  buttons: T[],
): T[] {
  const hasEvidence = buttons.some((b) => {
    const label = String(b.label || '').toLowerCase();
    const url = String(b.payload?.url || '');
    return (
      /speisekarte|menu|ticket|website|maps/.test(label) ||
      (/^https?:\/\//i.test(url) && !/google\.[^/]+\/search/i.test(url))
    );
  });
  if (!hasEvidence) return buttons;
  return buttons.filter((b) => {
    const label = String(b.label || '').toLowerCase();
    return !/web\s*suchen|google\s*suchen|im\s*web\s*suchen/.test(label);
  });
}
