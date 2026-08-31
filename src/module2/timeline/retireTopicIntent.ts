/**
 * User sagt: Thema ist durch / irrelevant / gefunden — tot, nicht wiederbeleben.
 * Keine Orts-Hardcodes; Hint kommt aus der Äußerung.
 */

export type RetireTopicIntent = {
  hint: string | null;
  /** Ohne Objekt: aktuellen Faden schließen, nicht den ganzen Tag leeren. */
  closeForeground: boolean;
};

const HINT_RE =
  /\b(?:die\s+|das\s+|den\s+|meine?\s+|den\s+plan\s+)?(.{2,40}?)(?:\s+(?:ist|war))?\s+(?:unrelevant|irrelevant|unwichtig|vom\s+tisch)\b/iu;

const BARE_RE =
  /\b(?:ist\s+(?:jetzt\s+)?(?:unrelevant|irrelevant|unwichtig)|nicht\s+mehr\s+(?:relevant|aktuell|nötig|noetig|wichtig)|vergiss\s+(?:das|es|den|die|ihn|sie)|check[,.]?\s+(?:das\s+)?(?:war['\u2019]?s|passt|erledigt|abgehakt)|streiche?\s+das|abgehakt|vom\s+tisch)\b/iu;

const NOISE =
  /^(das|es|den|die|der|mein|meine|jetzt|noch|mal|bitte|plan|thema|ding|sache)$/i;

function cleanHint(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 48) return null;
  if (NOISE.test(s)) return null;
  return s;
}

/** „Zahnbürste ist irrelevant“ / „check, das war's“ / „nicht mehr aktuell“. */
export function detectRetireTopicIntent(text: string): RetireTopicIntent | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const hinted = t.match(HINT_RE);
  if (hinted?.[1]) {
    const hint = cleanHint(hinted[1]);
    if (hint) return { hint, closeForeground: true };
  }
  if (BARE_RE.test(t)) {
    return { hint: null, closeForeground: true };
  }
  return null;
}
