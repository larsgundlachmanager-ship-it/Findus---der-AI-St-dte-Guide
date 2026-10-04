/**
 * Hotel-Follow-up nach leerem Pitch — kein „erstes Hotel“ ohne Inventar.
 * Struktur: ehrlich klären oder einmal breiter suchen (Stay22).
 */

import type { PipelineTurnResult } from '../types';
import {
  getLastLiveInventory,
  noteLastLiveInventory,
  type LiveInventoryKind,
} from '../context/shortTermContext';

export type HotelPitchOutcome = 'empty' | 'named' | 'generic';

/** User bezieht sich auf ein zuvor genanntes Hotel (Ordinal / Verifikation). */
export function isHotelOrdinalVerifyFollowUp(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 140) return false;
  if (
    /\b(?:erstes?|zweites?|drittes?|1\.|2\.|option\s*[12]|das\s+(?:erste|zweite)\s+hotel|jenes\s+hotel|dieses\s+hotel|das\s+hotel)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /\b(?:wirklich|tatsächlich|tatsaechlich|hab(?:en|t)\s+(?:die|der|das))\b/iu.test(
      t,
    ) && /\b(?:pool|sauna|hotel|zimmer|unterkunft)\b/iu.test(t)
  );
}

function isGenericHotelCardName(name: string): boolean {
  const n = (name || '').trim();
  if (!n) return true;
  return /^hotels?\s+(?:in|für|bei)\b/iu.test(n) || /^hotel\s+in\b/iu.test(n);
}

export function inferHotelPitchOutcomeFromSpeech(
  speech: string,
  bullets: string[] = [],
  optionNames: string[] = [],
): HotelPitchOutcome {
  const named = optionNames.filter((n) => n && !isGenericHotelCardName(n));
  if (named.length >= 1) return 'named';
  const blob = `${speech} ${bullets.join(' ')}`.toLowerCase();
  if (
    /\b(kein(?:e|en)?\s+(?:passend|treffer|hotel|voll[\s-]*match)|nichts\s+passend|kein\s+hard[\s-]*match|hab(?:e|en)\s+(?:dir|ihnen)\s+gerade\s+kein)\b/iu.test(
      blob,
    )
  ) {
    return 'empty';
  }
  if (optionNames.some((n) => isGenericHotelCardName(n))) return 'generic';
  return 'empty';
}

export function noteHotelPitchOutcome(opts: {
  query: string;
  outcome: HotelPitchOutcome;
  hotelNames?: string[];
  retried?: boolean;
}): void {
  noteLastLiveInventory({
    kind: 'hotel',
    query: opts.query,
    hotelOutcome: opts.outcome,
    hotelNames: opts.hotelNames,
    hotelRetried: opts.retried,
  });
}

function buildClarifyTurn(opts: {
  turnId: string;
  userText: string;
  priorQuery: string;
}): PipelineTurnResult {
  const speech =
    'Ich hatte dir gerade kein konkretes Hotel genannt — die Suche war leer. ' +
    'Sag mir, ob ich weiter suchen soll: größerer Radius, Budget anpassen oder Must-Haves lockern.';
  const bullets = [
    'Kein Hotel zuvor genannt',
    'Suche war leer',
    'Weiter suchen: Radius / Budget / Amenities',
  ];
  try {
    const { presentToUi } = require('../pipeline/presentToUi') as {
      presentToUi: (
        speech: string,
        bullets: string[],
        buttons: unknown[],
        o: { userText: string },
      ) => Promise<void>;
    };
    const { enqueueSpeech } = require('../speech/speechQueue') as {
      enqueueSpeech: (o: {
        kind: string;
        text: string;
        turnId: string;
      }) => void;
    };
    void presentToUi(speech, bullets, [], { userText: opts.userText });
    enqueueSpeech({ kind: 'main', text: speech, turnId: opts.turnId });
  } catch {
    /* smoke / headless */
  }
  const logic = {
    spokenDraft: speech,
    bullets,
    buttons: [],
    moneyEur: [],
    warnings: ['hotel_empty_followup'],
  };
  let synthesis = { spokenChunks: [speech], bullets, buttons: [], fullDraftForUi: speech };
  try {
    const { synthesizeOutput } = require('../pipeline/synthesis') as {
      synthesizeOutput: (l: typeof logic) => typeof synthesis;
    };
    synthesis = synthesizeOutput(logic);
  } catch {
    /* smoke / headless */
  }
  return {
    turnId: opts.turnId,
    tasks: [],
    bridgingText: null,
    logic,
    synthesis,
    deepResearchQueued: false,
    jobId: 'stay_search',
  };
}

export function buildHotelWidenRetryQuery(
  priorQuery: string,
  followUp: string,
): string {
  return `${priorQuery}. Kein Treffer — einmal breiter suchen (größerer Radius, Budget flexibler, Pool/Sauna nur wenn belegt). Follow-up: ${followUp}`.slice(
    0,
    480,
  );
}

/**
 * Leerer Hotel-Pitch + Ordinal/Verify-Follow-up → klären oder einmal breiter suchen.
 * Gibt Turn-Result zurück (klären) oder null (Caller soll Pitch mit retryQuery starten).
 */
export function resolveHotelEmptyFollowUp(opts: {
  userText: string;
  turnId: string;
  inheritInventory: boolean;
}):
  | PipelineTurnResult
  | { retryQuery: string; kind: LiveInventoryKind }
  | null {
  if (!opts.inheritInventory) return null;
  const pending = getLastLiveInventory();
  if (!pending || pending.kind !== 'hotel') return null;
  if (!isHotelOrdinalVerifyFollowUp(opts.userText)) return null;

  const outcome = pending.hotelOutcome ?? 'empty';
  const names = (pending.hotelNames ?? []).filter(
    (n) => n && !isGenericHotelCardName(n),
  );
  if (outcome === 'named' && names.length >= 1) return null;

  if (!pending.hotelRetried) {
    return {
      retryQuery: buildHotelWidenRetryQuery(pending.query, opts.userText),
      kind: 'hotel',
    };
  }

  return buildClarifyTurn({
    turnId: opts.turnId,
    userText: opts.userText,
    priorQuery: pending.query,
  });
}
