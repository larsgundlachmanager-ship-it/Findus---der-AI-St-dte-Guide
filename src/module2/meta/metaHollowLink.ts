/**
 * Meta: Hollow-Link-Policy — OPEN_URL nur wenn nicht hollow.
 */

import type { QuickAction } from '../../types/concierge';

export {
  isHollowPartnerUrl,
  looksLikePartnerBookClaim,
  rejectHollowPartnerBookAction,
  softenHollowPartnerBookAction,
  unwrapPartnerLandingUrl,
} from '../../services/affiliate/hollowPartnerUrl';

export function buildHollowSafeOpenUrlAction(opts: {
  url: string;
  label: string;
  destName?: string;
}): QuickAction | null {
  const url = String(opts.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const { isHollowPartnerUrl, looksLikePartnerBookClaim } = require('../../services/affiliate/hollowPartnerUrl') as typeof import('../../services/affiliate/hollowPartnerUrl');
    const landing = unwrapPartnerLandingUrl(url) || url;
    if (isHollowPartnerUrl(landing) && looksLikePartnerBookClaim(opts.label)) {
      return null;
    }
  } catch {
    /* soft */
  }
  return {
    type: 'OPEN_URL',
    label: opts.label.slice(0, 28),
    payload: {
      url,
      destName: opts.destName || opts.label,
    },
  };
}

function unwrapPartnerLandingUrl(url: string): string {
  try {
    const { unwrapPartnerLandingUrl: unwrap } = require('../../services/affiliate/hollowPartnerUrl') as {
      unwrapPartnerLandingUrl: (u: string) => string;
    };
    return unwrap(url);
  } catch {
    return url;
  }
}

export function filterHollowOpenUrlActions(actions: QuickAction[]): QuickAction[] {
  try {
    const { stripUnbackedActions } = require('../../services/concierge/zeroFakeActions') as {
      stripUnbackedActions: (a: QuickAction[]) => QuickAction[];
    };
    return stripUnbackedActions(actions);
  } catch {
    return actions.filter((a) => a.type !== 'OPEN_URL' || Boolean(a.payload.url?.trim()));
  }
}
