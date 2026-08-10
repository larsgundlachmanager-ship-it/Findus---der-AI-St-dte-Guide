/**
 * Action-Button-Labels — SSOT max 30 Zeichen.
 * Kürzt nur an Wortgrenzen — nie mitten im Wort.
 */

export const ACTION_LABEL_MAX_CHARS = 30;

/**
 * Maps-Buttons: immer 🗺️ — kein Google-Logo, kein „MAP“-Text
 * (Marken-/Lizenz-Vermeidung; Emoji ist genügend klar).
 */
export const MAPS_ACTION_EMOJI = '🗺️';

const MAPS_PREFIX_RE = /^(?:🗺️|🗺|MAP)\s*/iu;

/** Führendes Maps-Zeichen / „MAP“ entfernen (UI zeigt Emoji separat). */
export function stripMapsActionPrefix(label: string): string {
  return (label || '').replace(MAPS_PREFIX_RE, '').trim();
}

/** Label mit 🗺️-Prefix (idempotent). */
export function withMapsActionEmoji(label: string): string {
  const rest = stripMapsActionPrefix(label);
  return rest ? `${MAPS_ACTION_EMOJI} ${rest}` : MAPS_ACTION_EMOJI;
}

/** Häufige UI-Phrasen → Kurzform (Emoji oft schon im Label). */
const PHRASE_SUBS: Array<[RegExp, string]> = [
  [/\bnavigation\s+starten\b/giu, 'Route'],
  [/\broute\s+starten\b/giu, 'Route'],
  [/\broute\s+zu\b/giu, 'Route'],
  // Speisekarte bleibt „Speisekarte“ — nie zu „Karte“ kürzen (≠ Maps)
  [/\bmenükarte\b/giu, 'Speisekarte'],
  [/\bmenuekarte\b/giu, 'Speisekarte'],
  [/\bspeise\s*karte\b/giu, 'Speisekarte'],
  [/\bmenü\b/giu, 'Speisekarte'],
  [/\bmenu\b/giu, 'Speisekarte'],
  [/\bwebseite\b/giu, 'Web'],
  [/\bwebsite\b/giu, 'Web'],
  [/\bhomepage\b/giu, 'Web'],
  [/\bzur\s+kirchengemeinde\b/giu, 'Kirche Web'],
  [/\bkirchengemeinde\b/giu, 'Kirche'],
  [/\bosterkirche\b/giu, 'Kirche'],
  [/\boffizielle?\s+seite\b/giu, 'Web'],
  [/\bim\s+browser\s+öffnen\b/giu, 'Web'],
  [/\bweb\s+öffnen\b/giu, 'Web'],
  [/\böffnen\b/giu, 'Öffnen'],
  // „Hotel buchen“ bleibt lesbar — nicht zu „Buch“ kürzen
  [/(?<![Hh]otel\s)\bbuchen\b/giu, 'Buch'],
  [/(?<![Hh]otel\s)\bbuchung\b/giu, 'Buch'],
  [/\bbuchungslink\b/giu, 'Buch'],
  [/\btisch\s+reservieren\b/giu, 'Tisch'],
  [/\breservier(?:en|ung)?\b/giu, 'Tisch'],
  [/\btermin\b/giu, 'Termin'],
  [/\bauswahl\b/giu, 'Wahl'],
  [/\bfavorit(?:en)?\b/giu, '🥇'],
  [/\balternative\b/giu, '🥈'],
  [/\balt\.?\b/giu, '🥈'],
  [/\blosgehen\b/giu, 'Los'],
  [/\bmehr\s+anzeigen\b/giu, 'Mehr'],
  [/\bmehr\s+optionen\b/giu, 'Mehr'],
  [/\bmehr\s+infos?\b/giu, 'Mehr'],
  [/\bzeig\s+mir\s+noch\s+mehr\b/giu, 'Mehr'],
  [/\bweiter\s+suchen\b/giu, 'Weiter'],
  [/\bonline\s+suchen\b/giu, 'Online'],
  [/\bonline\s+recherch\w*\b/giu, 'Online'],
  [/\bstraßenansicht\b/giu, 'View'],
  [/\bstrassenansicht\b/giu, 'View'],
  [/\bstreet\s*view\b/giu, 'View'],
  [/\banrufen\b/giu, 'Call'],
  [/\btelefon\b/giu, 'Tel'],
  [/\btickets?\b/giu, 'Ticket'],
  [/\beintritts?karte(?:n)?\b/giu, 'Ticket'],
  [/\böffnungszeiten\b/giu, 'Öffnung'],
  [/\boeffnungszeiten\b/giu, 'Öffnung'],
  [/\bzu\s+fuß\b/giu, 'Fuß'],
  [/\bzu\s+fuss\b/giu, 'Fuß'],
  [/\bper\s+rad\b/giu, 'Rad'],
  [/\bper\s+auto\b/giu, 'Auto'],
  [/\bzum\s+hotel\b/giu, 'Hotel'],
  [/\bessen:\s*/giu, ''],
  [/\borte\s+in\s+der\s+nähe\b/giu, 'Nähe'],
  [/\bin\s+der\s+nähe\b/giu, 'Nähe'],
  [/\bsunset\b/giu, 'Sunset'],
  [/\bpdf\s*\/\s*programm\b/giu, 'PDF'],
  [/\btour\s+starten\b/giu, 'Tour'],
];

function charLen(s: string): number {
  return Array.from(s).length;
}

/**
 * Kürzt auf max Grapheme — nur an Leerzeichen/Bindestrich.
 * Nie mitten in einem Wort (außer unteilbares Überlang-Wort → Ellipse).
 */
export function cutAtWordBoundary(s: string, max: number): string {
  const chars = Array.from(s.trim());
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return '…';

  const hard = chars.slice(0, max).join('');
  const next = chars[max];

  // Schnitt liegt genau an Wortgrenze (nächstes Zeichen = Leerzeichen / Ende)
  if (next == null || /\s/.test(next)) {
    return hard.trim();
  }

  // Mitten im Wort → unvollständiges Wort verwerfen
  const spaceIdx = Math.max(hard.lastIndexOf(' '), hard.lastIndexOf('\u00A0'));
  if (spaceIdx >= 1) {
    return hard
      .slice(0, spaceIdx)
      .trim()
      .replace(/\s+[A-Za-zÄÖÜäöüß]{1,2}$/u, '')
      .trim();
  }

  // Bindestrich als Wortgrenze
  const hyphenIdx = hard.lastIndexOf('-');
  if (hyphenIdx >= 2 && hyphenIdx < hard.length - 1) {
    return hard.slice(0, hyphenIdx).trim();
  }

  // Ein einziges Überlanges-Wort: Ellipse statt stummem Abhacken
  const budget = Math.max(1, max - 1);
  let cut = `${chars.slice(0, budget).join('')}…`;

  // Waisen-Buchstaben am Ende (z. B. „… Review D“) verwerfen
  cut = cut.replace(/\s+[A-Za-zÄÖÜäöüß]{1,2}(…)?$/u, (_, ell) =>
    ell ? '…' : '',
  ).trim();
  if (!cut || cut === '…') {
    return `${chars.slice(0, budget).join('')}…`;
  }
  return cut;
}

/** Ortsname für Labels — nur ganze Wörter. */
export function shortenPlaceForLabel(name: string, maxChars: number): string {
  const t = (name || '').trim().replace(/\s+/g, ' ');
  if (!t) return t;
  return cutAtWordBoundary(t, maxChars).replace(
    /\s+[A-Za-zÄÖÜäöüß]{1,2}$/u,
    '',
  );
}

/**
 * Sinnvoll kürzen: Phrasen → Wortgrenzen → Waisen weg.
 * Nie mitten im Wort stehen lassen (kein „App Store Review D“).
 */
export function shortenActionLabel(
  label: string,
  max = ACTION_LABEL_MAX_CHARS,
): string {
  let t = (label || '').trim().replace(/\s+/g, ' ');
  if (!t) return t;

  // Legacy „MAP Ortsname“ → 🗺️ (nie Google-Logo / MAP-Badge)
  if (/^MAP\b/i.test(t)) {
    t = withMapsActionEmoji(t);
  }

  // Lange Klammern-Zusätze weg (Platz sparen)
  t = t.replace(/\s*\([^)]{8,}\)/g, '').trim();

  for (const [re, sub] of PHRASE_SUBS) {
    t = t.replace(re, sub);
  }
  t = t.replace(/\s+/g, ' ').trim();

  // Füllwörter streichen wenn noch zu lang
  if (charLen(t) > max) {
    t = t
      .replace(/\b(bitte|hier|jetzt|direkt|offiziell|zur|zum|die|der|das|eine?)\b/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (charLen(t) <= max) return t;

  // Emoji-Prefix behalten (ein Pictograph + optional FE0F + Space)
  const m = t.match(/^(\p{Extended_Pictographic}(?:\uFE0F)?\s*)/u);
  if (m) {
    const prefix = m[1];
    const rest = t.slice(m[0].length).trim();
    const budget = Math.max(1, max - charLen(prefix));
    const shortRest = cutAtWordBoundary(rest, budget).replace(
      /\s+[A-Za-zÄÖÜäöüß]{1,2}$/u,
      '',
    );
    return `${prefix}${shortRest}`.trim();
  }

  return cutAtWordBoundary(t, max).replace(/\s+[A-Za-zÄÖÜäöüß]{1,2}$/u, '');
}
