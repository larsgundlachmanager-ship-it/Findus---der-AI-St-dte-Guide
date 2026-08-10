/**
 * Empathy Engine (V7.0) — look beyond raw queries.
 * Pharmacy → unwell? doctor? taxi to hotel?
 */

import type { QuickAction } from '../../types/concierge';
import { getCachedUserProfile } from '../userProfileService';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';

const EMPATHY_TYPES = new Set([
  'pharmacy',
  'doctor',
  'hospital',
  'dentist',
]);

export function needsEmpathyFollowUp(placeType: string): boolean {
  return EMPATHY_TYPES.has(placeType.toLowerCase());
}

function hotelHint(): string | null {
  try {
    const hotel = useUserMemoryStore
      .getState()
      .entities?.find((e) => e.type === 'hotel' && e.isConfirmed);
    if (hotel?.name) return hotel.name;
    const anyHotel = useUserMemoryStore
      .getState()
      .entities?.find((e) => e.type === 'hotel');
    if (anyHotel?.name) return anyHotel.name;
  } catch {
    /* ignore */
  }
  try {
    const facts = getCachedUserProfile()?.learnedFacts ?? [];
    for (const f of facts) {
      const m = f.match(/(?:hotel|unterkunft)\s*[:\-]?\s*(.+)/i);
      if (m?.[1]) return m[1].trim().slice(0, 48);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Empathy prefix + optional action chips for health-related discovery.
 */
export function buildEmpathyDiscoveryOverlay(opts: {
  placeType: string;
  label: string;
  navSpeech: string;
}): { speech: string; extraActions: QuickAction[] } {
  if (!needsEmpathyFollowUp(opts.placeType)) {
    return { speech: opts.navSpeech, extraActions: [] };
  }

  const hotel = hotelHint();
  const isPharmacy = opts.placeType === 'pharmacy';
  const empathy = isPharmacy
    ? 'Alles okay bei dir? Brauchst du nur die Apotheke, einen Arzt, oder lieber ein Taxi zur Unterkunft?'
    : 'Alles okay? Soll ich eher zum Arzt/Krankenhaus führen oder ein Taxi organisieren?';

  const extraActions: QuickAction[] = [];
  if (isPharmacy) {
    extraActions.push({
      type: 'SHOW_MORE',
      label: 'Arzt in der Nähe',
      payload: { textPrompt: 'Finde den nächsten Arzt oder die nächste Praxis' },
    });
  }
  if (hotel) {
    extraActions.push({
      type: 'BOOK_UBER',
      label: `Taxi zu ${hotel}`,
      payload: { destName: hotel },
    });
  } else {
    extraActions.push({
      type: 'SHOW_MORE',
      label: 'Taxi zur Unterkunft',
      payload: {
        textPrompt: 'Ich brauche ein Taxi zu meiner Unterkunft',
      },
    });
  }

  return {
    speech: `${empathy} ${opts.navSpeech}`.replace(/\s+/g, ' ').trim(),
    extraActions: extraActions.slice(0, 2),
  };
}

/** Master-prompt empathy rules (always on for Concierge). */
export function empathyEnginePromptBlock(): string {
  return `=== EMPATHY ENGINE (PFLICHT) ===
- Denk 3×: Warum fragt der User? Was ist der versteckte Need? Was hilft am schnellsten?
- Roh-Query reicht nicht. Beispiel Apotheke: Navigation + Mitdenken („Alles okay? Arzt? Taxi zur Unterkunft?“).
- Bei Arzt/Krankenhaus/Zahnarzt: kurz checken, ob Notfall/Taxi nötig — ohne Drama.
- ASR-Fehler nie ansprechen — still den logischsten Intent ausführen.`;
}
