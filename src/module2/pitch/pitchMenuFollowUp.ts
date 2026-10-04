/**
 * Speisekarte nach Auswahl-Pitch — „vom ersten Restaurant“ → Option 1, nicht Re-Pitch.
 */

const MENU_FOLLOW_RE =
  /\b(speisekarte|menükarte|menuekarte|getränkekarte|getraenkekarte)\b/iu;

const PITCH_SLOT_RE =
  /\b(erste(?:n|s)?|zweite(?:n|s)?|1\.|2\.|option\s*[12]|nummer\s*[12]|🥇|🥈|vom\s+ersten|vom\s+zweiten|dem\s+ersten|dem\s+zweiten|das\s+erste|das\s+zweite)\b/iu;

export function looksLikePitchMenuFollowUp(text: string): boolean {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || !MENU_FOLLOW_RE.test(t)) return false;
  if (PITCH_SLOT_RE.test(t)) return true;
  if (
    /\bzeig(?:e|)\s+mir\b/iu.test(t) &&
    /\b(vom|von\s+dem|vom\s+dem|restaurant|lokal|ort)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\b(speisekarte|menükarte|menuekarte)\b/iu.test(t) &&
    !/\b(wo\s+|empfehl|hunger|zwei\s+option|restaurant\s+für|restaurant\s+fuer)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

function pickPitchSlotIndex(text: string): 0 | 1 {
  if (/\b(zweite|zweiten|2\.|option\s*2|nummer\s*2|🥈|vom\s+zweiten|dem\s+zweiten|das\s+zweite)\b/iu.test(text)) {
    return 1;
  }
  return 0;
}

export type PitchMenuFollowTarget = {
  name: string;
  menuUrl: string | null;
  index: 0 | 1;
};

/** Liest Option 1/2 aus offenem Pitch (Timeline pendingChoice). */
export function resolvePitchOptionVenueForMenu(
  text: string,
): PitchMenuFollowTarget | null {
  if (!looksLikePitchMenuFollowUp(text)) return null;
  const index = pickPitchSlotIndex(text);

  try {
    const { usePlanCalendarUiStore } = require('../timeline/planCalendarUiStore') as {
      usePlanCalendarUiStore: {
        getState: () => {
          pendingChoice: {
            options: Array<{
              id: string;
              title?: string;
              name?: string;
              menuUrl?: string | null;
            }>;
          } | null;
        };
      };
    };
    const pending = usePlanCalendarUiStore.getState().pendingChoice;
    const opt = pending?.options?.[index];
    const name = String(opt?.title || opt?.name || '').trim();
    if (name.length >= 3) {
      return {
        name,
        menuUrl: opt?.menuUrl ?? null,
        index,
      };
    }
  } catch {
    /* soft */
  }

  try {
    const { getShortTerm } = require('../context/shortTermContext') as {
      getShortTerm: () => { lastPlaceName?: string | null };
    };
    const sticky = String(getShortTerm()?.lastPlaceName || '').trim();
    if (sticky.length >= 3 && index === 0) {
      return { name: sticky, menuUrl: null, index: 0 };
    }
  } catch {
    /* soft */
  }

  return null;
}
