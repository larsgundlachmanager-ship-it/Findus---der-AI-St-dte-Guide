/**
 * Modul 5 — Agent-Chat-History + strukturierte Folgeturns (Edits/Clarify).
 */

import { generateGeminiText, type GeminiChatTurn } from '../../services/geminiService';
import {
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_FEW_SHOT_DISCLAIMER,
  FINDUS_HELP_FIRST_MONETIZATION_BLOCK,
  FINDUS_LIVE_CHAT_HUMAN_BLOCK,
} from '../../services/concierge/findusResponsePolicy';
import { todayDateKey } from '../../utils/dateKeys';
import { readRucksackSync } from '../rucksack/rucksackStore';
import { useFuturePlanStore } from '../timeline/futurePlanState';
import { prefsBlockForPrompt } from './planTripPrefs';
import { executePlanAgentTools, type PlanAgentToolCall } from './planAgentTools';
import { isLiveChatActive } from '../../services/handsFree/liveChatSession';
import { FINDUS_PLAN_SMART_OVERVIEW_BLOCK } from './planSmartOverview';
import { planBaseSynonymPromptBlock } from './planBaseSynonyms';
import { usePlanCalendarUiStore } from '../timeline/planCalendarUiStore';

export type PlanAgentNextWait =
  | 'confirm'
  | 'location'
  | 'clarify'
  | 'pick'
  | 'none'
  | 'done';

export type PlanAgentTurnResult = {
  speech: string;
  nextWait: PlanAgentNextWait;
  toolCalls: PlanAgentToolCall[];
};

const PLAN_AGENT_SYSTEM = `Du bist der Yorro-Planungsassistent für konkrete Tage.
Du führst EINEN durchgängigen Chat. Code führt Tools aus — keine Orte/Zeiten ohne Tool erfinden.

${FINDUS_DYNAMIC_STRUCTURE_DOCTRINE}
${FINDUS_LIVE_CHAT_HUMAN_BLOCK}
${FINDUS_HELP_FIRST_MONETIZATION_BLOCK}
${FINDUS_PLAN_SMART_OVERVIEW_BLOCK}
${FINDUS_FEW_SHOT_DISCLAIMER}

CHECKLISTE: Fixes→Confirm→Pitch→Tour→Final.
TITEL kurz und klar (Absicht, kein GmbH).
Bei Löschen/Verschieben: Reservierung/Ticket als Nebenwirkung erwähnen wenn am Stop reserveUrl/ticketRef.
Bei Zeitkonflikt: Halt nennen + 2–3 Lösungen, dann resolve_conflict Tool.
TAG: Immer das dayKey aus dem Prompt nutzen — NIE still auf HEUTE springen, außer User sagt klar „heute“.
ZEIT-EDIT: „von 14 auf 16“ / „Turnier auf 16 Uhr“ → move_stop mit newTimeHm auf DIESEM Tag.
FOKUS: Wenn FOCUSED_STOP gesetzt ist, bezieht sich „das/den Termin/hier“ darauf.
KEINE Bridge / kein Meta-Vorgeplänkel — nur die kurze Ergebnis-Speech nach dem Tool.
Wenn Planungsmodus aktiv und User nur den Tag plant: du sprichst — Modul 2 bleibt still.

ANTWORT NUR JSON:
{
  "speech": "kurz, mündlich",
  "toolCalls": [{ "name": "…", "args": {} }],
  "nextWait": "confirm"|"location"|"clarify"|"pick"|"none"|"done",
  "rememberPrefs": [{ "key":"…", "value":"…" }]
}

TOOLS: remove_stop|move_stop|replace_stop|clear_soft_day|resolve_conflict|set_leg_transport|start_navigation|flag_reservation_side_effect|ask_clarify|merge_or_split|remember_pref|propose_actions|fill_tour_gaps|upsert_hint
Immer dayKey in Args wenn Tag betroffen.`;

let chatHistory: GeminiChatTurn[] = [];
let sessionDayKeys: string[] = [];

export function resetPlanAgentChat(dayKey?: string): void {
  chatHistory = [];
  sessionDayKeys = dayKey ? [dayKey] : [];
}

export function appendPlanAgentHistory(turns: GeminiChatTurn[]): void {
  chatHistory.push(...turns);
  // Cap history (cost)
  if (chatHistory.length > 24) {
    chatHistory = chatHistory.slice(-24);
  }
}

export function getPlanAgentHistory(): GeminiChatTurn[] {
  return [...chatHistory];
}

function snapshotTimeline(dayKey: string): string {
  const plan = useFuturePlanStore.getState().getPlanForDay(dayKey);
  const lines = plan.stops.slice(0, 40).map((s) => {
    const t =
      s.plannedStartMs != null
        ? new Date(s.plannedStartMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—';
    return `- ${s.id} | ${t} | ${s.title} | ${s.kind ?? 'stop'} | prio=${s.planPriority ?? '-'} | transport=${s.transport}${s.reserveUrl ? ' | RESERVE' : ''}${s.ticketRef ? ' | TICKET' : ''}`;
  });
  return lines.length
    ? `TIMELINE ${dayKey}:\n${lines.join('\n')}`
    : `TIMELINE ${dayKey}: leer`;
}

function parseAgentJson(raw: string): Record<string, unknown> | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Folgeturn: Änderung, Konflikt, Clarify-Antwort — immer Flash (Geld).
 */
export async function runPlanAgentFollowUp(input: {
  userText: string;
  dayKey?: string | null;
  event?: string;
  signal?: AbortSignal;
}): Promise<PlanAgentTurnResult> {
  const dayKey =
    input.dayKey?.trim() ||
    useFuturePlanStore.getState().plan.dayKey ||
    todayDateKey();
  if (!sessionDayKeys.includes(dayKey)) sessionDayKeys.push(dayKey);

  const bag = readRucksackSync();
  const focusedStopId =
    usePlanCalendarUiStore.getState().focusedStopId?.trim() || null;
  const focusedLine = focusedStopId
    ? `FOCUSED_STOP: ${focusedStopId} (User sieht/wählt diesen Eintrag — „das/hier“ bezieht sich darauf)`
    : 'FOCUSED_STOP: keiner';
  const userPrompt = [
    `EVENT: ${input.event ?? 'user_reply'}`,
    `JETZT: ${new Date().toISOString()}`,
    `HEUTE: ${todayDateKey()}`,
    `STADT: ${bag.cityHint || 'unbekannt'}`,
    `LIVE_CHAT: ${isLiveChatActive() ? 'an' : 'aus'}`,
    `BEKANNTE_PREFS: ${prefsBlockForPrompt()}`,
    planBaseSynonymPromptBlock(),
    focusedLine,
    `TAGE_IN_SESSION: ${sessionDayKeys.join(', ')}`,
    snapshotTimeline(dayKey),
    `USER: ${(input.userText ?? '').trim()}`,
    'Setze den Plan fort oder wende die Änderung an. Kurz sprechen.',
  ].join('\n');

  let speech = '';
  let nextWait: PlanAgentNextWait = 'none';
  let toolCalls: PlanAgentToolCall[] = [];

  try {
    const raw = await generateGeminiText(userPrompt, {
      systemInstruction: PLAN_AGENT_SYSTEM,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      temperature: 0.35,
      maxTokens: 2048,
      task: 'itinerary',
      tier: 'lite',
      chatHistory,
      signal: input.signal,
    });
    const parsed = parseAgentJson(raw);
    speech = String(parsed?.speech ?? '').trim();
    const nw = String(parsed?.nextWait ?? 'none');
    if (
      nw === 'confirm' ||
      nw === 'location' ||
      nw === 'clarify' ||
      nw === 'pick' ||
      nw === 'done' ||
      nw === 'none'
    ) {
      nextWait = nw;
    }
    if (Array.isArray(parsed?.toolCalls)) {
      toolCalls = parsed!.toolCalls!
        .map((c) => {
          if (!c || typeof c !== 'object') return null;
          const o = c as Record<string, unknown>;
          const name = String(o.name ?? '').trim();
          if (!name) return null;
          return {
            name,
            args:
              o.args && typeof o.args === 'object'
                ? (o.args as Record<string, unknown>)
                : {},
          };
        })
        .filter(Boolean) as PlanAgentToolCall[];
    }
    appendPlanAgentHistory([
      { role: 'user', parts: [{ text: userPrompt }] },
      { role: 'model', parts: [{ text: raw || speech || '{}' }] },
    ]);
  } catch (err) {
    console.warn('[planAgent] follow-up failed', err);
    speech = 'Kurz hängen geblieben — sag die Änderung noch einmal.';
  }

  const toolSpeech = await executePlanAgentTools(toolCalls, dayKey);
  if (toolSpeech && !speech) speech = toolSpeech;

  return { speech, nextWait, toolCalls };
}

/** Seed history after first ingest (kein zweiter teurer Call). */
export function seedPlanAgentAfterIngest(userText: string, bridge: string): void {
  appendPlanAgentHistory([
    {
      role: 'user',
      parts: [{ text: `USER_ROHTEXT:\n${userText}` }],
    },
    {
      role: 'model',
      parts: [
        {
          text: JSON.stringify({
            speech: bridge || 'Plan steht grob — wir gehen Punkt für Punkt.',
            toolCalls: [],
            nextWait: 'confirm',
          }),
        },
      ],
    },
  ]);
}
