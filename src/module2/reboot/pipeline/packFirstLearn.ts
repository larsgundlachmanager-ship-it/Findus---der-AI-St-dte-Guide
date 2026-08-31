/**
 * Pack zuerst; Lücke → Research; belegter Stadt-Treffer zurück ins Pack.
 * Weltwissen nie schreiben.
 */

import { isWorldFactUtterance, shouldWriteCityPack } from './worldFactGuard';

export type PackLearnPolicy = 'use_pack' | 'research' | 'write_pack' | 'skip_world';

export function packLearnPolicy(opts: {
  userText: string;
  packHit: boolean;
  researchedHit: boolean;
  placeName?: string | null;
}): PackLearnPolicy {
  if (isWorldFactUtterance(opts.userText)) return 'skip_world';
  if (opts.packHit) return 'use_pack';
  if (
    opts.researchedHit &&
    shouldWriteCityPack({ name: opts.placeName ?? '', userText: opts.userText })
  ) {
    return 'write_pack';
  }
  return 'research';
}
