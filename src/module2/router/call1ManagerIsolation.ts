/**
 * Call-1 Manager Isolation — sticky Kontext scrubben wenn Call 1 session=new.
 * Kein zweites Gehirn: Code ehrt nur Call-1 topicScope/session.
 */

import type { ManagerAnalysis } from './types';

export function shouldScrubStickyForNewTopic(
  analysis: ManagerAnalysis,
): boolean {
  if (analysis.session === 'new') return true;
  if (analysis.topicScope?.mode === 'new') return true;
  if (analysis.topicScope?.turnsForCall2 === 0) return true;
  if (analysis.topicScope?.inheritLiveInventory === false) {
    return analysis.session !== 'continue' && analysis.session !== 'resume';
  }
  return false;
}

/** Concierge-Card, Live-Inventory, Sticky-Pitch, Intent-Queue — bei neuem Thema. */
export async function scrubStickyAfterCall1(
  analysis: ManagerAnalysis,
  userText?: string,
): Promise<void> {
  if (!shouldScrubStickyForNewTopic(analysis)) return;

  // Place-fact / Ort-Follow-up: sticky Ort behalten (Planten → „was kann man da machen?“).
  const ut = String(userText || '').replace(/\s+/g, ' ').trim();
  let keepPlace = false;
  try {
    const { isQuickLookupQuery } = require('../../services/concierge/celestialSkyQuery') as {
      isQuickLookupQuery: (s: string) => boolean;
    };
    const { looksLikeNamedTriviaSubject } = require('../kernel/turnKernel') as {
      looksLikeNamedTriviaSubject: (s: string) => boolean;
    };
    const worldPerson =
      looksLikeNamedTriviaSubject(ut) ||
      /\b(papst|präsident|präsidentin|bundeskanzler|mark\s+forster|manuel\s+neuer)\b/iu.test(
        ut,
      );
    const placeFact =
      /\b(wie\s+viele|was\s+kann\s+man|was\s+machen|eintritt|öffnungs|park\b|garten|museum|strand|alster|planten|blomen)\b/iu.test(
        ut,
      ) ||
      (isQuickLookupQuery(ut) && !worldPerson);
    keepPlace = placeFact && !worldPerson;
  } catch {
    keepPlace =
      /\b(wie\s+viele|was\s+kann\s+man|park\b|garten|planten|blomen)\b/iu.test(ut) &&
      !/\b(papst|präsident)\b/iu.test(ut);
  }

  try {
    const { clearLastLiveInventory } = require('../context/shortTermContext') as {
      clearLastLiveInventory: () => void;
    };
    clearLastLiveInventory();
  } catch {
    /* soft */
  }

  // Stadt/Ort/Topic/Menü — sonst leakt Tennis/Amsterdam in Call-2 Stadt-Label.
  try {
    const {
      setLastPlaceName,
      setLastTopic,
      setLastMenuUrl,
      clearLastMentionedCity,
      clearCityPackOffer,
      getShortTerm,
    } = require('../context/shortTermContext') as {
      setLastPlaceName: (n: string | null) => void;
      setLastTopic: (t: string | null) => void;
      setLastMenuUrl: (u: string | null) => void;
      clearLastMentionedCity: () => void;
      clearCityPackOffer: () => void;
      getShortTerm: () => { lastPlaceName: string | null };
    };
    const stickyPlace = keepPlace
      ? String(getShortTerm()?.lastPlaceName || '').trim() || null
      : null;
    setLastPlaceName(stickyPlace);
    setLastTopic(null);
    setLastMenuUrl(null);
    clearLastMentionedCity();
    clearCityPackOffer();
  } catch {
    try {
      if (!keepPlace) {
        const { setLastPlaceName } = require('../context/shortTermContext') as {
          setLastPlaceName: (n: string | null) => void;
        };
        setLastPlaceName(null);
      }
    } catch {
      /* soft */
    }
  }

  try {
    const { useFinnusStore } = require('../../store/useFinnusStore') as {
      useFinnusStore: { getState: () => { setActiveConciergeCard: (c: null) => void } };
    };
    useFinnusStore.getState().setActiveConciergeCard(null);
  } catch {
    /* soft */
  }

  try {
    const { useLivePitchStore } = require('../pitch/publishPitchUi') as {
      useLivePitchStore: { getState: () => { clear: (force?: boolean) => void } };
    };
    useLivePitchStore.getState().clear(true);
  } catch {
    /* soft */
  }

  // Alte Multi-Intent-Queue (Tennis/Pitch) nicht in Chat-Lane mitschicken.
  try {
    const { clearIntentQueue } = require('./intentQueue') as {
      clearIntentQueue: () => void;
    };
    clearIntentQueue();
  } catch {
    /* soft */
  }

  // Root-Ziel der Session bei Topic-Cut zurücksetzen.
  try {
    const { clearSessionRootGoal } = require('../context/shortTermContext') as {
      clearSessionRootGoal: () => void;
    };
    clearSessionRootGoal();
  } catch {
    /* soft */
  }

  // Vordergrund-Thread schließen — sonst sieht Call 2 trotz turns=0 noch Tennis-Label.
  try {
    const { closeForegroundThread } = require('../../services/memory/conversationThreads') as {
      closeForegroundThread: (reason?: string) => boolean;
    };
    closeForegroundThread('topic_cut_new');
  } catch {
    /* soft */
  }
}
