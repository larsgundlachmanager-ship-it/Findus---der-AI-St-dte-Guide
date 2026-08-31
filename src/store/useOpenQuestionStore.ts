/**
 * Offene Teilfragen & User-Fakten aus Multi-Intent-Turns.
 * Yorro merkt sich Rückfragen und deferred Parts für Follow-ups.
 */

import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';

export type OpenSubQuestion = {
  id: string;
  text: string;
  priority: number;
  answered: boolean;
  createdAtMs: number;
  sourceTurn: string;
};

export type StoredUserFact = {
  key: string;
  value: string;
  atMs: number;
  sourceTurn: string;
};

type OpenQuestionState = {
  subQuestions: OpenSubQuestion[];
  userFacts: StoredUserFact[];
  lastTopicSummary: string | null;
  pendingFollowUps: string[];
  hydrate: () => Promise<void>;
  mergeFromPass1: (input: {
    subQuestions: Array<{ id?: string; text: string; priority?: number }>;
    facts: Array<{ key: string; value: string }>;
    topicSummary?: string;
    anticipatedFollowUps?: string[];
    sourceTurn: string;
  }) => void;
  markAnswered: (id: string) => void;
  getOpenSubQuestions: () => OpenSubQuestion[];
  formatForPrompt: () => string;
  clearAnswered: () => void;
};

const PATH = `${FileSystem.documentDirectory}findus-open-questions.json`;

async function persist(state: Pick<OpenQuestionState, 'subQuestions' | 'userFacts' | 'lastTopicSummary' | 'pendingFollowUps'>): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      PATH,
      JSON.stringify({
        subQuestions: state.subQuestions.slice(-24),
        userFacts: state.userFacts.slice(-40),
        lastTopicSummary: state.lastTopicSummary,
        pendingFollowUps: state.pendingFollowUps.slice(-12),
      }),
    );
  } catch {
    /* soft-fail */
  }
}

export const useOpenQuestionStore = create<OpenQuestionState>((set, get) => ({
  subQuestions: [],
  userFacts: [],
  lastTopicSummary: null,
  pendingFollowUps: [],

  hydrate: async () => {
    try {
      const info = await FileSystem.getInfoAsync(PATH);
      if (!info.exists) return;
      const raw = await FileSystem.readAsStringAsync(PATH);
      const data = JSON.parse(raw) as Partial<OpenQuestionState>;
      set({
        subQuestions: Array.isArray(data.subQuestions) ? data.subQuestions : [],
        userFacts: Array.isArray(data.userFacts) ? data.userFacts : [],
        lastTopicSummary:
          typeof data.lastTopicSummary === 'string' ? data.lastTopicSummary : null,
        pendingFollowUps: Array.isArray(data.pendingFollowUps)
          ? data.pendingFollowUps
          : [],
      });
    } catch {
      /* ignore */
    }
  },

  mergeFromPass1: (input) => {
    const now = Date.now();
    const existing = get().subQuestions;
    const mergedSubs: OpenSubQuestion[] = [...existing];
    for (const sq of input.subQuestions) {
      const text = sq.text.trim();
      if (!text) continue;
      const dup = mergedSubs.some(
        (q) => !q.answered && q.text.toLowerCase() === text.toLowerCase(),
      );
      if (dup) continue;
      mergedSubs.push({
        id: sq.id ?? `sq-${now}-${mergedSubs.length}`,
        text,
        priority: sq.priority ?? 50,
        answered: false,
        createdAtMs: now,
        sourceTurn: input.sourceTurn.slice(0, 120),
      });
    }

    const facts = [...get().userFacts];
    for (const f of input.facts) {
      if (!f.key.trim() || !f.value.trim()) continue;
      const idx = facts.findIndex((x) => x.key === f.key);
      const row: StoredUserFact = {
        key: f.key.trim(),
        value: f.value.trim(),
        atMs: now,
        sourceTurn: input.sourceTurn.slice(0, 120),
      };
      if (idx >= 0) facts[idx] = row;
      else facts.push(row);
    }

    const next = {
      subQuestions: mergedSubs.slice(-24),
      userFacts: facts.slice(-40),
      lastTopicSummary: input.topicSummary?.trim() || get().lastTopicSummary,
      pendingFollowUps: [
        ...new Set([
          ...get().pendingFollowUps,
          ...(input.anticipatedFollowUps ?? []),
        ]),
      ].slice(-12),
    };
    set(next);
    void persist(next);
  },

  markAnswered: (id) => {
    const subQuestions = get().subQuestions.map((q) =>
      q.id === id ? { ...q, answered: true } : q,
    );
    set({ subQuestions });
    void persist({ ...get(), subQuestions });
  },

  getOpenSubQuestions: () =>
    get()
      .subQuestions.filter((q) => !q.answered)
      .sort((a, b) => b.priority - a.priority),

  formatForPrompt: () => {
    const open = get().getOpenSubQuestions();
    const facts = get().userFacts.slice(-8);
    const parts: string[] = [];
    if (get().lastTopicSummary) {
      parts.push(`Letztes Thema: ${get().lastTopicSummary}`);
    }
    if (open.length) {
      parts.push(
        'Offene Teilfragen (ALLE bearbeiten oder ehrlich defer):',
        ...open.map((q, i) => `${i + 1}) [${q.id}] ${q.text}`),
      );
    }
    if (facts.length) {
      parts.push(
        'Gemerkte User-Fakten:',
        ...facts.map((f) => `· ${f.key}: ${f.value}`),
      );
    }
    if (get().pendingFollowUps.length) {
      parts.push(
        `Antizipierte Rückfragen: ${get().pendingFollowUps.slice(0, 5).join(' · ')}`,
      );
    }
    return parts.length ? parts.join('\n') : '';
  },

  clearAnswered: () => {
    const subQuestions = get().subQuestions.filter((q) => !q.answered);
    set({ subQuestions });
    void persist({ ...get(), subQuestions });
  },
}));
