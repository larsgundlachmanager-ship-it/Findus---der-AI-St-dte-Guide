/**
 * Phase 3 — Ask-Back SSOT.
 *
 * Nur echte Blocker: ohne die Info ist sinnvolle Suche unmöglich.
 * Ambiguity (Nusschale, Papst, Boot/NL) → still inferieren, nie fragen.
 * Nice-to-have / kleine Lücken → trotzdem suchen (Just-Do-It).
 */

import type { MissionChecklist } from './missionContract';
import {
  firstCriticalBlocker,
  hasCriticalBlocker,
  askBackCopyForFact,
} from './missionContract';

export type ResolveMissionAskBackInput = {
  userText: string;
  mission: MissionChecklist;
  /** Taxi→Flughafen ohne Flug */
  taxiBlocked?: boolean;
  taxiAskBack?: string | null;
  /** Roh aus Call-1 LLM / analysis.askBack */
  llmAskBack?: string | null;
};

export type ResolveMissionAskBackResult = {
  askBack: string | null;
  /** Debug / Prompt */
  reason:
    | 'taxi_airport'
    | 'mission_critical'
    | 'stripped_ambiguity'
    | 'stripped_just_do_it'
    | 'none';
};

/**
 * Meta-/Ambiguity-Rückfragen — immer streichen, egal was das LLM sagt.
 */
export function looksLikeAmbiguityAskBack(text: string): boolean {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  return (
    /\bwelche[rnms]?\s+(stadt|boot|ort|papst|hotel|option|gemeint|meintest)\b/iu.test(
      t,
    ) ||
    /\bwelchen\s+papst\b/iu.test(t) ||
    /\bwas\s+meinst\s+du\s+(genau\s+)?mit\b/iu.test(t) ||
    /\bwas\s+meinst\s+du\s+genau\b/iu.test(t) ||
    /\bwas\s+genau\s+meinst\s+du\b/iu.test(t) ||
    /\bwen\s+genau\s+(du\s+)?meinst\b/iu.test(t) ||
    /\bwen\s+meinst\s+du\b/iu.test(t) ||
    /\bsagt?\s+mir\s+kurz,?\s+wen\b/iu.test(t) ||
    /\bfehlt\s+da\s+gerade\s+der\s+name\b/iu.test(t) ||
    /\bmir\s+fehlt\s+da\s+gerade\b/iu.test(t) ||
    /\bauf\s+die\s+du\s+dich\s+beziehst\b/iu.test(t) ||
    /\bPerson,?\s+auf\s+die\s+du\s+dich\s+beziehst\b/iu.test(t) ||
    /\bkannst\s+du\s+(das\s+)?(etwas\s+)?präziser\b/iu.test(t) ||
    /\bkannst\s+du\s+(das\s+)?genauer\s+(sagen|machen|erklären|erklaeren)\b/iu.test(
      t,
    ) ||
    /\bsei\s+(etwas\s+)?genauer\b/iu.test(t) ||
    /\bbitte\s+(etwas\s+)?genauer\b/iu.test(t) ||
    /\bmeinst\s+du\s+(die\s+)?(stadt|gondel|boot|alster)\b/iu.test(t) ||
    /\bwelches\s+boot\b/iu.test(t) ||
    /\bkönntest\s+du\s+das\s+näher\s+eingrenzen\b/iu.test(t) ||
    /\bbitte\s+genauer\s+sagen\b/iu.test(t)
  );
}

/** Permission-/Soft-Asks die Just-Do-It verbietet. */
export function looksLikePermissionAskBack(text: string): boolean {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  return (
    /\bsoll\s+ich\s+(dir\s+)?(die\s+)?(nummer|party|orte|tickets?|links?)\s+(heraussuchen|suchen|checken)\b/iu.test(
      t,
    ) ||
    /\bsoll\s+ich\s+(danach|weiter|noch)\s+suchen\b/iu.test(t) ||
    /\bmagst\s+du[,\s]+dass\s+ich\b/iu.test(t) ||
    /\bfür\s+wen\b/iu.test(t)
  );
}

/**
 * Kanonische Ask-Back-Entscheidung.
 */
export function resolveMissionAskBack(
  input: ResolveMissionAskBackInput,
): ResolveMissionAskBackResult {
  // Ambiguity wird in buildMissionChecklist still normalisiert —
  // hier nur entscheiden, ob gefragt werden darf.

  // 1) Harter Taxi-Blocker
  if (input.taxiBlocked && input.taxiAskBack?.trim()) {
    return {
      askBack: input.taxiAskBack.trim().slice(0, 220),
      reason: 'taxi_airport',
    };
  }

  // 2) Mission critical residual
  if (hasCriticalBlocker(input.mission)) {
    const blocker = firstCriticalBlocker(input.mission);
    const copy =
      input.mission.askBack?.trim() ||
      (blocker ? askBackCopyForFact(blocker) : null);
    if (copy) {
      return { askBack: copy.slice(0, 220), reason: 'mission_critical' };
    }
  }

  const llm = String(input.llmAskBack || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!llm) {
    return { askBack: null, reason: 'none' };
  }

  // 3) Ambiguity / Permission aus LLM → streichen
  if (looksLikeAmbiguityAskBack(llm)) {
    return { askBack: null, reason: 'stripped_ambiguity' };
  }
  if (looksLikePermissionAskBack(llm)) {
    return { askBack: null, reason: 'stripped_just_do_it' };
  }

  // 4) Kein critical Fact offen → Just-Do-It, LLM-Ask streichen
  const criticalOpen = (input.mission.factsToProve || []).some(
    (f) =>
      f.critical &&
      f.status === 'pending' &&
      !(f.value && String(f.value).trim()),
  );
  if (!criticalOpen) {
    return { askBack: null, reason: 'stripped_just_do_it' };
  }

  return { askBack: llm.slice(0, 220), reason: 'mission_critical' };
}

/** Prompt-Geländer kurz. */
export const FINDUS_MISSION_ASKBACK_BLOCK = `
=== ASK-BACK (Mission) ===
Nur bei echtem Blocker (ohne Info unmöglich sinnvoll zu suchen) — z. B. Flughafen-ETA ohne Flugzeit, Taxi Flughafen ohne Flug.
VERBOTEN: Ambiguity („welches Boot?“, „welchen Papst?“, „was meinst du genau?“, „was meinst du mit …?“), Permission („soll ich suchen?“), Präziser-werden.
Stattdessen: still herleiten → MissionChecklist normalisieren → suchen.
`.trim();
