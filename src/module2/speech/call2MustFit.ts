/**
 * Call-2 Must-Fit — Ask-Back „was meinst du genau?“ ist schon weg;
 * die gesprochene Antwort darf trotzdem nicht weich / daneben pitchen
 * wenn Musts schwach extrahiert sind.
 */

const STOP =
  /^(der|die|das|ein|eine|einen|mein|meine|dein|deine|in|im|an|am|auf|zu|zum|zur|und|oder|ist|hat|war|mit|von|den|dem|des|ich|du|wir|mal|hier|da|dort|bitte|so|noch|auch|nicht|heute|jetzt|ne|wa|gell|ey|digga|alter|jo|jaja|halt|eben|eh|uff|boah|krass|irgendwie|irgendwo|irgendwas|voll|richtig|echt|schon|dann|aber|also|kann|will|möcht|moecht|hätt|haett|suche|finde|zeig|mach|brauch|geht|gibt|was|wie|wo|wann|welch)$/iu;

/** Content-Tokens aus dem User-Satz — Provisional-Musts wenn Katalog dünn. */
export function extractProvisionalMustTokens(userText: string): string[] {
  return String(userText || '')
    .split(/[^\p{L}\p{N}\-]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOP.test(w))
    .slice(0, 6);
}

function uniqMusts(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const m = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!m || m.length < 2) continue;
    const k = m.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out.slice(0, 10);
}

/**
 * Musts aus Katalog + User-Satz verstärken (Negationen, Cuisine, Content-Tokens).
 */
export function strengthenCall2Musts(
  userText: string,
  mustIn: string[] | null | undefined,
): string[] {
  const t = String(userText || '').replace(/\s+/g, ' ').trim();
  const must = [...(mustIn ?? [])];

  try {
    const { looksLikeAyceQuery } = require('../pitch/ayceIntent') as {
      looksLikeAyceQuery: (s: string) => boolean;
    };
    if (
      looksLikeAyceQuery(t) &&
      !must.some((m) => /ayce|all_you_can_eat|buffet/i.test(m))
    ) {
      must.unshift('all_you_can_eat');
    }
  } catch {
    /* soft */
  }

  try {
    const { extractMustHaves } = require('../jobs/classifyJob') as {
      extractMustHaves: (s: string) => string[];
    };
    for (const m of extractMustHaves(t)) must.push(m);
  } catch {
    /* soft */
  }

  try {
    const { extractTouristConstraintMusts } = require('../router/call1TouristConstraints') as {
      extractTouristConstraintMusts: (s: string) => string[];
    };
    for (const m of extractTouristConstraintMusts(t)) must.push(m);
  } catch {
    /* soft */
  }

  try {
    const { extractQuestMustKeys } = require('../router/missionFollowThrough') as {
      extractQuestMustKeys: (s: string) => string[];
    };
    for (const m of extractQuestMustKeys(t)) must.push(m);
  } catch {
    /* soft */
  }

  // Negationen → Avoid-artige Must-Hints als „kein X“
  const neg = t.match(
    /\b(?:kein|keine|keinen|ohne|nicht)\s+([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß\-]{2,24})/giu,
  );
  if (neg) {
    for (const hit of neg.slice(0, 3)) {
      const token = hit.replace(/^(kein|keine|keinen|ohne|nicht)\s+/iu, '').trim();
      if (token) must.push(`kein_${token.toLowerCase()}`);
    }
  }

  const catalogThin = must.filter((m) => m.length >= 3).length < 2;
  if (catalogThin || looksLikePlaceSeek(t)) {
    for (const tok of extractProvisionalMustTokens(t)) {
      must.push(tok);
    }
  }

  return uniqMusts(must);
}

export function looksLikePlaceSeek(userText: string): boolean {
  const t = userText || '';
  return (
    /\b(wo|restaurant|essen|café|cafe|hotel|bar|club|museum|mach|bock|zeig|finde|suche|brauch|empfehl|geh\s+ich|hingehen|ausgehen|übernacht|uebernacht)\b/iu.test(
      t,
    ) || /\b(ayce|buffet|all\s*you\s*can\s*eat)\b/iu.test(t)
  );
}

/** Schwach = Place-Seek mit &lt;2 brauchbaren Musts. */
export function call2MustsAreWeak(
  musts: string[],
  userText: string,
): boolean {
  const solid = (musts || []).filter((m) => String(m).trim().length >= 3);
  if (!looksLikePlaceSeek(userText)) return solid.length === 0 && userText.length > 24;
  return solid.length < 2;
}

export function formatCall2MustFitRail(opts: {
  musts: string[];
  avoid?: string[];
  weak?: boolean;
}): string {
  const musts = opts.musts.filter(Boolean);
  const avoid = (opts.avoid || []).filter(Boolean);
  if (!musts.length && !opts.weak) return '';
  return [
    '=== CALL-2 MUST-FIT (verbindlich — Wortlaut frei) ===',
    musts.length
      ? `Musts: ${musts.slice(0, 8).join(', ')}`
      : 'Musts: (dünn) — Content-Tokens aus dem User-Satz als Hard-Must ehren',
    avoid.length ? `Avoid: ${avoid.slice(0, 6).join(', ')}` : null,
    opts.weak
      ? 'Musts schwach extrahiert: trotzdem Hard-Fit — nie weich „ähnliche“ Gattung pitchen'
      : null,
    'Backend liefert Shortlist ~3–5; Call-2 filtert hart (geschlossen/Avoid/Cuisine) und pitched Ziel = Top-2 Must-Fit.',
    'Ein Perfect reicht nicht für Gastro/Open-Pitch — mindestens zwei Must-Fit-Optionen wenn möglich.',
    'Nur Optionen die Musts belegen. Soft-Fill / knapper Daneben-Pitch VERBOTEN.',
    'Speech: nur was sitzt. Fehlende Preise/Slots weglassen — kein „leider keine Preise / zu dünn / in A nichts in B nichts“.',
    'Nächster Fit woanders (z. B. Hannover): direkt pitchen mit Distanz — keine Ringsuche vorlesen.',
    'Wirklich null Fit: eine ehrliche nächste Alternative (z. B. Seilbahn → nächster Ort) — kein Ambiguity-Meta, kein Endlos-„nichts gefunden“.',
    'Buttons/Links still — nie in Speech „Link/Formular/vorausgefüllt“ erwähnen.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Must-Zeile aus CALL1_TASK_BRIEF parsen. */
export function parseMustsFromCall1Brief(block: string | null | undefined): string[] {
  const b = String(block || '');
  const m = b.match(/^must:\s*(.+)$/imu);
  if (!m?.[1]) return [];
  return m[1]
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Residual-Ambiguity / weiche Meta-Sätze aus Call-2-Speech.
 * Ask-Back ist schon null — Modell kann trotzdem „falls du … meinst“ sagen.
 */
export function stripCall2SoftAmbiguity(speech: string): string {
  let s = String(speech || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;

  const kill = [
    /\bwas\s+meinst\s+du\s+(genau\s+)?(mit\s+[^.!?]{0,60})?[^.!?]*[.!?]?/giu,
    /\bwas\s+genau\s+meinst\s+du\b[^.!?]*[.!?]?/giu,
    /\bkannst\s+du\s+(das\s+)?(etwas\s+)?(präziser|genauer)\b[^.!?]*[.!?]?/giu,
    /\bsei\s+(etwas\s+)?genauer\b[^.!?]*[.!?]?/giu,
    /\bfalls\s+du\s+(damit\s+)?(eher\s+)?[^.!?]{0,50}\bmeinst\b[^.!?]*[.!?]?/giu,
    /\bwenn\s+du\s+mit\s+[^.!?]{0,40}\bmeinst\b[^.!?]*[.!?]?/giu,
    /\bich\s+(tippe|rate|nehme\s+an)\s+(mal\s+)?[^.!?]*[.!?]?/giu,
    /\bsag\s+mir\s+kurz,?\s+was\s+du\s+meinst\b[^.!?]*[.!?]?/giu,
    /\bwelches\s+(genau\s+)?(meinst|boot|hotel|restaurant)\b[^.!?]*[.!?]?/giu,
    /\b(leider\s+)?(keine|keinen|kein)\s+(preise?|speisekarte|link|treffer)\s+(gefunden|dabei)\b[^.!?]*[.!?]?/giu,
    /\bzu\s+dünn\b[^.!?]*[.!?]?/giu,
    /\bin\s+\w+\s+(habe\s+ich\s+)?nichts\s+gefunden[^.!?]*[.!?]?/giu,
    /\b(link|formular)\s+(ist\s+)?(bereit|vorausgefüllt|leer)\b[^.!?]*[.!?]?/giu,
  ];
  for (const re of kill) {
    s = s.replace(re, ' ');
  }
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}
