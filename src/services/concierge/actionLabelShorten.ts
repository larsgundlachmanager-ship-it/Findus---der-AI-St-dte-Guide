/**
 * Action-Button-Labels — SSOT max 22 Zeichen.
 * Nie abschneiden / keine Ellipse („Pr…“). Bei Überlänge neu formulieren.
 */

export const ACTION_LABEL_MAX_CHARS = 22;

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

/** Orts-/Vereins-Kürzel — ganze Wörter ersetzen, nie abhacken. */
const PLACE_COMPACT_SUBS: Array<[RegExp, string]> = [
  [/\bTennis[-\s]?Club\b/giu, 'TC'],
  [/\bTennisclub\b/giu, 'TC'],
  [/\bGolf[-\s]?Club\b/giu, 'GC'],
  [/\bSport[-\s]?Club\b/giu, 'SC'],
  [/\bFußball[-\s]?Club\b/giu, 'FC'],
  [/\bFussball[-\s]?Club\b/giu, 'FC'],
  [/\bTurn[-\s]?und[-\s]?Sportverein\b/giu, 'TSV'],
  [/\bTurnverein\b/giu, 'TV'],
  [/\bSportverein\b/giu, 'SV'],
  [/\be\.?\s*V\.?\b/giu, ''],
  [/\bHauptbahnhof\b/giu, 'Hbf'],
  [/\bBahnhof\b/giu, 'Bhf'],
];

/** Generische Prefixe — weglassen zugunsten des Eigennamens. */
const GENERIC_PREFIX_RE =
  /^(?:restaurant|hotel|café|cafe|gasthof|pension|museum|kirche|galerie|bar|pub)\s+/iu;

function charLen(s: string): number {
  return Array.from(s).length;
}

/** Initiale aus Mehrwort-Namen: „Altes Rathaus Pinneberg“ → „AR Pinneberg“. */
function initialsPhrase(name: string, keepLastWord = true): string {
  const words = name
    .split(/[\s/\-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !/^(der|die|das|und|am|im|zum|zur|von|e\.?v\.?)$/iu.test(w));
  if (words.length <= 1) return name;
  if (keepLastWord && words.length >= 2) {
    const last = words[words.length - 1]!;
    const head = words
      .slice(0, -1)
      .map((w) => w[0]!.toUpperCase())
      .join('');
    return `${head} ${last}`.trim();
  }
  return words.map((w) => w[0]!.toUpperCase()).join('');
}

/**
 * Nur ganze Wörter behalten, die in max passen — nie mitten im Wort, nie „…“.
 * Zu lange Einzelwörter → Initiale / sinnvolle Kurzform, sonst weglassen.
 */
export function cutAtWordBoundary(s: string, max: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  if (charLen(t) <= max) return t;
  if (max <= 0) return '';

  const words = t.split(' ').filter(Boolean);
  if (words.length === 0) return '';

  // Ganze Wörter von vorne, solange Budget reicht
  const kept: string[] = [];
  for (const w of words) {
    const next = kept.length ? `${kept.join(' ')} ${w}` : w;
    if (charLen(next) <= max) {
      kept.push(w);
      continue;
    }
    // Wort passt nicht — wenn noch nichts drin: Kurzform des Worts
    if (kept.length === 0) {
      if (charLen(w) <= max) return w;
      // Ein Überlang-Wort: Initialen / erste sinnvolle Silben-Alternative ohne Ellipse
      const init = w
        .split(/[-/]/)
        .map((p) => p[0] ?? '')
        .join('')
        .toUpperCase();
      if (init && charLen(init) <= max) return init;
      // Nie „Pri“ aus Prisdorf — lieber leer lassen als Müll
      return '';
    }
    break;
  }
  if (kept.length) return kept.join(' ');

  // Nichts gepasst → Initialen der Phrase
  const init = initialsPhrase(t, true);
  if (charLen(init) <= max) return init;
  const onlyInit = initialsPhrase(t, false);
  if (charLen(onlyInit) <= max) return onlyInit;
  // Nie mitten im Token: nur so viele Initialen wie passen
  const letters = Array.from(onlyInit);
  return letters.slice(0, max).join('');
}

/** Ortsname für Labels — neu formulieren, nie Ellipse. */
export function shortenPlaceForLabel(name: string, maxChars: number): string {
  let t = (name || '').trim().replace(/\s+/g, ' ');
  if (!t) return t;
  if (charLen(t) <= maxChars) return t;

  for (const [re, sub] of PLACE_COMPACT_SUBS) {
    t = t.replace(re, sub);
  }
  t = t.replace(/\s+/g, ' ').trim();
  if (charLen(t) <= maxChars) return t;

  // Trailing Akronyme doppelnd streichen (TC … TCP)
  t = t.replace(/\bTC\b(.+?)\bTCP\b/iu, 'TC$1').replace(/\s+/g, ' ').trim();
  if (charLen(t) <= maxChars) return t;

  // Wörter von hinten weglassen, bis es passt (Ort behalten wenn möglich)
  const words = t.split(' ').filter(Boolean);
  for (let n = words.length; n >= 1; n--) {
    const slice = words.slice(0, n).join(' ');
    if (charLen(slice) <= maxChars) return slice;
  }

  const init = initialsPhrase(t, true);
  if (charLen(init) <= maxChars) return init;
  return cutAtWordBoundary(init, maxChars);
}

/**
 * Kompakter Ortsname für Buttons / Maps-Ansage (max 22).
 * z. B. „Tennis-Club Prisdorf TCP“ → „TC Prisdorf“ — nie „Pr…“.
 */
export function compactPlaceForAction(
  name: string,
  maxChars = ACTION_LABEL_MAX_CHARS,
): string {
  let t = (name || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;

  // Generische Prefixe weg → Eigenname behalten („Restaurant Goldschätzchen“ → „Goldschätzchen“)
  t = t.replace(GENERIC_PREFIX_RE, '').trim() || t;

  for (const [re, sub] of PLACE_COMPACT_SUBS) {
    t = t.replace(re, sub);
  }
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\bTC\b(.+?)\bTCP\b/iu, 'TC$1').replace(/\s+/g, ' ').trim();

  if (charLen(t) <= maxChars) return t;

  // „TC Prisdorf“ passt meist; sonst Ort / Kürzel / Initiale
  const variants = [
    t,
    t.replace(/\bTCP\b/giu, '').replace(/\s+/g, ' ').trim(),
    (() => {
      const m = t.match(/\bTC\b\s+(\S+)/i);
      return m ? `TC ${m[1]}` : t;
    })(),
    (() => {
      const parts = t.split(' ').filter(Boolean);
      const club = parts.find((p) =>
        /^(TC|GC|SC|FC|TSV|SV|TV)$/i.test(p),
      );
      // Eigenname/Ort: längstes nicht-generisches Wort (nicht das erste Füllwort)
      const candidates = parts
        .filter((p) => p.length > 3 && !/^(TC|GC|SC|FC|TSV|SV|TV|Bhf|Hbf|Altes|Neue|Neuer|Neues)$/i.test(p))
        .sort((a, b) => b.length - a.length);
      const place = candidates[0] ?? parts[parts.length - 1];
      if (club && place && club !== place) return `${club} ${place}`;
      if (candidates.length >= 2) {
        // z. B. Rathaus + Pinneberg
        const pair = `${candidates[1]} ${candidates[0]}`;
        if (charLen(pair) <= maxChars) return pair;
      }
      return place ?? club ?? t;
    })(),
    initialsPhrase(t, true),
    initialsPhrase(name, true),
  ];

  for (const v of variants) {
    const c = v.replace(/\s+/g, ' ').trim();
    if (c && charLen(c) <= maxChars) return c;
  }

  return shortenPlaceForLabel(t, maxChars);
}

/**
 * Sinnvoll kürzen: Phrasen → Neuformulierung → ganze Wörter.
 * Nie Ellipse, nie mitten im Wort („Pr…“ verboten).
 */
export function shortenActionLabel(
  label: string,
  max = ACTION_LABEL_MAX_CHARS,
): string {
  let t = (label || '').trim().replace(/\s+/g, ' ');
  if (!t) return t;

  // Legacy „MAP Ortsname“ → 🗺️
  if (/^MAP\b/i.test(t)) {
    t = withMapsActionEmoji(t);
  }

  // Lange Klammern-Zusätze weg
  t = t.replace(/\s*\([^)]{8,}\)/g, '').trim();

  for (const [re, sub] of PHRASE_SUBS) {
    t = t.replace(re, sub);
  }
  t = t.replace(/\s+/g, ' ').trim();

  // Ortsanteil kompakt neu schreiben (vor hartem Cut)
  const emojiMatch = t.match(/^(\p{Extended_Pictographic}(?:\uFE0F)?\s*)/u);
  if (emojiMatch) {
    const prefix = emojiMatch[1]!;
    let rest = t.slice(emojiMatch[0].length).trim();
    const budget = Math.max(4, max - charLen(prefix));
    if (charLen(prefix + rest) > max) {
      rest = compactPlaceForAction(rest, budget);
    }
    t = `${prefix}${rest}`.trim();
  } else if (charLen(t) > max) {
    t = compactPlaceForAction(t, max);
  }

  // Füllwörter streichen wenn noch zu lang
  if (charLen(t) > max) {
    t = t
      .replace(/\b(bitte|hier|jetzt|direkt|offiziell|zur|zum|die|der|das|eine?)\b/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (charLen(t) <= max) {
    // Orphan-Füllwort als Label vermeiden („richtig“, „gutes“… aus Speech-Schnipseln)
    if (
      /^(richtig|gutes?|hier|heute|abend|morgen|einfach|noch|mal|sehr|echt)\b/iu.test(
        t,
      ) &&
      !/\p{Extended_Pictographic}/u.test(t)
    ) {
      return 'Mehr';
    }
    return t;
  }

  // Emoji behalten, Rest neu formulieren (ganze Wörter)
  if (emojiMatch) {
    const prefix = emojiMatch[1]!;
    const rest = t.slice(prefix.length).trim();
    const budget = Math.max(4, max - charLen(prefix));
    const shortRest = compactPlaceForAction(rest, budget);
    const out = `${prefix}${shortRest}`.trim();
    if (charLen(out) <= max) return out;
    return `${prefix}${cutAtWordBoundary(shortRest, budget)}`.trim();
  }

  const cut = cutAtWordBoundary(t, max);
  if (
    cut &&
    /^(richtig|gutes?|hier|heute|abend|morgen|einfach|noch|mal|sehr|echt)\b/iu.test(
      cut,
    )
  ) {
    return 'Route';
  }
  return cut;
}
