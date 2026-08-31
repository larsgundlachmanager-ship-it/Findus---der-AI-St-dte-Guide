/**
 * Correction → LearnedRule Loop
 * User korrigiert Antwort → strukturierte Regel speichern → nächstes Mal injizieren.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { getCachedUserProfile } from '../userProfileService';
import { useUserProfileStore } from '../../store/useUserProfileStore';
import { useFinnusStore } from '../../store/useFinnusStore';
import {
  LEARNED_RULE_AVOID_LABELS,
  LEARNED_RULE_EXPECT_LABELS,
  MAX_LEARNED_RULES,
  type LearnedRule,
  type LearnedRuleAvoid,
  type LearnedRuleExpect,
  type LearnedRuleIntentFamily,
} from '../../types/learnedRules';

const CORRECTION_HINT =
  /\b(?:nee+|nö+|noe+|nein|falsch|stimmt\s+nicht|ich\s+meinte|ich\s+wollte|nicht\s+das|doch\s+nicht|eher\s+so|nächstes?\s+mal|stattdessen|besser|ohne\s+(?:die\s+)?historie|ohne\s+geschichte|kürzer|konkreter|direkt|preise?|buchung|link|website|öffnungszeit|ticket)\b/iu;

const EXPECT_ALL: LearnedRuleExpect[] = [
  'prices',
  'duration',
  'booking_url',
  'website',
  'life_now',
  'short_history',
  'answer_first',
  'concrete_place',
  'route_button',
  'alternatives',
  'times_hours',
  'menu',
  'tickets',
];

const AVOID_ALL: LearnedRuleAvoid[] = [
  'long_history',
  'address_unless_asked',
  'gps_coords',
  'fake_promises',
  'permission_questions',
  'meta_app_pitch',
  'vague_filler',
  'nav_auto_start',
];

const FAMILY_ALL: LearnedRuleIntentFamily[] = [
  'activity_poi',
  'dining',
  'events',
  'hotel',
  'navigation',
  'knowledge',
  'planning',
  'booking',
  'general',
];

export type CorrectionCaptureResult = {
  isCorrection: boolean;
  rule: LearnedRule | null;
  /** Frage für denselben Turn neu beantworten (Korrektur + Kontext). */
  effectiveQuestion: string | null;
  replyHint: string | null;
};

function clampStrength(n: number): number {
  if (!Number.isFinite(n)) return 0.4;
  return Math.max(0.2, Math.min(1, n));
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `lr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function uniqStrings(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const t = x.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(x.trim());
  }
  return out;
}

function filterExpect(raw: unknown): LearnedRuleExpect[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim() as LearnedRuleExpect)
    .filter((x) => EXPECT_ALL.includes(x));
}

function filterAvoid(raw: unknown): LearnedRuleAvoid[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim() as LearnedRuleAvoid)
    .filter((x) => AVOID_ALL.includes(x));
}

function filterFamily(raw: unknown): LearnedRuleIntentFamily {
  const s = String(raw ?? 'general').trim() as LearnedRuleIntentFamily;
  return FAMILY_ALL.includes(s) ? s : 'general';
}

function digest(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Letzte User-Frage + letzte Assistant-Antwort aus Session-Chat. */
export function getRecentTurnPair(): {
  lastUser: string | null;
  lastAssistant: string | null;
} {
  const hist = useFinnusStore.getState().chatHistory ?? [];
  let lastUser: string | null = null;
  let lastAssistant: string | null = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    const m = hist[i];
    if (!m) continue;
    if (!lastAssistant && m.role === 'assistant' && m.content?.trim()) {
      lastAssistant = m.content.trim();
    } else if (
      !lastUser &&
      lastAssistant &&
      m.role === 'user' &&
      m.content?.trim()
    ) {
      lastUser = m.content.trim();
      break;
    }
  }
  if (!lastUser) {
    for (let i = hist.length - 1; i >= 0; i--) {
      const m = hist[i];
      if (m?.role === 'user' && m.content?.trim()) {
        lastUser = m.content.trim();
        break;
      }
    }
  }
  return { lastUser, lastAssistant };
}

export function looksLikeAnswerCorrection(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 8) return false;
  // Blankes Nein / Stop — kein Lern-Signal
  if (/^(nee+|nö+|noe+|nein|falsch|doch\s+nicht)[.!?]*$/iu.test(t)) {
    return false;
  }
  if (!CORRECTION_HINT.test(t)) return false;
  // Reine Prefs („nenn mich nicht Bro“) sind keine Antwort-Korrektur
  if (
    /\bnenn\s+mich\b/iu.test(t) &&
    !/\b(?:antwort|gesagt|erzähl|historie|geschichte|preis|buchung)\b/iu.test(t)
  ) {
    return false;
  }
  const { lastAssistant } = getRecentTurnPair();
  // Ohne vorherige Antwort nur bei starken Korrektur-Markern
  if (!lastAssistant) {
    return /\b(?:nächstes?\s+mal|ich\s+meinte|falsch|stimmt\s+nicht)\b/iu.test(
      t,
    );
  }
  // Braucht Substanz über das reine Nein hinaus
  const stripped = t
    .replace(/^(nee+|nö+|noe+|nein|falsch)[,.\s]*/iu, '')
    .trim();
  if (stripped.length < 6) return false;
  return true;
}

/** Heuristik: Intent-Family aus Text + letztem Turn. */
export function inferIntentFamily(
  text: string,
  priorUser?: string | null,
  priorAssistant?: string | null,
): LearnedRuleIntentFamily {
  const blob = [text, priorUser ?? '', priorAssistant ?? '']
    .join(' ')
    .toLowerCase();
  if (
    /\b(restaurant|essen|gastro|imbiss|café|cafe|veggie|vegetar|speisekarte|mittag|abendessen)\b/u.test(
      blob,
    )
  ) {
    return 'dining';
  }
  if (/\b(hotel|übernacht|uebernacht|unterkunft|zimmer)\b/u.test(blob)) {
    return 'hotel';
  }
  if (
    /\b(event|konzert|party|tonight|heute\s+abend|tickets?|flyer|veranstaltung|kino|film|cinema|theater|theatre|schauspiel|musical|oper|popcorn)\b/u.test(
      blob,
    )
  ) {
    return 'events';
  }
  if (
    /\b(wasserski|surf|sport|freizeit|aktivität|buchen|verleih|kurs|mitmachen)\b/u.test(
      blob,
    )
  ) {
    return 'activity_poi';
  }
  if (
    /\b(navig|route|führ\s+mich|fahr\s+mich|geh\s+zu|bring\s+mich)\b/u.test(
      blob,
    )
  ) {
    return 'navigation';
  }
  if (/\b(plan|tagesplan|itinerar|vormittag|nachmittag)\b/u.test(blob)) {
    return 'planning';
  }
  if (/\b(buchung|mietrad|portal|reservier)\b/u.test(blob)) {
    return 'booking';
  }
  if (
    /\b(geschichte|historie|museum|kirche|wann\s+gebaut|wer\s+war)\b/u.test(
      blob,
    )
  ) {
    return 'knowledge';
  }
  return 'general';
}

/** Deterministische Extraktion ohne LLM. */
export function extractCorrectionFast(
  text: string,
  ctx: { lastUser: string | null; lastAssistant: string | null },
): Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> | null {
  if (!looksLikeAnswerCorrection(text)) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  const expect: LearnedRuleExpect[] = [];
  const avoid: LearnedRuleAvoid[] = [];
  const tags: string[] = [];

  if (/\bpreis(?:e|en)?\b/iu.test(t)) {
    expect.push('prices');
    tags.push('prices');
  }
  if (/\b(?:dauer|wie\s+lange|minuten|stunden)\b/iu.test(t)) {
    expect.push('duration');
    tags.push('duration');
  }
  if (/\b(?:buchung|buchen|link|website|seite)\b/iu.test(t)) {
    expect.push('booking_url', 'website');
    tags.push('booking');
  }
  if (/\b(?:öffnungszeit|uhrzeit|wann\s+auf|zeiten)\b/iu.test(t)) {
    expect.push('times_hours');
    tags.push('hours');
  }
  if (/\b(?:ticket|eintritt)\b/iu.test(t)) {
    expect.push('tickets');
    tags.push('tickets');
  }
  if (/\b(?:speisekarte|menü|menu|karte)\b/iu.test(t)) {
    expect.push('menu');
    tags.push('menu');
  }
  if (
    /\b(?:ohne|keine|nicht)\s+(?:die\s+)?(?:lange\s+)?(?:historie|geschichte)\b/iu.test(
      t,
    ) ||
    /\b(?:weniger|kurz)\s+(?:historie|geschichte)\b/iu.test(t)
  ) {
    expect.push('life_now', 'short_history');
    avoid.push('long_history');
    tags.push('life_now');
  }
  if (/\b(?:direkt|konkret|antwort\s+zuerst|ohne\s+gelaber)\b/iu.test(t)) {
    expect.push('answer_first', 'concrete_place');
    avoid.push('vague_filler');
    tags.push('answer_first');
  }
  if (/\b(?:keine\s+adresse|ohne\s+adresse|kein\s+gps)\b/iu.test(t)) {
    avoid.push('address_unless_asked', 'gps_coords');
  }
  if (
    /\b(?:nicht\s+navig|keine\s+navigation|nicht\s+führen|nicht\s+starten)\b/iu.test(
      t,
    )
  ) {
    avoid.push('nav_auto_start');
    tags.push('no_nav');
  }
  if (/\b(?:alternative|andere\s+option|auch\s+noch)\b/iu.test(t)) {
    expect.push('alternatives');
  }
  if (/\b(?:route|weg\s+ dahin|bring\s+mich)\b/iu.test(t)) {
    expect.push('route_button');
  }

  // Default soft: Korrektur ohne Stichworte → Antwort-first + konkret
  if (!expect.length && !avoid.length) {
    expect.push('answer_first', 'concrete_place');
    avoid.push('vague_filler');
  }

  const family = inferIntentFamily(t, ctx.lastUser, ctx.lastAssistant);
  const summaryParts: string[] = [];
  for (const e of uniqStrings(expect) as LearnedRuleExpect[]) {
    summaryParts.push(LEARNED_RULE_EXPECT_LABELS[e]);
  }
  for (const a of uniqStrings(avoid) as LearnedRuleAvoid[]) {
    summaryParts.push(`vermeide: ${LEARNED_RULE_AVOID_LABELS[a]}`);
  }

  return {
    scope: 'user',
    intentFamily: family,
    tags: uniqStrings(tags).slice(0, 8),
    expect: uniqStrings(expect) as LearnedRuleExpect[],
    avoid: uniqStrings(avoid) as LearnedRuleAvoid[],
    summary: summaryParts.slice(0, 6).join('; ') || 'Antwort an User-Korrektur anpassen',
    strength: 0.55,
    evidenceDigest: digest(t),
  };
}

async function extractCorrectionLlm(
  text: string,
  ctx: { lastUser: string | null; lastAssistant: string | null },
): Promise<Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> | null> {
  if (!hasGeminiApiKey()) return null;
  const prompt = [
    'Extrahiere eine STRUKTURELLE Antwort-Regel aus der User-Korrektur. JSON only:',
    '{"intentFamily":"activity_poi|dining|events|hotel|navigation|knowledge|planning|booking|general",',
    '"tags":["string"],"expect":["prices|duration|booking_url|website|life_now|short_history|answer_first|concrete_place|route_button|alternatives|times_hours|menu|tickets"],',
    '"avoid":["long_history|address_unless_asked|gps_coords|fake_promises|permission_questions|meta_app_pitch|vague_filler|nav_auto_start"],',
    '"summary":"ein Satz Struktur-Constraint ohne festen Wortlaut"}',
    'Regeln: Nur Constraints/Struktur, nie Dialog-Skript. Nichts erfinden. Max 6 expect, 4 avoid.',
    `Vorherige User-Frage: ${(ctx.lastUser ?? '').slice(0, 220)}`,
    `Vorherige Yorro-Antwort (Auszug): ${(ctx.lastAssistant ?? '').slice(0, 280)}`,
    `Korrektur: ${text.slice(0, 400)}`,
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'intent',
      maxTokens: 220,
      temperature: 0.1,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      intentFamily?: string;
      tags?: string[];
      expect?: string[];
      avoid?: string[];
      summary?: string;
    };
    const expect = filterExpect(parsed.expect);
    const avoid = filterAvoid(parsed.avoid);
    if (!expect.length && !avoid.length && !parsed.summary?.trim()) return null;
    return {
      scope: 'user',
      intentFamily: filterFamily(parsed.intentFamily),
      tags: uniqStrings((parsed.tags ?? []).map(String)).slice(0, 8),
      expect,
      avoid,
      summary: String(parsed.summary ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200) || 'Antwortstruktur an Korrektur anpassen',
      strength: 0.6,
      evidenceDigest: digest(text),
    };
  } catch {
    return null;
  }
}

function rulesEqualKey(a: LearnedRule, b: Pick<LearnedRule, 'intentFamily' | 'expect' | 'avoid' | 'tags'>): boolean {
  const tagA = [...a.tags].map((t) => t.toLowerCase()).sort().join('|');
  const tagB = [...b.tags].map((t) => t.toLowerCase()).sort().join('|');
  const expA = [...a.expect].sort().join('|');
  const expB = [...b.expect].sort().join('|');
  const avA = [...a.avoid].sort().join('|');
  const avB = [...b.avoid].sort().join('|');
  return (
    a.intentFamily === b.intentFamily &&
    (expA === expB || tagA === tagB) &&
    (avA === avB || tagA === tagB)
  );
}

/** Merge/upsert in Profile. */
export async function upsertLearnedRule(
  draft: Omit<LearnedRule, 'id' | 'createdAt' | 'updatedAt' | 'hitCount'> & {
    id?: string;
    hitCount?: number;
  },
): Promise<LearnedRule> {
  const store = useUserProfileStore.getState();
  const profile = getCachedUserProfile() ?? store.profile;
  const existing = [...(profile?.learnedRules ?? [])];
  const ts = nowIso();

  const matchIdx = existing.findIndex((r) => rulesEqualKey(r, draft));
  let saved: LearnedRule;
  if (matchIdx >= 0) {
    const prev = existing[matchIdx]!;
    saved = {
      ...prev,
      tags: uniqStrings([...prev.tags, ...draft.tags]).slice(0, 8),
      expect: uniqStrings([...prev.expect, ...draft.expect]) as LearnedRuleExpect[],
      avoid: uniqStrings([...prev.avoid, ...draft.avoid]) as LearnedRuleAvoid[],
      summary: draft.summary || prev.summary,
      strength: clampStrength(prev.strength + 0.15),
      hitCount: prev.hitCount,
      updatedAt: ts,
      evidenceDigest: draft.evidenceDigest ?? prev.evidenceDigest,
    };
    existing[matchIdx] = saved;
  } else {
    saved = {
      id: draft.id ?? makeId(),
      scope: 'user',
      intentFamily: draft.intentFamily,
      tags: draft.tags.slice(0, 8),
      expect: draft.expect,
      avoid: draft.avoid,
      summary: draft.summary,
      strength: clampStrength(draft.strength ?? 0.5),
      hitCount: draft.hitCount ?? 0,
      createdAt: ts,
      updatedAt: ts,
      evidenceDigest: draft.evidenceDigest,
    };
    existing.push(saved);
  }

  // Stärkste / neueste behalten
  existing.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  const trimmed = existing.slice(0, MAX_LEARNED_RULES);

  await store.patchProfile({ learnedRules: trimmed });
  return saved;
}

export function getLearnedRules(): LearnedRule[] {
  return getCachedUserProfile()?.learnedRules ?? [];
}

/** Map Modul-2 / Concierge-Intent / JobId → Family. */
export function intentToFamily(intent: string | null | undefined): LearnedRuleIntentFamily {
  const i = (intent ?? '').toLowerCase();
  if (/dining_|gastro|dining|food|meal|restaurant/.test(i)) return 'dining';
  if (/stay_search|hotel|stay|accommodation/.test(i)) return 'hotel';
  if (/tonight_live|nightlife|event|party|ticket/.test(i)) return 'events';
  if (/activity_sport|activit|sport|leisure|booking_platform|rental/.test(i)) {
    return 'activity_poi';
  }
  if (
    /nav_route|transit_live|taxi_|parking_|mobility_|nav|route|mobility|directions/.test(
      i,
    )
  ) {
    return 'navigation';
  }
  if (/day_plan|plan|itinerar|day/.test(i)) return 'planning';
  if (/book|reserv/.test(i)) return 'booking';
  if (
    /museum_theme|sight_|poi_|fact_number|know|histor|museum|poi|story|place/.test(
      i,
    )
  ) {
    return 'knowledge';
  }
  return 'general';
}

export function matchLearnedRules(opts: {
  intent?: string | null;
  /** Job-Contract-ID — schärfere Family-Zuordnung */
  jobId?: string | null;
  userText?: string | null;
  minStrength?: number;
  limit?: number;
}): LearnedRule[] {
  const rules = getLearnedRules();
  if (!rules.length) return [];
  const family = opts.jobId
    ? intentToFamily(opts.jobId)
    : opts.intent
      ? intentToFamily(opts.intent)
      : inferIntentFamily(opts.userText ?? '');
  const min = opts.minStrength ?? 0.35;
  const limit = opts.limit ?? 4;
  const text = (opts.userText ?? '').toLowerCase();

  const scored = rules
    .map((r) => {
      let score = r.strength;
      if (r.intentFamily === family) score += 0.35;
      else if (r.intentFamily === 'general' || family === 'general') score += 0.1;
      else score -= 0.25;
      for (const tag of r.tags) {
        if (tag && text.includes(tag.toLowerCase())) score += 0.08;
      }
      return { r, score };
    })
    .filter((x) => x.score >= min && x.r.strength >= min)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((x) => x.r);
}

/** Nach erfolgreichem Inject: Hit zählen (fire-and-forget ok). */
export async function noteLearnedRulesMatched(rules: LearnedRule[]): Promise<void> {
  if (!rules.length) return;
  const store = useUserProfileStore.getState();
  const profile = getCachedUserProfile() ?? store.profile;
  if (!profile?.learnedRules?.length) return;
  const ids = new Set(rules.map((r) => r.id));
  const ts = nowIso();
  const next = profile.learnedRules.map((r) =>
    ids.has(r.id)
      ? {
          ...r,
          hitCount: (r.hitCount ?? 0) + 1,
          lastMatchedAt: ts,
          strength: clampStrength(r.strength + 0.02),
          updatedAt: ts,
        }
      : r,
  );
  await store.patchProfile({ learnedRules: next });
}

export function formatLearnedRulesPromptBlock(
  rules: LearnedRule[],
  opts?: { heading?: string },
): string {
  if (!rules.length) return '';
  const lines = [
    opts?.heading ?? '=== GELERNTE ANTWORT-REGELN (dieser User, Situation) ===',
    'Strukturelle Constraints aus früheren Korrekturen — Wortlaut frei, Doctrine beachten.',
    'Keine Scripts. Keine ortsspezifischen Hardcodes. Nur Aufbau/Priorität der Antwort.',
  ];
  for (const r of rules) {
    const exp = r.expect
      .map((e) => LEARNED_RULE_EXPECT_LABELS[e] ?? e)
      .join('; ');
    const av = r.avoid
      .map((a) => LEARNED_RULE_AVOID_LABELS[a] ?? a)
      .join('; ');
    lines.push(
      `- [${r.intentFamily}|s=${r.strength.toFixed(2)}] ${r.summary}` +
        (exp ? ` | erwarte: ${exp}` : '') +
        (av ? ` | vermeide: ${av}` : ''),
    );
  }
  return lines.join('\n');
}

/** Alle starken User-Rules für Master-Prompt (kurz). */
export function learnedRulesMasterPromptBlock(): string {
  const rules = getLearnedRules()
    .filter((r) => r.strength >= 0.4)
    .slice(0, 8);
  return formatLearnedRulesPromptBlock(rules, {
    heading: '=== GELERNTE ANTWORT-REGELN (User, dauerhaft) ===',
  });
}

function buildEffectiveQuestion(
  correctionText: string,
  lastUser: string | null,
): string {
  const c = correctionText.replace(/\s+/g, ' ').trim();
  const prior = (lastUser ?? '').replace(/\s+/g, ' ').trim();
  if (!prior) return c;
  // Korrektur an vorherige Frage koppeln — kein Script, nur Kontext
  if (c.length >= 24 && !/^(nee+|nein|nö+|falsch)\b/iu.test(c)) {
    return `${prior}\n(Korrektur vom User — so umsetzen: ${c})`;
  }
  return `${prior}\n(User-Korrektur: ${c})`;
}

/**
 * Haupt-Entry: Korrektur erkennen, Rule speichern, effectiveQuestion liefern.
 * Vor der Antwort-Pipeline aufrufen (nicht nur fire-and-forget).
 */
export async function runCorrectionLearningCapture(
  userText: string,
): Promise<CorrectionCaptureResult> {
  const empty: CorrectionCaptureResult = {
    isCorrection: false,
    rule: null,
    effectiveQuestion: null,
    replyHint: null,
  };
  const text = userText.replace(/\s+/g, ' ').trim();
  if (!looksLikeAnswerCorrection(text)) return empty;

  const ctx = getRecentTurnPair();
  let draft = extractCorrectionFast(text, ctx);
  if (!draft || (draft.expect.length + draft.avoid.length < 2 && text.length > 20)) {
    const llm = await extractCorrectionLlm(text, ctx);
    if (llm) draft = llm;
  }
  if (!draft) return empty;

  // Re-Korrektur kurz nach Match → stärker hochziehen
  const recentSame = getLearnedRules().find(
    (r) =>
      r.intentFamily === draft!.intentFamily &&
      r.lastMatchedAt &&
      Date.now() - Date.parse(r.lastMatchedAt) < 15 * 60 * 1000,
  );
  if (recentSame) {
    draft = {
      ...draft,
      strength: clampStrength(Math.max(draft.strength, recentSame.strength) + 0.2),
    };
  }

  const rule = await upsertLearnedRule(draft);

  try {
    const { enqueueBetaSituationFromRule } = await import('./betaSituationQueue');
    void enqueueBetaSituationFromRule({
      rule,
      correctionText: text,
      priorUserText: ctx.lastUser,
    }).catch(() => {});
  } catch {
    /* soft */
  }

  try {
    const { contributeErrorAvoidSignal } = await import('./collectiveLearning');
    void contributeErrorAvoidSignal({
      intentFamily: rule.intentFamily,
      avoid: rule.avoid,
      expect: rule.expect,
      summary: rule.summary || text.slice(0, 120),
    });
  } catch {
    /* soft */
  }

  try {
    const { recordLastAction } = await import('../feedback/telemetryBuffer');
    recordLastAction(
      `learned_rule:${rule.intentFamily}:${rule.expect.join('+') || 'fix'}`,
    );
  } catch {
    /* soft */
  }

  return {
    isCorrection: true,
    rule,
    effectiveQuestion: buildEffectiveQuestion(text, ctx.lastUser),
    replyHint: null,
  };
}

/** Sanitize rules from disk/cloud. */
export function normalizeLearnedRules(raw: unknown): LearnedRule[] {
  if (!Array.isArray(raw)) return [];
  const out: LearnedRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const summary = String(o.summary ?? '').trim();
    if (!summary && !Array.isArray(o.expect) && !Array.isArray(o.avoid)) continue;
    out.push({
      id: String(o.id ?? makeId()),
      scope: 'user',
      intentFamily: filterFamily(o.intentFamily),
      tags: uniqStrings(Array.isArray(o.tags) ? o.tags.map(String) : []).slice(0, 8),
      expect: filterExpect(o.expect),
      avoid: filterAvoid(o.avoid),
      summary: summary.slice(0, 200) || 'Antwortstruktur anpassen',
      strength: clampStrength(Number(o.strength) || 0.5),
      hitCount: Math.max(0, Math.floor(Number(o.hitCount) || 0)),
      createdAt: String(o.createdAt ?? nowIso()),
      updatedAt: String(o.updatedAt ?? nowIso()),
      lastMatchedAt:
        typeof o.lastMatchedAt === 'string' ? o.lastMatchedAt : undefined,
      evidenceDigest:
        typeof o.evidenceDigest === 'string'
          ? o.evidenceDigest.slice(0, 160)
          : undefined,
    });
  }
  return out.slice(0, MAX_LEARNED_RULES);
}

export function mergeLearnedRules(
  local: LearnedRule[],
  remote: LearnedRule[],
): LearnedRule[] {
  const byId = new Map<string, LearnedRule>();
  for (const r of remote) byId.set(r.id, r);
  for (const r of local) {
    const cur = byId.get(r.id);
    if (!cur) {
      byId.set(r.id, r);
      continue;
    }
    byId.set(
      r.id,
      (r.updatedAt || '') >= (cur.updatedAt || '')
        ? {
            ...r,
            strength: Math.max(r.strength, cur.strength),
            hitCount: Math.max(r.hitCount, cur.hitCount),
          }
        : {
            ...cur,
            strength: Math.max(r.strength, cur.strength),
            hitCount: Math.max(r.hitCount, cur.hitCount),
          },
    );
  }
  return [...byId.values()]
    .sort((a, b) => b.strength - a.strength || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_LEARNED_RULES);
}
