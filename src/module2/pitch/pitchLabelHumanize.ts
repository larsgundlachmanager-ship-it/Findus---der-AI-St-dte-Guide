/**
 * Pitch-Labels für Speech/UI — keine Snake-Case-Interna vorlesen.
 */

export function humanizePitchLabel(raw: string): string {
  const t = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  if (/^(location|day|date|time|city|when|where|weekday)[_:]/i.test(t)) {
    return '';
  }
  if (/cuisine_not_/i.test(t) || /^kein[e]?n?\s+/iu.test(t)) return '';
  if (/all_you_can_eat|\bayce\b/i.test(t)) return 'All-you-can-eat';
  if (/^spa_or_sauna$/i.test(t)) return 'Spa oder Sauna';
  if (/^power_outlet$/i.test(t)) return 'Steckdose';
  if (/^all_you_can_eat$/i.test(t)) return 'All-you-can-eat';
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/iu.test(t)) {
    const words = t.split('_').filter(Boolean);
    if (!words.length) return '';
    return words
      .map((w, i) =>
        i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase(),
      )
      .join(' ');
  }
  return t;
}

export function humanizePitchLabels(labels: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of labels) {
    const h = humanizePitchLabel(raw);
    if (!h) continue;
    const key = h.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/** Wish ist AYCE-Must (Hard, nie Soft-Fill). */
export function isAyceMustWish(text: string): boolean {
  return /all_you_can_eat|\bayce\b|schlemmer|buffet/i.test(
    String(text || ''),
  );
}
