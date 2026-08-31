/**
 * Law & Action-Button Judge — nach Pass-2, VOR Speech-Guardrails.
 *
 * 1) Action-Button-Richter (Code): Validity / Functional / Context
 * 2) Law-Judge (optional LLM): Verfassung + Kontext-Gesetze → Speech/JSON repair
 * 3) Telemetrie: jeder Lauf → telemetry_10min (judge_passes)
 *
 * Wendet KEINE Speech-Guardrails an — die kommen erst danach in der Pipeline.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { parseConciergeResponse } from '../concierge/parseConciergeResponse';
import type { GeminiConciergeResponse } from '../../types/concierge';
import type { FindusLaw } from './findusLawRegistry';
import {
  applyActionButtonJudge,
  type ActionJudgeNote,
} from './actionButtonJudge';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import { recordJudgePass } from '../feedback/telemetryBuffer';
import type {
  JudgeOutputSnapshot,
  QuickActionLite,
} from '../../types/feedback';

function extractJsonObject(raw: string): unknown | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toJudgeSnapshot(
  response: GeminiConciergeResponse,
): JudgeOutputSnapshot {
  return {
    speechText: response.speechText ?? '',
    cardTitle: response.cardTitle,
    visualBullets: [...(response.visualBullets ?? [])],
    quickActions: (response.quickActions ?? []).map(
      (a): QuickActionLite => ({
        type: a.type,
        label: a.label,
        payload: { ...a.payload },
      }),
    ),
  };
}

/** Map Action-Button-Richter reasons → stabile Law-IDs für Telemetrie. */
function correctionIdFromButtonNote(note: ActionJudgeNote): string | null {
  if (note.action === 'kept') return null;
  switch (note.reason) {
    case 'nav_empty_payload':
    case 'dial_empty_phone':
    case 'dial_invalid_phone':
    case 'url_missing_or_invalid':
    case 'show_more_empty_prompt':
    case 'gyg_empty_slug':
    case 'uber_empty_dest':
    case 'stay22_empty_destination':
    case 'reservation_no_target':
    case 'shopping_no_task_id':
    case 'reminder_empty_when':
    case 'invalid_object':
    case 'invalid_type':
      return 'LAW_BAD_BUTTON_PAYLOAD';
    case 'nav_context_knowledge_only':
      return 'LAW_NAV_WITHOUT_INTENT';
    case 'normalized_label_or_payload':
      return 'LAW_BUTTON_NORMALIZED';
    default:
      return `LAW_BUTTON_${note.reason}`.toUpperCase();
  }
}

function inferSpeechLawCorrections(
  before: GeminiConciergeResponse,
  after: GeminiConciergeResponse,
): string[] {
  const ids: string[] = [];
  const b = before.speechText ?? '';
  const a = after.speechText ?? '';
  if (b === a && before.quickActions?.length === after.quickActions?.length) {
    return ids;
  }

  if (/https?:\/\/|www\./i.test(b) && !/https?:\/\/|www\./i.test(a)) {
    ids.push('LAW_NO_URL_TTS');
  }
  if (
    /\b\d{5}\b|Deutschland|\bstraße\b|\bstrasse\b/i.test(b) &&
    !/\b\d{5}\b|Deutschland/i.test(a)
  ) {
    ids.push('LAW_NO_PROFILE_TTS');
  }
  if (b.length > 600 && a.length <= 600) {
    ids.push('LAW_SPEECH_600');
  }
  if (
    (before.quickActions?.length ?? 0) !== (after.quickActions?.length ?? 0) ||
    JSON.stringify(before.quickActions) !== JSON.stringify(after.quickActions)
  ) {
    ids.push('LAW_BUTTON_SPEECH_SYNC');
  }

  return [...new Set(ids)];
}

function collectCorrectionIds(opts: {
  actionNotes: ActionJudgeNote[];
  llmRepaired: boolean;
  before: GeminiConciergeResponse;
  after: GeminiConciergeResponse;
}): string[] {
  const ids: string[] = [];
  for (const note of opts.actionNotes) {
    const id = correctionIdFromButtonNote(note);
    if (id) ids.push(id);
  }
  if (opts.llmRepaired) {
    ids.push(...inferSpeechLawCorrections(opts.before, opts.after));
    ids.push('LAW_LLM_JUDGE_REPAIR');
  }
  return [...new Set(ids)];
}

function emitJudgeTelemetry(opts: {
  executed: boolean;
  skipped: boolean;
  skipReason?: string;
  llmRepaired: boolean;
  actionNotes: ActionJudgeNote[];
  raw: GeminiConciergeResponse;
  repaired: GeminiConciergeResponse;
  userText: string;
}): void {
  try {
    const corrections = collectCorrectionIds({
      actionNotes: opts.actionNotes,
      llmRepaired: opts.llmRepaired,
      before: opts.raw,
      after: opts.repaired,
    });
    recordJudgePass({
      judge_executed: opts.executed,
      judge_corrections_made: corrections,
      raw_pass2_output: toJudgeSnapshot(opts.raw),
      repaired_output: toJudgeSnapshot(opts.repaired),
      user_text_preview: opts.userText,
      skipped: opts.skipped,
      skip_reason: opts.skipReason,
      llm_repaired: opts.llmRepaired,
    });
  } catch (err) {
    if (__DEV__) console.warn('[agi-judge] telemetry failed', err);
  }
}

export type JudgeResult = {
  response: GeminiConciergeResponse;
  repaired: boolean;
  skipped: boolean;
  reason?: string;
  actionNotes: ActionJudgeNote[];
};

/**
 * Law & Action-Button Judge.
 * Defekte Buttons → isoliert entfernen/reparieren; Antwort bleibt.
 * Keine Speech-Guardrails hier.
 */
export async function runLawJudgePass(opts: {
  response: GeminiConciergeResponse;
  userText: string;
  judgeLaws: FindusLaw[];
  judgePromptBlock: string;
}): Promise<JudgeResult> {
  const rawPass2 = opts.response;

  // --- 1) Action-Button-Richter (deterministisch, immer) ---
  const buttoned = applyActionButtonJudge(opts.response, {
    userText: opts.userText,
  });
  let current = buttoned.response;
  const actionNotes = buttoned.notes;
  let repaired = buttoned.changed;
  let llmRepaired = false;

  const finish = (
    result: Omit<JudgeResult, 'actionNotes'> & { actionNotes?: ActionJudgeNote[] },
  ): JudgeResult => {
    const finalNotes = result.actionNotes ?? actionNotes;
    emitJudgeTelemetry({
      executed: !result.skipped || repaired || llmRepaired,
      skipped: result.skipped,
      skipReason: result.reason,
      llmRepaired,
      actionNotes: finalNotes,
      raw: rawPass2,
      repaired: result.response,
      userText: opts.userText,
    });
    return { ...result, actionNotes: finalNotes };
  };

  if (!hasGeminiApiKey()) {
    return finish({
      response: current,
      repaired,
      skipped: true,
      reason: 'offline_or_no_key',
    });
  }

  if (!opts.judgeLaws.length) {
    return finish({
      response: current,
      repaired,
      skipped: true,
      reason: 'no_laws',
    });
  }

  // --- 2) Fast-Pass LLM-Judge (Flash-Lite, kompakt, ≤900ms + AbortSignal) ---
  const speech = current.speechText ?? '';
  const speechLooksClean =
    speech.length <= 600 &&
    !/https?:\/\/|www\./i.test(speech) &&
    !/\b\d{5}\b/.test(speech) &&
    !/\bDeutschland\b/i.test(speech);

  // Code-only Fast-Path: Speech ohne offensichtliche Verstöße → kein LLM
  // (Buttons sind bereits per Code-Richter repariert/entfernt)
  if (speechLooksClean) {
    return finish({
      response: current,
      repaired,
      skipped: false,
      reason: buttoned.changed ? 'code_fast_path_buttons' : 'code_fast_path',
    });
  }

  const payload = {
    speechText: speech.slice(0, 600),
    cardTitle: (current.cardTitle ?? '').slice(0, 48),
    visualBullets: (current.visualBullets ?? []).slice(0, 3),
    quickActions: current.quickActions.slice(0, 4).map((a) => ({
      type: a.type,
      label: shortenActionLabel(a.label),
      payload: a.payload,
    })),
  };

  // Kompakter Prompt: Verfassung + max 5 Kontext (kommt schon so aus Router)
  const prompt = [
    'FAST-JUDGE. Nur JSON.',
    'ok → {"ok":true}',
    'Verstoß → {"ok":false,"speechText":"...","cardTitle":"","visualBullets":[],"quickActions":[]}',
    'Max 600 Zeichen Speech. Keine URL/PLZ/Adresse. Buttons nur mit gültigem payload.',
    opts.judgePromptBlock.slice(0, 3500),
    `Q: ${opts.userText.trim().slice(0, 280)}`,
    `A: ${JSON.stringify(payload)}`,
  ].join('\n');

  const JUDGE_BUDGET_MS = 900;
  const abortCtrl = new AbortController();
  const timeoutId = setTimeout(() => abortCtrl.abort(), JUDGE_BUDGET_MS);

  try {
    const text = await generateGeminiText(prompt, {
      task: 'intent',
      tier: 'lite',
      maxTokens: 280,
      temperature: 0,
      useFindusSystem: false,
      responseJson: true,
      signal: abortCtrl.signal,
    });

    const parsed = extractJsonObject(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return finish({
        response: current,
        repaired,
        skipped: true,
        reason: 'parse_fail',
      });
    }

    if (parsed.ok === true) {
      return finish({
        response: current,
        repaired,
        skipped: false,
      });
    }

    const llmParsed = parseConciergeResponse(JSON.stringify(parsed));
    if (!llmParsed) {
      return finish({
        response: current,
        repaired,
        skipped: true,
        reason: 'repair_parse_fail',
      });
    }

    const reButtoned = applyActionButtonJudge(llmParsed, {
      userText: opts.userText,
    });
    current = reButtoned.response;
    actionNotes.push(...reButtoned.notes);
    repaired = true;
    llmRepaired = true;

    return finish({
      response: current,
      repaired,
      skipped: false,
      actionNotes,
    });
  } catch (err) {
    const aborted =
      abortCtrl.signal.aborted ||
      (err instanceof Error &&
        (err.name === 'AbortError' || /aborted|AbortError/i.test(err.message)));
    if (aborted) {
      return finish({
        response: current,
        repaired,
        skipped: true,
        reason: 'fast_timeout_900ms',
      });
    }
    if (__DEV__) console.warn('[agi-judge] failed', err);
    return finish({
      response: current,
      repaired,
      skipped: true,
      reason: 'error',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export {
  applyActionButtonJudge,
  judgeActionButtons,
  ACTION_LABEL_MAX_CHARS,
  type ActionJudgeNote,
  type ActionButtonJudgeResult,
} from './actionButtonJudge';
