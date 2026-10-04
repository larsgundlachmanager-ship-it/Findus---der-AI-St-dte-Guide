/**
 * AWIN Click-URL — Node-safe (kein RN/env-Import).
 * App-Pfad: affiliateService.buildAwinClickUrl kann Env-Override legen.
 */

export const AWIN_PUBLISHER_ID_DEFAULT = '3021215';

export function buildAwinClickUrl(opts: {
  merchantId: string;
  destinationUrl: string;
  publisherId?: string;
}): string {
  const fromEnv =
    typeof process !== 'undefined'
      ? String(process.env.EXPO_PUBLIC_AWIN_PUBLISHER_ID || '').trim()
      : '';
  const aff =
    opts.publisherId?.trim() || fromEnv || AWIN_PUBLISHER_ID_DEFAULT;
  const mid = opts.merchantId.trim();
  const ued = encodeURIComponent(opts.destinationUrl.trim());
  return `https://www.awin1.com/cread.php?awinmid=${encodeURIComponent(mid)}&awinaffid=${encodeURIComponent(aff)}&ued=${ued}`;
}
