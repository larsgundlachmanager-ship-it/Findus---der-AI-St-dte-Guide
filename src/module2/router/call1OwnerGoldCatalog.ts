/**
 * Owner-Gold Katalog für Call-1 Manager — wählbare Hilfen, keine Scripts.
 */

import type { SituationBlueprint } from '../../types/situationBlueprints';
import { getOwnerGoldBlueprints } from '../blueprints/ownerGold';

/** Bundled Gold + remote active blueprints (ohne APK-Release). */
export function collectOwnerGoldCatalog(): SituationBlueprint[] {
  const bundled = getOwnerGoldBlueprints();
  const map = new Map<string, SituationBlueprint>();
  for (const b of bundled) {
    if (b?.situationKey) map.set(b.situationKey, b);
  }
  try {
    const { getCachedSituationBlueprintsSync } = require('../../services/memory/betaSituationQueue') as {
      getCachedSituationBlueprintsSync: () => SituationBlueprint[];
    };
    for (const b of getCachedSituationBlueprintsSync() || []) {
      if (b?.situationKey) map.set(b.situationKey, b);
    }
  } catch {
    /* soft — nur bundled */
  }
  return [...map.values()].slice(0, 48);
}

/** Kompakte Katalogzeile für Call-1 Prompt (Family + expect/avoid + summary). */
export function formatOwnerGoldCatalogForCall1(
  gold: SituationBlueprint[] = collectOwnerGoldCatalog(),
): string {
  if (!gold.length) return '';
  const lines = gold.slice(0, 24).map((b, i) => {
    const exp = (b.expect || []).slice(0, 6).join(',');
    const av = (b.avoid || []).slice(0, 6).join(',');
    const sum = String(b.summary || '').slice(0, 120);
    return `${i + 1}. key=${b.situationKey} family=${b.intentFamily} expect=[${exp}] avoid=[${av}] — ${sum}`;
  });
  return [
    'OWNER_GOLD_KATALOG (Hilfen — wähle 0–N passende keys als selectedGoldKeys; bei unbekannter Frage Auftrag selbst erfinden analog activity/pitch, nie „fehlt → Laber“):',
    ...lines,
  ].join('\n');
}

export function formatSelectedGoldForCall2(
  selectedKeys: string[] | null | undefined,
  gold: SituationBlueprint[] = collectOwnerGoldCatalog(),
): string {
  const keys = (selectedKeys || []).map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return '';
  const set = new Set(keys);
  const picked = gold.filter((b) => set.has(b.situationKey));
  if (!picked.length) return '';
  return [
    'OWNER_GOLD_GEWAEHLT (Struktur — Wortlaut frei):',
    ...picked.map((b) => {
      const exp = (b.expect || []).join(',');
      const av = (b.avoid || []).join(',');
      return `- ${b.intentFamily}: expect=[${exp}] avoid=[${av}] — ${String(b.summary || '').slice(0, 160)}`;
    }),
  ].join('\n');
}
