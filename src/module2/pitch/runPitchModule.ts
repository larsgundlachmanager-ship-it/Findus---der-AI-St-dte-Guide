/**
 * Auswahl-Pitch Orchestrierung — keine Bridge, Parent liefert Brief.
 */

import { collectCandidates } from './candidatePool';
import { filterAndRank } from './wishFilterRank';
import { generatePitchSpeech } from './pitchSpeech';
import { buildPitchActions } from './pitchActions';
import {
  startPitchDeepAppend,
  type PitchSession,
} from './pitchDeepAppend';
import { publishPitchResult, useLivePitchStore } from './publishPitchUi';
import { enqueueSpeech } from '../speech/speechQueue';
import type {
  PitchDeepAppend,
  PitchOptionCard,
  PitchRequest,
  PitchResult,
} from './types';

function roleFor(
  i: number,
  softFail: boolean,
): PitchOptionCard['role'] {
  if (i === 0) return 'favorite';
  return softFail ? 'alternative' : 'alternative';
}

export async function runPitchModule(
  req: PitchRequest,
): Promise<PitchResult> {
  const pool = await collectCandidates(req);
  const ranked = filterAndRank(req, pool);
  const pitched = await generatePitchSpeech({
    req,
    top: ranked.top,
    softFail: ranked.softFail,
    softFailReason: ranked.reason,
    signal: req.signal,
  });

  const options: PitchOptionCard[] = pitched.cards.map((card, i) => {
    const c = card.candidate;
    const role = roleFor(i, ranked.softFail);
    const mapsUrl = c.mapsUrl;
    const actions = buildPitchActions({
      kind: req.kind,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      mapsUrl,
      role: role === 'out_of_box' ? 'alternative' : role,
    });
    return {
      id: `pitch_${req.requestId}_${i === 0 ? 'a' : 'b'}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      role,
      speechPitch: card.speechPitch,
      bullets: card.bullets,
      mapsUrl,
      rating: c.rating,
      actions,
    };
  });

  // Out-of-box als dritte Karte nur in Hint, nicht erzwingen
  let outOfBoxHint: string | null = null;
  if (ranked.outOfBox && ranked.softFail) {
    outOfBoxHint = `Out-of-the-box: ${ranked.outOfBox.name} — ungewöhnlich, aber eine Chance.`;
  }

  const spokenText = [pitched.spokenText, outOfBoxHint]
    .filter(Boolean)
    .join(' ')
    .trim();

  const result: PitchResult = {
    requestId: req.requestId,
    softFail: ranked.softFail,
    spokenText,
    summary: pitched.summary,
    options,
    outOfBoxHint,
    uiLayout: req.uiLayout,
  };

  publishPitchResult(result, {
    stepKey: req.requestId,
    headline: req.title.slice(0, 48) || 'Zwei Optionen',
    anchorTimeMs: req.visitAtMs,
  });

  startPitchDeepAppend({
    req,
    options,
    onAppend: (append) => applyDeepAppend(append),
  });

  return result;
}

function applyDeepAppend(append: PitchDeepAppend): void {
  const live = useLivePitchStore.getState();
  const selected = live.selectedOptionId ?? append.optionId;

  if (append.spokenAppend) {
    // Nach Tap: nur erwähnen wenn noch relevant / allgemein Preise
    const text =
      selected && append.optionId && selected !== append.optionId
        ? ''
        : append.spokenAppend;
    if (text) {
      void enqueueSpeech({
        kind: 'main',
        text,
        turnId: `pitch_deep_${append.requestId}`,
      });
    }
  }

  if (live.requestId === append.requestId) {
    for (const opt of live.options) {
      if (selected && opt.id !== selected) {
        // nach Tap andere Option nicht mehr patchen
        if (live.selectedOptionId) continue;
      }
      const bullets = append.bulletUpdates?.[opt.id];
      const actions = append.actionUpdates?.[opt.id];
      const menuUrl = append.menuUrls?.[opt.id];
      live.patchOption(opt.id, {
        ...(bullets ? { bullets } : null),
        ...(actions ? { actions } : null),
        ...(menuUrl !== undefined ? { menuUrl } : null),
      });
    }
  }

  // Timeline mirrored actions
  try {
    const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => {
          pendingChoice: {
            options: Array<{
              id: string;
              bullets?: string[];
              menuUrl?: string | null;
            }>;
            stepKey: string;
            headline: string;
            anchorTimeMs: number | null;
            anchorTimeLabel: string | null;
          } | null;
          setMirroredActions: (a: unknown[]) => void;
          setPendingChoice: (c: unknown) => void;
        };
      };
    };
    const ui = usePlanCalendarUiStore.getState();
    const pending = ui.pendingChoice;
    if (pending) {
      const nextOpts = pending.options.map((o) => {
        const bullets = append.bulletUpdates?.[o.id];
        const menuUrl = append.menuUrls?.[o.id];
        return {
          ...o,
          ...(bullets ? { bullets, subtitle: bullets.join('\n') } : null),
          ...(menuUrl ? { menuUrl } : null),
        };
      });
      ui.setPendingChoice({ ...pending, options: nextOpts });
      const acts = Object.values(append.actionUpdates ?? {}).flat();
      if (acts.length) ui.setMirroredActions(acts.slice(0, 6));
    }
  } catch {
    /* soft */
  }
}

export type { PitchSession };
