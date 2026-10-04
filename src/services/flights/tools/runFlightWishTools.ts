/**
 * wishPitch tool pipeline — scan → rank → links → woven speech.
 */

import { scanCheapWindow } from './scanCheapWindow';
import { rankFlightOptions } from './rankFlightOptions';
import { buildProvisionLinks } from './buildProvisionLinks';
import { weaveFlightBookingSpeech } from './weaveFlightBookingSpeech';
import type { FlightWishToolResult } from './flightWishTypes';

export async function runFlightWishTools(opts: {
  originIata: string;
  destIata: string;
  outboundDateKey: string | null;
  returnDateKey?: string | null;
  fromLabel: string;
  toLabel: string;
  whenLabel?: string | null;
  userText?: string | null;
}): Promise<FlightWishToolResult | null> {
  const outbound =
    opts.outboundDateKey ||
    (() => {
      try {
        const { offsetDateKey } = require('../../../utils/dateKeys') as typeof import('../../../utils/dateKeys');
        return offsetDateKey(14);
      } catch {
        return null;
      }
    })();
  if (!outbound) return null;

  const candidates = await scanCheapWindow({
    originIata: opts.originIata,
    destIata: opts.destIata,
    outboundDateKey: outbound,
    returnDateKey: opts.returnDateKey ?? null,
  });
  const ranked = rankFlightOptions(candidates, 3);
  const pick = ranked[0] ?? candidates[0];
  if (!pick) return null;

  const provisionActions = buildProvisionLinks({
    originIata: opts.originIata,
    destIata: opts.destIata,
    outboundDateKey: pick.outboundDateKey,
    returnDateKey: pick.returnDateKey ?? opts.returnDateKey ?? null,
    userText: opts.userText,
    ranked,
  });

  const { speech, bullets } = weaveFlightBookingSpeech({
    fromLabel: opts.fromLabel,
    toLabel: opts.toLabel,
    whenLabel: opts.whenLabel,
    ranked: ranked.length ? ranked : [pick],
  });

  return {
    candidates,
    ranked,
    provisionActions,
    speech,
    bullets,
    bestOutboundDateKey: pick.outboundDateKey,
    bestReturnDateKey: pick.returnDateKey ?? opts.returnDateKey ?? null,
  };
}
