/**
 * Situation Gate — 50 Situationen (5 Kategorien), Priorität, Stress → Spleens aus.
 * Kompakter Prompt-Block für Master + Live-TTS-Emotion.
 */

import type { UserProfile } from '../../types/userProfile';
import type { SpleenId, VibeToneId } from '../../constants/personalityMatrix';
import { useFinnusStore } from '../../store/useFinnusStore';

export type SituationCategory =
  | 'safety_urgency'
  | 'mobility_time'
  | 'social_mood'
  | 'environment'
  | 'tour_content';

export type SituationId =
  | 'toilet_urgent'
  | 'medical_help'
  | 'panic_lost'
  | 'crime_unsafe'
  | 'battery_critical'
  | 'survival_low_battery'
  | 'hurry_deadline'
  | 'missed_connection'
  | 'weather_danger'
  | 'child_separated'
  | 'nav_active'
  | 'nav_lost_offroute'
  | 'transit_now'
  | 'flight_gate'
  | 'parking_spot'
  | 'wheelchair_route'
  | 'bike_mode'
  | 'long_walk_tired'
  | 'checkout_hotel'
  | 'late_night_return'
  | 'smalltalk_chat'
  | 'lonely_solo'
  | 'date_romantic'
  | 'family_kids'
  | 'group_friends'
  | 'celebration_mood'
  | 'frustrated_user'
  | 'grateful_user'
  | 'humor_banter'
  | 'deep_personal'
  | 'rain_now'
  | 'heat_wave'
  | 'cold_wind'
  | 'sunset_moment'
  | 'night_quiet'
  | 'crowded_noise'
  | 'indoor_museum'
  | 'nature_calm'
  | 'ferry_crossing'
  | 'beach_relax'
  | 'poi_arrival_major'
  | 'poi_arrival_minor'
  | 'approach_teaser'
  | 'history_deep'
  | 'gastro_hungry'
  | 'gastro_named_venue'
  | 'planning_multi_stop'
  | 'shopping_todo'
  | 'photo_moment'
  | 'accessibility_need'
  | 'default_explore';

type SituationDef = {
  id: SituationId;
  category: SituationCategory;
  /** höher = dringender */
  priority: number;
  /** true → Spleens unterdrücken */
  stress: boolean;
};

export const SITUATION_CATALOG: readonly SituationDef[] = [
  { id: 'toilet_urgent', category: 'safety_urgency', priority: 95, stress: true },
  { id: 'medical_help', category: 'safety_urgency', priority: 98, stress: true },
  { id: 'panic_lost', category: 'safety_urgency', priority: 92, stress: true },
  { id: 'crime_unsafe', category: 'safety_urgency', priority: 90, stress: true },
  { id: 'battery_critical', category: 'safety_urgency', priority: 88, stress: true },
  { id: 'survival_low_battery', category: 'safety_urgency', priority: 85, stress: true },
  { id: 'hurry_deadline', category: 'safety_urgency', priority: 87, stress: true },
  { id: 'missed_connection', category: 'safety_urgency', priority: 86, stress: true },
  { id: 'weather_danger', category: 'safety_urgency', priority: 84, stress: true },
  { id: 'child_separated', category: 'safety_urgency', priority: 97, stress: true },
  { id: 'nav_active', category: 'mobility_time', priority: 55, stress: false },
  { id: 'nav_lost_offroute', category: 'mobility_time', priority: 75, stress: true },
  { id: 'transit_now', category: 'mobility_time', priority: 70, stress: false },
  { id: 'flight_gate', category: 'mobility_time', priority: 80, stress: true },
  { id: 'parking_spot', category: 'mobility_time', priority: 45, stress: false },
  { id: 'wheelchair_route', category: 'mobility_time', priority: 65, stress: false },
  { id: 'bike_mode', category: 'mobility_time', priority: 40, stress: false },
  { id: 'long_walk_tired', category: 'mobility_time', priority: 60, stress: false },
  { id: 'checkout_hotel', category: 'mobility_time', priority: 50, stress: false },
  { id: 'late_night_return', category: 'mobility_time', priority: 48, stress: false },
  { id: 'smalltalk_chat', category: 'social_mood', priority: 25, stress: false },
  { id: 'lonely_solo', category: 'social_mood', priority: 30, stress: false },
  { id: 'date_romantic', category: 'social_mood', priority: 35, stress: false },
  { id: 'family_kids', category: 'social_mood', priority: 40, stress: false },
  { id: 'group_friends', category: 'social_mood', priority: 32, stress: false },
  { id: 'celebration_mood', category: 'social_mood', priority: 28, stress: false },
  { id: 'frustrated_user', category: 'social_mood', priority: 72, stress: true },
  { id: 'grateful_user', category: 'social_mood', priority: 22, stress: false },
  { id: 'humor_banter', category: 'social_mood', priority: 26, stress: false },
  { id: 'deep_personal', category: 'social_mood', priority: 34, stress: false },
  { id: 'rain_now', category: 'environment', priority: 52, stress: false },
  { id: 'heat_wave', category: 'environment', priority: 50, stress: false },
  { id: 'cold_wind', category: 'environment', priority: 48, stress: false },
  { id: 'sunset_moment', category: 'environment', priority: 30, stress: false },
  { id: 'night_quiet', category: 'environment', priority: 38, stress: false },
  { id: 'crowded_noise', category: 'environment', priority: 58, stress: false },
  { id: 'indoor_museum', category: 'environment', priority: 42, stress: false },
  { id: 'nature_calm', category: 'environment', priority: 28, stress: false },
  { id: 'ferry_crossing', category: 'environment', priority: 44, stress: false },
  { id: 'beach_relax', category: 'environment', priority: 26, stress: false },
  { id: 'poi_arrival_major', category: 'tour_content', priority: 45, stress: false },
  { id: 'poi_arrival_minor', category: 'tour_content', priority: 35, stress: false },
  { id: 'approach_teaser', category: 'tour_content', priority: 38, stress: false },
  { id: 'history_deep', category: 'tour_content', priority: 40, stress: false },
  { id: 'gastro_hungry', category: 'tour_content', priority: 62, stress: false },
  { id: 'gastro_named_venue', category: 'tour_content', priority: 58, stress: false },
  { id: 'planning_multi_stop', category: 'tour_content', priority: 48, stress: false },
  { id: 'shopping_todo', category: 'tour_content', priority: 46, stress: false },
  { id: 'accessibility_need', category: 'tour_content', priority: 68, stress: false },
  { id: 'default_explore', category: 'tour_content', priority: 10, stress: false },
];

let lastUserTextForSituation = '';

export function noteUserTextForSituation(text: string): void {
  lastUserTextForSituation = text.trim().slice(0, 400);
}

export type SituationContext = {
  id: SituationId;
  category: SituationCategory;
  priority: number;
  stress: boolean;
  promptBlock: string;
};

function def(id: SituationId): SituationDef {
  return SITUATION_CATALOG.find((s) => s.id === id)!;
}

/** Harte Heuristiken — überschreiben LLM-Kontext. */
export function resolveSituationHeuristic(input: {
  userText?: string;
  batteryPct?: number | null;
  navActive?: boolean;
  profile?: UserProfile | null;
}): SituationId {
  const t = (input.userText ?? lastUserTextForSituation).toLowerCase();

  if (/\b(toilette|wc|klo|restroom|badezimmer)\b/iu.test(t)) {
    return 'toilet_urgent';
  }
  if (/\b(panik|hilfe!|notfall|112|herzinfarkt|bewusstlos|blut)\b/iu.test(t)) {
    return 'medical_help';
  }
  if (/\b(panisch|totale\s+panik|ich\s+hab\s+angst)\b/iu.test(t)) {
    return 'panic_lost';
  }
  if (typeof input.batteryPct === 'number' && input.batteryPct > 0) {
    if (input.batteryPct < 10) return 'battery_critical';
    if (input.batteryPct < 15) return 'survival_low_battery';
  }
  if (
    /\b(schnell|eilig|beeil|sofort|knapp|deadline|schaff\s+ich\s+noch|zu\s+spät)\b/iu.test(
      t,
    )
  ) {
    return 'hurry_deadline';
  }
  if (input.navActive) return 'nav_active';
  if (/\b(hungrig|essen|restaurant|frühstück|mittag|abendessen|imbiss)\b/iu.test(t)) {
    return 'gastro_hungry';
  }
  if (input.profile?.travelParty === 'family') return 'family_kids';
  if (input.profile?.freeChatOk && /\b(wie\s+geht|langweilig|quatsch|smalltalk)\b/iu.test(t)) {
    return 'smalltalk_chat';
  }
  return 'default_explore';
}

export function filterSpleensForStress(
  spleens: SpleenId[],
  ctx: SituationContext,
): SpleenId[] {
  if (ctx.stress || ctx.priority >= 85) return [];
  if (ctx.priority >= 70) {
    return spleens.filter(
      (s) => s !== 'giggler' && s !== 'catchphrase' && s !== 'animal_distract',
    );
  }
  return spleens;
}

function situationHint(id: SituationId): string {
  const hints: Partial<Record<SituationId, string>> = {
    toilet_urgent: 'Dringend: nächste Toilette, kurz, kein Geplänkel.',
    medical_help: 'Ruhig, klar, 112/Hilfe — keine Witze.',
    panic_lost: 'Beruhigen, konkreter nächster Schritt.',
    battery_critical: 'Akku niedrig: kurz, Audio-first, Powerbank/Steckdose mit Route anbieten.',
    hurry_deadline: 'Tempo hoch, keine Extras — Zeit zuerst.',
    nav_active: 'Navigation läuft: knapp halten, nicht unterbrechen.',
    gastro_hungry: 'Essen jetzt — konkrete Optionen, positiv.',
    smalltalk_chat: 'Warm plaudern — Struktur locker, User führen lassen.',
    default_explore: 'Normaler Explore-Modus.',
  };
  return hints[id] ?? 'Situation beachten — Ton anpassen, nichts erfinden.';
}

export function resolveSituationContext(input?: {
  userText?: string;
  batteryPct?: number | null;
  profile?: UserProfile | null;
}): SituationContext {
  const store = useFinnusStore.getState();
  const id = resolveSituationHeuristic({
    userText: input?.userText,
    batteryPct: input?.batteryPct,
    navActive: store.navActive,
    profile: input?.profile,
  });
  const d = def(id);
  const promptBlock = `=== SITUATION (Gate) ===
- Aktiv: ${d.id} (Priorität ${d.priority}${d.stress ? ', STRESS — Spleens/Drama zurück' : ''})
- Hinweis: ${situationHint(id)}
- Bei Stress: keine Catchphrases, kein Gekicher, kein Snack-Outro — nur Lösung.`;

  return {
    id,
    category: d.category,
    priority: d.priority,
    stress: d.stress,
    promptBlock,
  };
}

export function buildSituationGatePromptBlock(
  ctx: SituationContext = resolveSituationContext(),
): string {
  return ctx.promptBlock;
}

export function vibeToneForEmotion(vibe: VibeToneId | null | undefined): {
  baseEmotion: string;
  speed: number;
} {
  switch (vibe) {
    case 'mystic':
      // Podcast/True-Crime: Spannung über Ton — nicht Schnecken-Tempo
      return { baseEmotion: 'curious', speed: 1.08 };
    case 'nostalgic':
      return { baseEmotion: 'reflective', speed: 1.0 };
    case 'humorous':
      return { baseEmotion: 'happy', speed: 1.05 };
    case 'sarcastic':
      return { baseEmotion: 'neutral', speed: 1.02 };
    case 'serious':
      return { baseEmotion: 'neutral', speed: 1.0 };
    default:
      return { baseEmotion: 'content', speed: 1.0 };
  }
}
