/**
 * Modul 5 — Speech-Sanitizer + Stichpunkt-Normalisierung.
 */

const EMAIL_RE = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g;
const PHONE_RE = /(?:\+|00)?\d[\d\s/().-]{6,}\d/g;
const STREET_RE =
  /\b[\wÄÖÜäöüß.-]+(?:straße|strasse|str\.|platz|weg|allee|gasse|ring|damm)\s*\d{0,4}[a-zA-Z]?\b/gi;
const PLZ_CITY_RE = /\b\d{5}\s+[A-ZÄÖÜ][\wÄÖÜäöüß.-]+/g;

export function sanitizePlanSpeech(text: string): string {
  let out = (text ?? '')
    .replace(EMAIL_RE, '')
    .replace(PHONE_RE, '')
    .replace(STREET_RE, '')
    .replace(PLZ_CITY_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(
      /\bich\s+(aktualisiere|passe|schiebe|baue|rechne)\s+(jetzt\s+)?(den\s+)?(master)?plan\b[^.!?]*[.!?]?/giu,
      '',
    )
    .replace(
      /\b(fixedNodes|openWishesQueue|openQuestions|bridgeSpeech|destinationCity|geoAnchor|lageMode|estimatedTime|needsClarification|planPriority|userFixedTime|hardAnchor|completeness|taskQueue)\b/gi,
      '',
    )
    .replace(/\bprio(?:rit[aä]t)?\s*[=:]?\s*[1-6]\b/giu, '')
    .replace(/\b(choice_|wish_|fix_|task_|anchor_)[a-z0-9_-]+/gi, '')
    .replace(
      /\b(remove_stop|move_stop|replace_stop|clear_soft_day|resolve_conflict|set_leg_transport|start_navigation|fill_tour_gaps|upsert_hint|ask_clarify|merge_or_split)\b/gi,
      '',
    )
    .replace(/\b(datensatz|masterplan)\b/gi, '')
    .replace(/\boffener wunsch\b/gi, '')
    .replace(/[{}\[\]|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  try {
    const { stripListLead } = require('../kernel/turnKernel') as {
      stripListLead: (s: string) => string;
    };
    out = stripListLead(out);
  } catch {
    /* soft */
  }
  return out;
}

/** Timeline-Titel für UI und Stimme — keine internen Tokens. */
export function humanizePlanTitle(title: string): string {
  let t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (
    /^(plane?\s+mir|mach\s+mir(?:\s+einen)?|organisiere|tour\s+durch|tagesplan)\b/i.test(
      t,
    )
  ) {
    const city = t.match(/\b(?:durch|in)\s+([A-ZÄÖÜ][\p{L}'-]{2,})\b/u);
    t = city?.[1] ? `Tag in ${city[1]}` : 'Tagesplan';
  }
  t = t.replace(/^[📌📍✨🏁🔔🥇🥈🔵]\s*/u, '');
  t = t.replace(/\bprio(?:rit[aä]t)?\s*[=:]?\s*[1-6]\b/giu, '');
  t = t.replace(/\boffener wunsch\b/gi, '');
  t = t.replace(
    /\b(fixedNodes|openWishesQueue|completeness|estimatedTime)\b/gi,
    '',
  );
  t = t.replace(/\s{2,}/g, ' ').replace(/^[-–—:,.]\s*/, '').trim();
  return t.slice(0, 48);
}

function hmToSpoken(hm: string | null | undefined): string {
  const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = String(Number(m[1]));
  const min = m[2];
  return min === '00' ? `um ${h} Uhr` : `um ${h} Uhr ${min}`;
}

type OverviewSlot = { time: string | null; title: string; explore: boolean };

function slotLine(s: OverviewSlot): string {
  const title = humanizePlanTitle(s.title);
  if (!title) return '';
  const when = hmToSpoken(s.time);
  return when ? `${when} ${title}` : title;
}

/**
 * Einmal den ganzen Tag sagen — dann erst Stück für Stück.
 * Nur Zeiten + Titel, keine internen Felder.
 */
export function buildCompletePlanSpeech(plan: {
  destinationCity?: string | null;
  fixedNodes: Array<{ title: string; time: string | null }>;
  openWishesQueue: Array<{
    title: string;
    estimatedTime?: string | null;
    priority: number;
    context: string;
  }>;
}): string {
  const dest = (plan.destinationCity || '').trim();
  const exploreRe = /\b(erkunden|highlights?|sightseeing|bummel|tour)\b/i;
  const slots: OverviewSlot[] = [
    ...plan.fixedNodes.map((n) => ({
      time: n.time,
      title: n.title,
      explore: false,
    })),
    ...plan.openWishesQueue.map((w) => ({
      time: w.estimatedTime ?? null,
      title: w.title,
      explore: w.priority === 6 || exploreRe.test(`${w.title} ${w.context}`),
    })),
  ]
    .map((s) => ({ ...s, title: humanizePlanTitle(s.title) }))
    .filter((s) => s.title.length > 0)
    .sort((a, b) => {
      if (a.explore !== b.explore) return a.explore ? 1 : -1;
      return (a.time || '99:99').localeCompare(b.time || '99:99');
    });

  const lines = slots.map(slotLine).filter(Boolean).slice(0, 12);
  if (lines.length === 0) {
    return dest
      ? `Der Tag in ${dest} steht oben im Plan. Als Nächstes gehen wir die offenen Punkte der Reihe nach durch.`
      : 'Der Tag steht oben im Plan. Als Nächstes gehen wir die offenen Punkte der Reihe nach durch.';
  }
  let body: string;
  if (lines.length === 1) body = lines[0]!;
  else if (lines.length === 2) body = `${lines[0]} und ${lines[1]}`;
  else {
    body = `${lines.slice(0, -1).join(', ')}, und zum Schluss ${lines[lines.length - 1]}`;
  }
  const head = dest ? `So steht der Tag in ${dest}: ` : 'So steht der Tag: ';
  return sanitizePlanSpeech(
    `${head}${body}. Als Nächstes gehen wir die offenen Punkte der Reihe nach durch.`,
  );
}

/**
 * Max. 3 Stichpunkte — Fakten/Zahlen zuerst.
 * „4,3★ Gut“ ersetzt „gut bewertet“; keine Doppel-Sterne-Zeilen.
 */
export function normalizePlanBullets(
  raw: Array<string | null | undefined>,
  max = 3,
): string[] {
  const cleaned = raw
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean)
    .map((s) =>
      s
        .replace(EMAIL_RE, '')
        .replace(PHONE_RE, '')
        .replace(/^📍\s*/, '')
        // „4.3★ Gut bewertet“ → „4.3★ Gut“
        .replace(/\b(\d+[.,]\d+)\s*★?\s*(Top|Gut|Okay)?\s*bewertet\b/i, '$1★ $2')
        .replace(/\b(Top|Gut|Okay)\s*bewertet\b/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((s) => s.length > 1)
    // Fake-Distanz / GPS-Meta nie behalten
    .filter((s) => !/0\s*m|aktuelle\s+gps|gps-position/i.test(s));

  // Dedup ähnliche Sterne-Zeilen
  const seenStar = { has: false };
  const deduped: string[] = [];
  for (const s of cleaned) {
    const isStar = /\d+[.,]?\d*\s*★/.test(s) || /stern/i.test(s);
    if (isStar) {
      if (seenStar.has) continue;
      seenStar.has = true;
    }
    if (
      deduped.some(
        (d) => d.toLowerCase() === s.toLowerCase() || d.includes(s) || s.includes(d),
      )
    ) {
      continue;
    }
    deduped.push(s);
  }

  const score = (s: string): number => {
    let n = 0;
    if (/\d/.test(s)) n += 4;
    if (/€|eur|pizza|burger|pasta|min|km|\bm\b|vom |lage|fischmarkt|elb/i.test(s)) {
      n += 3;
    }
    if (/★/.test(s)) n += 2;
    if (/bewert|favorit|alternative|toll|super/i.test(s)) n -= 2;
    if (/straße|strasse|str\.|@/i.test(s)) n -= 5;
    // GPS-Meta / Fake-Distanz nie oben
    if (/0\s*m|aktuelle\s+gps|gps-position/i.test(s)) n -= 20;
    return n;
  };

  return [...deduped].sort((a, b) => score(b) - score(a)).slice(0, max);
}

/** Sterne-Label: Zahl + Wort — ersetzt „gut bewertet“. */
export function starBullet(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const n = Math.round(rating * 10) / 10;
  const word = rating >= 4.5 ? 'Top' : rating >= 4.0 ? 'Gut' : rating >= 3.5 ? 'Okay' : 'Schwach';
  return `${n}★ ${word}`;
}
