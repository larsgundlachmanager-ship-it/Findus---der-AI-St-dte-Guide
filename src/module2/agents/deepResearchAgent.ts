import type { Module2Agent } from './types';
import { anchorCoords } from '../rucksack/rucksackStore';
import { resolveWorkingPlace } from '../context/placeContext';
import { getShortTerm } from '../context/shortTermContext';
import { runMapsPitchDeepResearch } from './mapsPitchDeepResearch';
import { detectMapsPitchKind } from '../../services/research/venueMapsPitch';

/**
 * Slow Lane — Maps-Pitch / Venue-Deep-Research (Hotels, Museen, Attraktionen).
 * Nie blockierend für den Fast-Path; Ergebnis kommt als Follow-up.
 */
export const deepResearchAgent: Module2Agent = {
  id: 'deep_research',
  intents: ['deep_research'],
  async run({ task, rucksack, signal }) {
    const place = resolveWorkingPlace(
      task.rewrittenText,
      rucksack.cityHint,
      task.city,
    );
    const a = anchorCoords(rucksack);
    const short = getShortTerm();
    const kind = detectMapsPitchKind(task.rewrittenText);
    const subject =
      task.subject?.trim() ||
      short.lastPlaceName ||
      task.rewrittenText.slice(0, 80);

    const deep = await runMapsPitchDeepResearch({
      userText: task.rewrittenText,
      kind,
      city: place.city,
      venues: [{ name: subject }],
      alreadySaid: '',
      anchor: a,
      signal,
    });

    if (deep.draftText?.trim() || deep.buttons?.length) {
      return deep;
    }

    return {
      agent: 'deep_research',
      ok: true,
      draftText: '',
      slowLane: true,
      meta: { silent: true, reason: 'maps_pitch_empty' },
    };
  },
};
