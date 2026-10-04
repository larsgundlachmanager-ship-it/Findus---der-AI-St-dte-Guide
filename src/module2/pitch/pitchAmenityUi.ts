/**
 * Phase 8 — Amenity/Single-Place UI: Nav+Maps, keine Timeline-Pflicht.
 */

import type { PitchKind } from './types';
import { isAmenityPlaceFindQuery } from '../mission/amenityPlaceFind';

/** Single-Place Amenity (Basketball, TT, Trinkwasser…) — live_split, nie Timeline-Pflicht. */
export function isAmenitySinglePlacePitch(opts: {
  kind?: PitchKind | string | null;
  text?: string | null;
  mustHaves?: string[] | null;
  wishes?: Array<{ text?: string; kind?: string }> | null;
}): boolean {
  const text = String(opts.text || '').trim();
  if (text && isAmenityPlaceFindQuery(text)) return true;
  const blob = [
    text,
    ...(opts.mustHaves ?? []),
    ...(opts.wishes ?? []).map((w) => `${w.kind || ''} ${w.text || ''}`),
  ]
    .join(' ')
    .toLowerCase();
  if (
    /\b(basketball|tischtennis|trinkwasser|trinkbrunnen|grillplatz|picknick|briefkasten|packstation|apotheke|geldautomat|ladestation|freibad|strandbad|badestelle|volleyball|skate)\b/u.test(
      blob,
    )
  ) {
    return true;
  }
  if (opts.kind === 'generic') {
    return /\b(basketball|tischtennis|trinkwasser|grill|picknick|briefkasten|packstation|toilette|apotheke|geldautomat|ladestation|freibad|badestelle)\b/u.test(
      blob,
    );
  }
  return false;
}

/**
 * Layout-SSOT: Amenity → immer live_split (Order-Timeline ignorieren).
 * Tour/Plan explizit → timeline_stack. Sonst Request/Defaults.
 */
export function resolvePitchUiLayout(opts: {
  kind: PitchKind;
  text?: string | null;
  mustHaves?: string[] | null;
  wishes?: Array<{ text?: string; kind?: string }> | null;
  requested?: 'live_split' | 'timeline_stack' | null;
  orderOpenCalendar?: boolean;
  orderOpenTimeline?: boolean;
}): 'live_split' | 'timeline_stack' {
  if (
    isAmenitySinglePlacePitch({
      kind: opts.kind,
      text: opts.text,
      mustHaves: opts.mustHaves,
      wishes: opts.wishes,
    })
  ) {
    return 'live_split';
  }
  if (opts.orderOpenCalendar || opts.orderOpenTimeline) {
    return 'timeline_stack';
  }
  if (opts.requested === 'timeline_stack' || opts.requested === 'live_split') {
    return opts.requested;
  }
  if (opts.kind === 'food' || opts.kind === 'bar') return 'live_split';
  return 'live_split';
}
