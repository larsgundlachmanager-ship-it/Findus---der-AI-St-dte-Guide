/**
 * Call-2-Tail Side-Effects: background_tasks + followUp hints (Gap #1).
 */

import type { SynthesisPayload } from '../../types';
import type { Call2TailV1 } from './call2Tail';
import {
  applyBackgroundTasks,
  parseBackgroundTasks,
} from '../../../services/concierge/backgroundTasks';
import type { GeminiConciergeResponse } from '../../../types/concierge';

export async function applyCall2TailEffects(opts: {
  tail: Call2TailV1 | null;
  synthesis: SynthesisPayload;
  userText: string;
}): Promise<SynthesisPayload> {
  if (!opts.tail) return opts.synthesis;
  let speech = opts.synthesis.fullDraftForUi;
  let bullets = [...opts.synthesis.bullets];

  if (opts.tail.background_tasks?.length) {
    const pseudo: GeminiConciergeResponse = {
      speechText: speech,
      visualBullets: bullets,
      quickActions: [],
      backgroundTasks: parseBackgroundTasks(opts.tail.background_tasks),
    };
    const ran = await applyBackgroundTasks(pseudo, {
      userText: opts.userText,
    });
    if (ran.changed) {
      speech = ran.response.speechText;
      bullets = ran.response.visualBullets ?? bullets;
    }
  }

  return {
    ...opts.synthesis,
    fullDraftForUi: speech,
    bullets,
    spokenChunks: opts.synthesis.spokenChunks?.length
      ? opts.synthesis.spokenChunks
      : [speech],
  };
}
