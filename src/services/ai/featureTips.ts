/**
 * Feature-Tips: Findus erwähnt App-Potenzial höchstens einmal (abgehakt),
 * situativ und nie überladen — max. ein Tip pro Story.
 */

import * as FileSystem from 'expo-file-system';
import type { PoiWithFacts } from '../../db/types';
import type { PoiImportance } from '../../types/userProfile';

/** Die 6 einmaligen Potenzial-Hinweise. */
export const FEATURE_TIP_IDS = [
  'ask_followups',
  'navigation',
  'voice_mic',
  'tune_profile',
  'session_memory',
  'visit_passport',
] as const;

export type FeatureTipId = (typeof FEATURE_TIP_IDS)[number];

export type FeatureTipState = {
  spoken: FeatureTipId[];
  /** User hat Navigation mindestens einmal gestartet. */
  hasUsedNavigation: boolean;
  /** Hands-free-Erklärung („nicht aufs Handy schauen“) schon gesagt. */
  handsFreeNavExplained: boolean;
};

const TIPS_PATH = `${FileSystem.documentDirectory}findus-feature-tips.json`;

const DEFAULT_STATE: FeatureTipState = {
  spoken: [],
  hasUsedNavigation: false,
  handsFreeNavExplained: false,
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
  return {
    spoken: [...new Set(spoken)],
    hasUsedNavigation: Boolean(obj.hasUsedNavigation),
    handsFreeNavExplained: Boolean(obj.handsFreeNavExplained),
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
  if (state.spoken.includes(id)) return;
  await persist({ ...state, spoken: [...state.spoken, id] });
}

export async function markNavigationUsed(): Promise<void> {
  const state = await loadFeatureTipState();
  if (state.hasUsedNavigation) return;
  await persist({ ...state, hasUsedNavigation: true });
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

export function hasSpokenFeatureTip(
  id: FeatureTipId,
  state?: FeatureTipState,
): boolean {
  const s = state ?? getCachedFeatureTipState();
  return s.spoken.includes(id);
}

/** Kurztexte für den Master-Prompt — Findus formuliert selbst, knackig. */
export const FEATURE_TIP_PROMPT: Record<FeatureTipId, string> = {
  ask_followups:
    'Rückfragen: Einmal beiläufig, dass man dich zu Details fragen kann — ohne „Soll ich…?“ und ohne Druck. Kein App-Handbuch.',
  navigation:
    'Navigation: Einmal knapp, dass du zu Orten führen kannst — Aussage, keine Rückfrage-Spam.',
  voice_mic:
    'Mikrofon: Einmal, dass man dich jederzeit per Mic ansprechen / unterbrechen kann.',
  tune_profile:
    'Profil: Einmal, dass Interessen in den Einstellungen Findus persönlicher machen — ein Halbsatz reicht.',
  session_memory:
    'Gedächtnis: Einmal, dass du dir merkst, was ihr schon gesehen habt / was ihn interessiert.',
  visit_passport:
    'Stempel/Pass: Einmal, dass besuchte Orte im Tour-Pass landen — spielerisch, nicht werblich.',
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

/** Beispiel-Rückfrage aus Ort-Daten — konkret, nicht generisch. */
export function buildSurplusExampleQuestion(poi: PoiWithFacts): string {
  const name = poi.name
    .replace(/\s*[·•|]\s*Wegweiser\s*$/i, '')
    .trim();
  const blob = [
    poi.category ?? '',
    ...(poi.facts ?? []).slice(0, 8).map((f) => f.fact_text ?? ''),
  ]
    .join(' ')
    .toLowerCase();

  if (/schnickenfeld/i.test(name)) {
    return `Was hat es mit dem Namen Schnickenfeld auf sich?`;
  }
  if (/friseur|coiffeur|haar/.test(blob)) {
    return `Was macht diesen Salon besonders?`;
  }
  if (/denkmal|ehrenmal|krieg/.test(blob)) {
    return `Wer wird hier eigentlich genau geehrt?`;
  }
  if (/bahnhof|wartehäus/.test(blob)) {
    return `Seit wann gibt’s den Bahnhof hier überhaupt?`;
  }
  if (/kirche|kapelle/.test(blob)) {
    return `Was ist das Besondere an dieser Kirche?`;
  }
  if (/hof|gut|bauern/.test(blob)) {
    return `Was wird hier heute noch gemacht?`;
  }
  if (/brücke/.test(blob)) {
    return `Warum heißt die Brücke so?`;
  }
  const short = name.length > 28 ? name.slice(0, 26) + '…' : name;
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

  const surplus = poiHasSurplusFacts(input.poi);
  const surplusExampleQuestion = surplus
    ? buildSurplusExampleQuestion(input.poi)
    : null;

  const isSubInMajor =
    (input.kind === 'sub' || input.importance === 'minor') &&
    Boolean(input.parentIsMajor);

  const allowNavReminder =
    spoken.has('navigation') &&
    !state.hasUsedNavigation &&
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
    !spoken.has('navigation')
  ) {
    candidates.push('navigation');
  }
  if (input.isFirstPoi && !spoken.has('ask_followups')) {
    candidates.push('ask_followups');
  }
  if (!spoken.has('voice_mic')) candidates.push('voice_mic');
  if (!spoken.has('session_memory') && !input.isFirstPoi) {
    candidates.push('session_memory');
  }
  if (!spoken.has('tune_profile')) candidates.push('tune_profile');
  if (!spoken.has('visit_passport') && !input.isFirstPoi) {
    candidates.push('visit_passport');
  }

  tip = candidates.find((id) => !spoken.has(id)) ?? null;

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
      `- Dieser Ort hat MEHR Stoff als in die Kurzstory passt: Einmal beiläufig sagen, dass es noch mehr gibt, und GENAU DIESE Beispiel-Frage nennen: „${plan.surplusExampleQuestion}“ — dann EIN Outro.`,
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
  if (/pass|stempel|besuchte orte|tour-pass/.test(t)) {
    found.push('visit_passport');
  }
  return found;
}
