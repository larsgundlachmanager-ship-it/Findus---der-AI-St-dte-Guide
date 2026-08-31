/**
 * Erkennt, wenn der User über bereits eingetragene Timeline-Punkte spricht.
 * Stadt-/Orts-agnostisch: nur Titel, Notizen, Uhrzeiten, Kategorie-Tokens.
 */

import {
  useFuturePlanStore,
  type FuturePlanStop,
} from './futurePlanState';

const STOP_WORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'einem',
  'einen',
  'und',
  'oder',
  'mit',
  'zum',
  'zur',
  'zu',
  'im',
  'in',
  'am',
  'um',
  'auf',
  'von',
  'vom',
  'für',
  'fuer',
  'nach',
  'noch',
  'bitte',
  'mal',
  'auch',
  'dann',
  'jetzt',
  'heute',
  'morgen',
  'abend',
  'uhr',
  'termin',
  'termine',
  'punkt',
  'punkte',
  'stopp',
  'stopps',
  'eintrag',
  'einträge',
  'eintraege',
  'plan',
  'planung',
  'ort',
  'orte',
]);

/** Abstrakte Kategorie-Synonyme — nur Tokens, keine Ortsnamen. */
const CATEGORY_BUCKETS: Array<{ id: string; tokens: string[] }> = [
  {
    id: 'museum',
    tokens: ['museum', 'museen', 'galerie', 'ausstellung', 'kunsthalle'],
  },
  {
    id: 'cafe',
    tokens: ['café', 'cafe', 'kaffee', 'bäckerei', 'baeckerei', 'bakery'],
  },
  {
    id: 'meal',
    tokens: [
      'restaurant',
      'essen',
      'mittag',
      'abendessen',
      'dinner',
      'frühstück',
      'fruehstueck',
      'imbiss',
      'bistro',
    ],
  },
  {
    id: 'park',
    tokens: ['park', 'garten', 'strand', 'promenade', 'aussicht'],
  },
  {
    id: 'sport',
    tokens: ['tennis', 'sport', 'fitness', 'schwimmen', 'club', 'training'],
  },
  {
    id: 'shop',
    tokens: ['einkauf', 'supermarkt', 'laden', 'shop', 'markt'],
  },
  {
    id: 'work',
    tokens: ['arbeit', 'schicht', 'job', 'büro', 'buero'],
  },
  {
    id: 'hotel',
    tokens: ['hotel', 'unterkunft', 'pension', 'hostel'],
  },
  {
    id: 'transit',
    tokens: ['zug', 'bahn', 'flug', 'bus', 'bahnhof', 'flughafen'],
  },
  {
    id: 'nature',
    tokens: ['sonnenuntergang', 'sunset', 'sonnenaufgang', 'sunrise'],
  },
];

export type PlanStopMatch = {
  stop: FuturePlanStop;
  score: number;
  reasons: string[];
};

export type ExistingPlanReference =
  | {
      kind: 'none';
    }
  | {
      kind: 'match';
      stops: FuturePlanStop[];
      primary: FuturePlanStop;
      wantsEdit: boolean;
      editIntent: 'delete' | 'move' | 'ask' | null;
      deltaMin?: number;
    }
  | {
      kind: 'ambiguous';
      stops: FuturePlanStop[];
      wantsEdit: boolean;
      editIntent: 'delete' | 'move' | 'ask' | null;
    };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[„“"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(s: string): string[] {
  return normalize(s)
    .split(/[^a-z0-9äöüß]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function formatClock(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function listEditablePlanStops(): FuturePlanStop[] {
  return useFuturePlanStore
    .getState()
    .plan.stops.filter(
      (s) =>
        s.kind !== 'nav_leg' &&
        !s.id.startsWith('choice_') &&
        !s.id.startsWith('nav_remind_') &&
        !s.id.startsWith('leave_'),
    );
}

function categoryHits(text: string): Set<string> {
  const n = normalize(text);
  const hit = new Set<string>();
  for (const b of CATEGORY_BUCKETS) {
    if (b.tokens.some((tok) => n.includes(tok))) hit.add(b.id);
  }
  return hit;
}

function clocksInText(text: string): Array<{ h: number; m: number }> {
  const out: Array<{ h: number; m: number }> = [];
  const re =
    /\b(?:um\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const h = Number(m[1]);
    const min = m[2] != null ? Number(m[2]) : 0;
    if (Number.isFinite(h) && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      out.push({ h, m: min });
    }
  }
  return out;
}

function scoreStopAgainstUtterance(
  utterance: string,
  stop: FuturePlanStop,
): PlanStopMatch | null {
  const u = normalize(utterance);
  const title = normalize(stop.title);
  if (!title || title.length < 2) return null;

  const reasons: string[] = [];
  let score = 0;

  if (u.includes(title)) {
    score += 100;
    reasons.push('exact_title');
  } else if (title.length >= 5 && u.includes(title.slice(0, Math.min(12, title.length)))) {
    score += 70;
    reasons.push('title_prefix');
  }

  const uTokens = tokensOf(utterance);
  const tTokens = tokensOf(stop.title);
  const noteTokens = tokensOf(stop.notes ?? '');
  const stopTokens = new Set([...tTokens, ...noteTokens]);
  let overlap = 0;
  for (const t of uTokens) {
    if (stopTokens.has(t)) {
      overlap += 1;
      score += t.length >= 6 ? 28 : 18;
    } else {
      for (const st of stopTokens) {
        if (st.includes(t) || t.includes(st)) {
          overlap += 1;
          score += 12;
          break;
        }
      }
    }
  }
  if (overlap) reasons.push(`tokens:${overlap}`);

  const uCats = categoryHits(utterance);
  const sCats = categoryHits(`${stop.title} ${stop.notes ?? ''}`);
  for (const c of uCats) {
    if (sCats.has(c)) {
      score += 22;
      reasons.push(`cat:${c}`);
    }
  }

  const clocks = clocksInText(utterance);
  if (stop.plannedStartMs != null && clocks.length) {
    const d = new Date(stop.plannedStartMs);
    const sh = d.getHours();
    const sm = d.getMinutes();
    for (const c of clocks) {
      if (c.h === sh && (c.m === 0 || Math.abs(c.m - sm) <= 5 || sm === c.m)) {
        score += 40;
        reasons.push('clock');
        break;
      }
    }
  }

  // Deixis ohne Titel: „der Termin“, „eingetragen“ — nur mit Kategorie/Uhr sinnvoll
  const deictic =
    /\b(eingetragen|im\s+plan|in\s+der\s+timeline|den\s+wir|schon\s+drin|bereits|der\s+termin|den\s+termin|dieser\s+punkt)\b/i.test(
      utterance,
    );
  if (deictic && score >= 18) {
    score += 10;
    reasons.push('deictic');
  }

  if (score < 28) return null;
  return { stop, score, reasons };
}

export function resolvePlanStopsFromUtterance(
  utterance: string,
  opts?: { minScore?: number; limit?: number },
): PlanStopMatch[] {
  const minScore = opts?.minScore ?? 28;
  const limit = opts?.limit ?? 5;
  const stops = listEditablePlanStops();
  if (!stops.length || !utterance.trim()) return [];

  return stops
    .map((s) => scoreStopAgainstUtterance(utterance, s))
    .filter((m): m is PlanStopMatch => !!m && m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** SSOT-Titel-Hint-Match (ersetzt lokale Duplikate). */
export function findStopByTitleHint(hint: string): FuturePlanStop | null {
  const q = hint.trim();
  if (!q) return null;
  const exact = listEditablePlanStops().find(
    (s) => normalize(s.title) === normalize(q),
  );
  if (exact) return exact;
  const scored = resolvePlanStopsFromUtterance(q, { minScore: 24, limit: 1 });
  if (scored[0]) return scored[0].stop;
  const nq = normalize(q);
  return (
    listEditablePlanStops().find(
      (s) =>
        normalize(s.title).includes(nq) ||
        nq.includes(normalize(s.title)) ||
        normalize(s.title).includes(nq.slice(0, 10)),
    ) ?? null
  );
}

export function detectExistingPlanEditIntent(utterance: string): {
  wantsDelete: boolean;
  wantsMove: boolean;
  deltaMin?: number;
} {
  const lower = utterance.toLowerCase();
  const wantsDelete =
    /lösch|loesch|entfernen|streich|raus\s+damit|\bcancel\b|über\s+den\s+haufen|ueber\s+den\s+haufen|brauch\s+(ich\s+)?nicht|doch\s+nicht/.test(
      lower,
    );
  const softLater =
    /\b(später|spaeter|früher|frueher)\b/.test(lower) &&
    /\b(termin|stopp|eintrag|punkt|plan|museum|café|cafe|essen|tennis|arbeit|hotel|ort)\b/.test(
      lower,
    );
  const wantsMove =
    /verschieb|leg\s+.+?\s+(auf|um)|später\s+legen|spaeter\s+legen|früher\s+legen|frueher\s+legen|\+\s*15|\-\s*15/.test(
      lower,
    ) ||
    // „ändere Turnier von 14 auf 16“ / „setz Tennis auf 16 Uhr“
    (/\b(änder|aender|ändern|aendern|setz|stell)\w*\b/.test(lower) &&
      /\b(auf|um|von)\s+\d{1,2}(?::\d{2})?\b/.test(lower)) ||
    (/(\bauf\s+\d{1,2}|\bum\s+\d{1,2}).*uhr/.test(lower) &&
      /verschieb|leg|setz|änder|aender/.test(lower)) ||
    softLater ||
    (/\b(termin|eintrag|stopp|punkt|turnier|tennis)\b/.test(lower) &&
      /\b(später|spaeter|früher|frueher|auf\s+\d{1,2}|von\s+\d{1,2}\s+auf)\b/.test(
        lower,
      ));

  let deltaMin: number | undefined;
  if (/später|spaeter|\+\s*15|15\s*min(?:uten)?\s*später/.test(lower)) {
    deltaMin = 15;
  } else if (/früher|frueher|-\s*15/.test(lower)) {
    deltaMin = -15;
  } else if (/(\d+)\s*min/.test(lower)) {
    const n = Number(lower.match(/(\d+)\s*min/)?.[1]);
    if (Number.isFinite(n)) {
      deltaMin = /früher|frueher|zurück|zurueck/.test(lower) ? -n : n;
    }
  }

  return { wantsDelete, wantsMove, deltaMin };
}

function looksLikeFreshMultiPlan(utterance: string): boolean {
  const t = utterance.toLowerCase();
  if (
    /\b(ganzen?\s+tag|tag\s+planen|heute\s+planen|neuen?\s+plan|planung\s+starten|mehrere\s+dinge|erstens|zweitens)\b/.test(
      t,
    )
  ) {
    return true;
  }
  // Viele Wunsch-Clauses → eher neuer Plan, nicht nur Referenz
  const clauses = t.split(/[.!?;]| und dann | danach | außerdem | ausserdem /i);
  return clauses.filter((c) => c.trim().length > 18).length >= 4;
}

/**
 * Soft-Referenz auf bestehende Einträge (inkl. Edit-Intent).
 */
export function resolveExistingPlanReference(
  utterance: string,
): ExistingPlanReference {
  const stops = listEditablePlanStops();
  if (!stops.length) return { kind: 'none' };

  const matches = resolvePlanStopsFromUtterance(utterance, {
    minScore: 28,
    limit: 4,
  });
  const edit = detectExistingPlanEditIntent(utterance);
  const deicticOnly =
    /\b(eingetragen|im\s+plan|in\s+der\s+timeline|schon\s+drin|bereits\s+(drin|eingetragen)|der\s+termin|den\s+termin)\b/i.test(
      utterance,
    );

  if (!matches.length) {
    // Nur Deixis ohne Treffer: letzter Stop nur bei klarem Edit
    if ((edit.wantsDelete || edit.wantsMove) && deicticOnly && stops.length === 1) {
      return {
        kind: 'match',
        stops: [stops[0]!],
        primary: stops[0]!,
        wantsEdit: true,
        editIntent: edit.wantsDelete ? 'delete' : 'move',
        deltaMin: edit.deltaMin,
      };
    }
    return { kind: 'none' };
  }

  const top = matches[0]!;
  const close = matches.filter((m) => m.score >= top.score - 12);
  const wantsEdit = edit.wantsDelete || edit.wantsMove;
  const editIntent = edit.wantsDelete
    ? ('delete' as const)
    : edit.wantsMove
      ? ('move' as const)
      : deicticOnly
        ? ('ask' as const)
        : null;

  if (close.length > 1 && top.score < 90) {
    return {
      kind: 'ambiguous',
      stops: close.map((m) => m.stop),
      wantsEdit,
      editIntent,
    };
  }

  return {
    kind: 'match',
    stops: [top.stop],
    primary: top.stop,
    wantsEdit,
    editIntent,
    deltaMin: edit.deltaMin,
  };
}

export function utteranceLikelyRefersToExistingPlan(utterance: string): boolean {
  if (looksLikeFreshMultiPlan(utterance)) return false;
  const ref = resolveExistingPlanReference(utterance);
  return ref.kind !== 'none';
}

/** Kompakte Liste für LLM-Ingest / Prompts. */
export function serializeExistingPlanForIngest(limit = 16): string {
  const stops = listEditablePlanStops()
    .filter((s) => !s.id.startsWith('wish_') || s.plannedStartMs != null)
    .slice(0, limit);
  if (!stops.length) return '(keine)';
  return stops
    .map((s) => {
      const clock = formatClock(s.plannedStartMs);
      return `- id=${s.id} · „${s.title}“${clock ? ` · ${clock}` : ''}${
        s.kind ? ` · ${s.kind}` : ''
      }`;
    })
    .join('\n');
}

export function describeExistingStop(stop: FuturePlanStop): string {
  const clock = formatClock(stop.plannedStartMs);
  return clock ? `„${stop.title}“ um ${clock}` : `„${stop.title}“`;
}
