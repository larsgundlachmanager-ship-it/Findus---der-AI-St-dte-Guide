/**
 * Feature-Tips: Yorro erwähnt App-Potenzial höchstens einmal (abgehakt),
 * situativ und nie überladen — max. ein Tip pro Story.
 */

import * as FileSystem from 'expo-file-system';
import type { PoiWithFacts } from '../../db/types';
import type { PoiImportance } from '../../types/userProfile';

/** Einmalige Potenzial-Hinweise (verbal + Checkliste). */
export const FEATURE_TIP_IDS = [
  'ask_followups',
  'navigation',
  'voice_mic',
  'tune_profile',
  'session_memory',
  'visit_passport',
  'mute_museum',
  'plan_calendar',
  'settings_gear',
  'triggers',
  'live_delays',
  'planning_tool',
] as const;

export type FeatureTipId = (typeof FEATURE_TIP_IDS)[number];

export type FeatureTipState = {
  /** Legacy: bereits einmal verbal erwähnt. */
  spoken: FeatureTipId[];
  /** Wie oft der Tip theoretisch/konkret vorgeschlagen wurde. */
  suggestedCounts: Partial<Record<FeatureTipId, number>>;
  /** User hat das Feature verstanden oder benutzt. */
  completed: FeatureTipId[];
  /** Zeit-Pause (Legacy / lange Abwesenheit). */
  pausedUntilMs: Partial<Record<FeatureTipId, number>>;
  /**
   * Nach einem Vorschlag ohne Nutzung: nächste N Gelegenheiten überspringen,
   * dann wieder erinnern (Default 3 → 4. Chance).
   */
  skipRemaining: Partial<Record<FeatureTipId, number>>;
  /** User hat Navigation mindestens einmal gestartet. */
  hasUsedNavigation: boolean;
  /** Hands-free-Erklärung („nicht aufs Handy schauen“) schon gesagt. */
  handsFreeNavExplained: boolean;
  /**
   * Einmaliger Hinweis: langsamer werden / stehenbleiben → volle Geschichte.
   * Pro Install nur einmal.
   */
  interestPatternExplained: boolean;
};

/** Nach Vorschlag ohne Nutzung: so viele Chancen aussetzen. */
export const FEATURE_TIP_SKIP_AFTER_SUGGEST = 3;

const TIPS_PATH = `${FileSystem.documentDirectory}findus-feature-tips.json`;

const DEFAULT_STATE: FeatureTipState = {
  spoken: [],
  suggestedCounts: {},
  completed: [],
  pausedUntilMs: {},
  skipRemaining: {},
  hasUsedNavigation: false,
  handsFreeNavExplained: false,
  interestPatternExplained: false,
};

let cached: FeatureTipState | null = null;
let loadPromise: Promise<FeatureTipState> | null = null;

function normalizeState(raw: unknown): FeatureTipState {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<FeatureTipState>;
  const spoken = Array.isArray(obj.spoken)
    ? obj.spoken.filter((id): id is FeatureTipId =>
        (FEATURE_TIP_IDS as readonly string[]).includes(String(id)),
      )
    : [];
  const completed = Array.isArray(obj.completed)
    ? obj.completed.filter((id): id is FeatureTipId =>
        (FEATURE_TIP_IDS as readonly string[]).includes(String(id)),
      )
    : [];
  const suggestedCounts: Partial<Record<FeatureTipId, number>> = {};
  for (const id of FEATURE_TIP_IDS) {
    const value = obj.suggestedCounts?.[id];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      suggestedCounts[id] = Math.max(0, Math.round(value));
    }
  }
  const pausedUntilMs: Partial<Record<FeatureTipId, number>> = {};
  for (const id of FEATURE_TIP_IDS) {
    const value = obj.pausedUntilMs?.[id];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      pausedUntilMs[id] = value;
    }
  }
  const skipRemaining: Partial<Record<FeatureTipId, number>> = {};
  for (const id of FEATURE_TIP_IDS) {
    const value = (obj as { skipRemaining?: Partial<Record<FeatureTipId, number>> })
      .skipRemaining?.[id];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      skipRemaining[id] = Math.max(0, Math.round(value));
    }
  }
  return {
    spoken: [...new Set(spoken)],
    suggestedCounts,
    completed: [...new Set(completed)],
    pausedUntilMs,
    skipRemaining,
    hasUsedNavigation: Boolean(obj.hasUsedNavigation),
    handsFreeNavExplained: Boolean(obj.handsFreeNavExplained),
    interestPatternExplained: Boolean(obj.interestPatternExplained),
  };
}

export async function loadFeatureTipState(): Promise<FeatureTipState> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(TIPS_PATH);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(TIPS_PATH);
        cached = normalizeState(JSON.parse(raw));
      } else {
        cached = { ...DEFAULT_STATE, spoken: [] };
      }
    } catch {
      cached = { ...DEFAULT_STATE, spoken: [] };
    }
    return cached!;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function getCachedFeatureTipState(): FeatureTipState {
  return cached ?? { ...DEFAULT_STATE, spoken: [] };
}

/** Cloud-Restore: Union von spoken/completed + OR für Flags. */
export async function applyFeatureTipStateFromCloud(
  remote: Partial<FeatureTipState> | null | undefined,
): Promise<void> {
  if (!remote || typeof remote !== 'object') return;
  const local = await loadFeatureTipState();
  const normalized = normalizeState(remote);
  const spoken = [...new Set([...local.spoken, ...normalized.spoken])];
  const completed = [...new Set([...local.completed, ...normalized.completed])];
  const suggestedCounts = { ...local.suggestedCounts };
  for (const [k, v] of Object.entries(normalized.suggestedCounts)) {
    const id = k as FeatureTipId;
    suggestedCounts[id] = Math.max(suggestedCounts[id] ?? 0, v ?? 0);
  }
  await persist({
    ...local,
    ...normalized,
    spoken,
    completed,
    suggestedCounts,
    hasUsedNavigation: local.hasUsedNavigation || normalized.hasUsedNavigation,
    handsFreeNavExplained:
      local.handsFreeNavExplained || normalized.handsFreeNavExplained,
    interestPatternExplained:
      local.interestPatternExplained || normalized.interestPatternExplained,
  });
}

async function persist(state: FeatureTipState): Promise<void> {
  cached = state;
  try {
    await FileSystem.writeAsStringAsync(TIPS_PATH, JSON.stringify(state));
  } catch (err) {
    console.warn('[featureTips] persist failed:', err);
  }
}

export async function markFeatureTipSpoken(
  id: FeatureTipId,
): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.completed.includes(id)) return;
  const spoken = state.spoken.includes(id)
    ? state.spoken
    : [...state.spoken, id];
  const nextCount = (state.suggestedCounts[id] ?? 0) + 1;
  await persist({
    ...state,
    spoken,
    suggestedCounts: { ...state.suggestedCounts, [id]: nextCount },
    skipRemaining: {
      ...state.skipRemaining,
      [id]: FEATURE_TIP_SKIP_AFTER_SUGGEST,
    },
    pausedUntilMs: { ...state.pausedUntilMs, [id]: 0 },
  });
}

/**
 * Tip wäre dran, aber Skip-Chance offen → eine Chance verbrauchen
 * (3× Pause → beim 4. Mal wieder erinnern).
 */
export async function consumeFeatureTipSkipOpportunity(
  id: FeatureTipId,
): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.completed.includes(id)) return;
  const left = state.skipRemaining[id] ?? 0;
  if (left <= 0) return;
  await persist({
    ...state,
    skipRemaining: { ...state.skipRemaining, [id]: left - 1 },
  });
}

export async function markNavigationUsed(): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.hasUsedNavigation && state.completed.includes('navigation')) return;
  await persist({
    ...state,
    hasUsedNavigation: true,
    completed: state.completed.includes('navigation')
      ? state.completed
      : [...state.completed, 'navigation'],
    skipRemaining: { ...state.skipRemaining, navigation: 0 },
  });
}

export async function markFeatureTipCompleted(
  id: FeatureTipId,
): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.completed.includes(id)) return;
  await persist({
    ...state,
    completed: [...state.completed, id],
    pausedUntilMs: { ...state.pausedUntilMs, [id]: 0 },
    suggestedCounts: { ...state.suggestedCounts, [id]: 0 },
    skipRemaining: { ...state.skipRemaining, [id]: 0 },
  });
}

export function hasCompletedFeatureTip(
  id: FeatureTipId,
  state?: FeatureTipState,
): boolean {
  const s = state ?? getCachedFeatureTipState();
  return s.completed.includes(id);
}

export function canSuggestFeatureTip(
  id: FeatureTipId,
  state?: FeatureTipState,
): boolean {
  const s = state ?? getCachedFeatureTipState();
  if (s.completed.includes(id)) return false;
  const pausedUntil = s.pausedUntilMs[id] ?? 0;
  if (pausedUntil > Date.now()) return false;
  const skip = s.skipRemaining[id] ?? 0;
  return skip <= 0;
}

/** Hands-free-Nav-Erklärung nur einmal. */
export async function shouldExplainHandsFreeNav(): Promise<boolean> {
  const state = await loadFeatureTipState();
  return !state.handsFreeNavExplained;
}

export async function markHandsFreeNavExplained(): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.handsFreeNavExplained) return;
  await persist({ ...state, handsFreeNavExplained: true });
}

/** Interest-Pattern-Onboarding nur einmal pro Install. */
export async function shouldExplainInterestPattern(): Promise<boolean> {
  const state = await loadFeatureTipState();
  return !state.interestPatternExplained;
}

export async function markInterestPatternExplained(): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.interestPatternExplained) return;
  await persist({ ...state, interestPatternExplained: true });
}

export function hasSpokenFeatureTip(
  id: FeatureTipId,
  state?: FeatureTipState,
): boolean {
  const s = state ?? getCachedFeatureTipState();
  return s.spoken.includes(id) || s.completed.includes(id);
}

/** Kurztexte für den Master-Prompt — Yorro formuliert selbst, knackig. */
export const FEATURE_TIP_PROMPT: Record<FeatureTipId, string> = {
  ask_followups:
    'Rückfragen: Einmal beiläufig, dass man dich zu Details fragen kann — ohne „Soll ich…?“ und ohne Druck. Kein App-Handbuch.',
  navigation:
    'Navigation: Einmal knapp, dass du zu Orten führen kannst — z. B. „Ich kann dich auch hin navigieren, teste es einfach.“ Kein Spam.',
  voice_mic:
    'Mikrofon: Einmal klar die vier Gesten — halten = sofort zuhören; kurz tippen = Tippfeld; während Halten nach rechts = Feststelltaste (Mikro bleibt an); nach links = Live-Chat. Kein Handbuch, ein Halbsatz reicht.',
  tune_profile:
    'Profil: Einmal, dass Interessen in den Einstellungen Yorro persönlicher machen — ein Halbsatz reicht.',
  session_memory:
    'Gedächtnis: Einmal, dass du dir merkst, was ihr schon gesehen habt / was ihn interessiert.',
  visit_passport:
    'Orte: Einmal, dass unten Orte Legende und Suche sind — und oben der Erkundungs-Zähler.',
  mute_museum:
    'Museum/Indoor: Einmal erklären, dass man Yorro stumm schalten kann — Wake nach 1 Std., 2 Std., Uhrzeit oder 100/200 m Geofence. Kein „Wegweiser“ sagen.',
  plan_calendar:
    'Kalender: Einmal, dass oben rechts der Plan-/Tageskalender steckt — Tippen öffnet die Timeline.',
  settings_gear:
    'Einstellungen: Einmal, dass unten rechts unter Einst. Profil, Audio und Erklärungen liegen.',
  triggers:
    'Trigger: Einmal, dass Leave-by/Erinnerungen unter Einstellungen → Meine Trigger liegen und automatisch mit dem Plan laufen.',
  live_delays:
    'ÖPNV: Einmal, dass du Live-Verspätungen ansagen kannst — kurz vormachen, dann still.',
  planning_tool:
    'Planung: Einmal, dass du Tagespläne mit Auswahl-Buttons in der Timeline baust — tippen zum Bestätigen.',
};

export type FeatureTipPlan = {
  /** Höchstens ein einmaliger Tip (oder null). */
  tip: FeatureTipId | null;
  /** Situativ: Ort hat mehr Stoff als in die Kurzstory passt. */
  surplusExampleQuestion: string | null;
  /** Navigation erneut nur bei Sub in großem Kontext + nie genutzt. */
  allowNavReminder: boolean;
};

function countUsefulFacts(poi: PoiWithFacts): number {
  return poi.facts.filter((f) => {
    const t = (f.fact_text ?? '').trim();
    if (t.length < 24) return false;
    if (/^\[(Teaser|Meta|Internal)/i.test(t)) return false;
    return true;
  }).length;
}

/** Beispiel-Rückfrage aus Ort-Metadaten — konkret, schema-basiert (kein POI-Hardcoding). */
export function buildSurplusExampleQuestion(poi: PoiWithFacts): string {
  const name = poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
  const short = name.length > 28 ? `${name.slice(0, 26).trim()}…` : name;
  const category = (poi.category ?? '').toLowerCase();
  let tags = '';
  try {
    const raw = poi.tags_json;
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        tags = parsed.map(String).join(' ').toLowerCase();
      }
    }
  } catch {
    /* ignore */
  }
  const blob = `${category} ${tags} ${name}`.toLowerCase();

  if (/restaurant|gastro|cafe|café|food|essen|imbiss|bäckerei|baeckerei/.test(blob)) {
    return `Was macht ${short} kulinarisch besonders?`;
  }
  if (/denkmal|memorial|ehren|gedenk|monument/.test(blob)) {
    return `Wen oder was erinnert ${short}?`;
  }
  if (/bahnhof|haltestelle|hafen|fähre|faehre|transport|station/.test(blob)) {
    return `Was ist die Geschichte von ${short}?`;
  }
  if (/kirche|kapelle|dom|synagoge|moschee|gotteshaus|worship|place_of_worship/.test(blob)) {
    return `Was ist an ${short} besonders?`;
  }
  if (/brücke|bruecke|tunnel|viadukt/.test(blob)) {
    return `Warum ist ${short} hier wichtig?`;
  }
  if (/hof|gut|farm|landwirt|bauernhof/.test(blob)) {
    return `Was passiert heute noch bei ${short}?`;
  }
  if (/museum|galerie|ausstellung|kunst/.test(blob)) {
    return `Was ist das Highlight in ${short}?`;
  }
  if (/hotel|pension|unterkunft|hostel/.test(blob)) {
    return `Was sollte man über ${short} wissen?`;
  }
  if (/park|garten|natur|aussicht|viewpoint/.test(blob)) {
    return `Was macht ${short} als Ort besonders?`;
  }
  return `Was steckt noch hinter ${short}?`;
}

export function poiHasSurplusFacts(poi: PoiWithFacts): boolean {
  return countUsefulFacts(poi) >= 6;
}

/**
 * Wählt höchstens EINEN Tip für diese Story.
 * Priorität: situativer Mehrwert > einmalige Entdeckung, nie nerven.
 */
export function planFeatureTips(input: {
  poi: PoiWithFacts;
  importance: PoiImportance;
  isFirstPoi: boolean;
  kind?: string | null;
  parentIsMajor?: boolean;
  state?: FeatureTipState;
}): FeatureTipPlan {
  const state = input.state ?? getCachedFeatureTipState();
  const spoken = new Set(state.spoken);
  const completed = new Set(state.completed);

  const surplus = poiHasSurplusFacts(input.poi);
  const surplusExampleQuestion = surplus
    ? buildSurplusExampleQuestion(input.poi)
    : null;

  const isSubInMajor =
    (input.kind === 'sub' || input.importance === 'minor') &&
    Boolean(input.parentIsMajor);

  const allowNavReminder =
    (spoken.has('navigation') || completed.has('navigation')) &&
    !state.hasUsedNavigation &&
    !completed.has('navigation') &&
    isSubInMajor;

  // Schon alles gesagt und kein Surplus/Reminder → still
  let tip: FeatureTipId | null = null;

  // Reihenfolge: erst Nützliches in der Situation, dann Tour-Start-Basics
  const candidates: FeatureTipId[] = [];
  if (surplus && !spoken.has('ask_followups')) {
    candidates.push('ask_followups');
  }
  if (
    (input.importance === 'major' || input.isFirstPoi) &&
    !spoken.has('navigation') &&
    !completed.has('navigation')
  ) {
    candidates.push('navigation');
  }
  if (
    input.isFirstPoi &&
    !spoken.has('ask_followups') &&
    !completed.has('ask_followups')
  ) {
    candidates.push('ask_followups');
  }
  if (!spoken.has('voice_mic') && !completed.has('voice_mic')) {
    candidates.push('voice_mic');
  }
  if (
    !spoken.has('session_memory') &&
    !completed.has('session_memory') &&
    !input.isFirstPoi
  ) {
    candidates.push('session_memory');
  }
  if (!spoken.has('tune_profile') && !completed.has('tune_profile')) {
    candidates.push('tune_profile');
  }
  if (
    !spoken.has('visit_passport') &&
    !completed.has('visit_passport') &&
    !input.isFirstPoi
  ) {
    candidates.push('visit_passport');
  }
  if (!spoken.has('plan_calendar') && !completed.has('plan_calendar')) {
    candidates.push('plan_calendar');
  }
  if (!spoken.has('settings_gear') && !completed.has('settings_gear')) {
    candidates.push('settings_gear');
  }
  if (!spoken.has('planning_tool') && !completed.has('planning_tool')) {
    candidates.push('planning_tool');
  }
  if (!spoken.has('triggers') && !completed.has('triggers')) {
    candidates.push('triggers');
  }
  if (!spoken.has('live_delays') && !completed.has('live_delays')) {
    candidates.push('live_delays');
  }

  // Museum/Indoor: Mute-Tipp priorisieren
  const poiBlob = `${input.poi.category ?? ''} ${input.poi.name}`.toLowerCase();
  if (
    /museum|galerie|ausstellung|kirche|dom/.test(poiBlob) &&
    !spoken.has('mute_museum') &&
    !completed.has('mute_museum')
  ) {
    candidates.unshift('mute_museum');
  }

  tip = null;
  for (const id of candidates) {
    if (spoken.has(id) || completed.has(id)) continue;
    if ((state.pausedUntilMs[id] ?? 0) > Date.now()) continue;
    const skip = state.skipRemaining[id] ?? 0;
    if (skip > 0) {
      // Top-Kandidat hat noch Pause-Chancen → eine verbrauchen, diesmal still
      void consumeFeatureTipSkipOpportunity(id);
      break;
    }
    tip = id;
    break;
  }

  // Surplus belegt den einen Hinweis-Slot (Beispiel-Frage) — kein paralleler Meta-Tip
  if (surplus) {
    tip = null;
  }

  // Erster Ort ohne Surplus: höchstens ask_followups oder navigation
  if (
    input.isFirstPoi &&
    tip &&
    tip !== 'ask_followups' &&
    tip !== 'navigation'
  ) {
    tip = !spoken.has('ask_followups')
      ? 'ask_followups'
      : !spoken.has('navigation')
        ? 'navigation'
        : null;
  }

  return {
    tip,
    surplusExampleQuestion,
    allowNavReminder,
  };
}

/** Prompt-Block für Master-Instruction — kurz halten. */
export function formatFeatureTipsForPrompt(plan: FeatureTipPlan): string {
  const lines: string[] = [
    '=== APP-POTENZIAL (SEHR DOSIERT, NICHT NERVEN) ===',
    '- Erkläre die App NICHT übertrieben. Kein Handbuch, keine Feature-Liste.',
    '- Höchstens EIN kurzer Hinweis in dieser Story — oder gar keiner.',
  ];

  if (plan.tip) {
    lines.push(
      `- Einmaliger Hinweis (noch nie gesagt, danach abgehakt): ${FEATURE_TIP_PROMPT[plan.tip]}`,
    );
  } else {
    lines.push('- Kein neuer einmaliger App-Hinweis in dieser Story.');
  }

  if (hasSpokenFeatureTip('ask_followups')) {
    lines.push(
      '- Rückfragen-Tipp wurde schon gesagt → NICHT nochmal erklären, dass man dich fragen kann (außer unten Surplus).',
    );
  }

  if (hasSpokenFeatureTip('navigation') && !plan.allowNavReminder) {
    lines.push(
      '- Navigation-Tipp wurde schon gesagt → NICHT nochmal erwähnen, dass du navigieren kannst.',
    );
  }

  if (plan.allowNavReminder) {
    lines.push(
      '- Ausnahme Navigation: Kleiner Punkt in größerem Kontext, User hat Navigation noch nie genutzt → höchstens ein Halbsatz („Soll ich dich kurz hinbugsieren?“).',
    );
  }

  if (plan.surplusExampleQuestion) {
    lines.push(
      `- Dieser Ort hat MEHR Stoff: NICHT als Abschlussfrage vorlesen. Höchstens ein Halbsatz ohne Frage („dazu gibt’s noch mehr Geschichte“) — die Beispiel-Frage „${plan.surplusExampleQuestion}“ ist nur intern, nie aussprechen.`,
    );
  }

  lines.push(
    '- Wenn Surplus-Hinweis und einmaliger Tip kollidieren: Surplus-Beispiel-Frage hat Vorrang, Tip weglassen.',
  );

  return lines.join('\n');
}

/** Tip aus Story-Text erkennen und abhaken (heuristisch). */
export function detectSpokenTipsInText(text: string): FeatureTipId[] {
  const t = text.toLowerCase();
  const found: FeatureTipId[] = [];
  if (
    /frag mich|löcher in den bauch|rückfrage|mehr wissen willst|wenn du dich fragst/.test(
      t,
    )
  ) {
    found.push('ask_followups');
  }
  if (
    /navigier|ich führ dich|ich bring dich hin|kompass|hinbugsieren|weg weisen/.test(
      t,
    )
  ) {
    found.push('navigation');
  }
  if (/mikro|mic |ansprechen kannst|unterbrechen/.test(t)) {
    found.push('voice_mic');
  }
  if (/einstellung|profil|interessen anpass/.test(t)) {
    found.push('tune_profile');
  }
  if (/merk mir|gemerkt|schon gesehen|vorhin/.test(t)) {
    found.push('session_memory');
  }
  if (/stumm|mute|aufwach|geofence|100\s*m|200\s*m/.test(t)) {
    found.push('mute_museum');
  }
  if (/pass|stempel|besuchte orte|tour-pass/.test(t)) {
    found.push('visit_passport');
  }
  return found;
}
