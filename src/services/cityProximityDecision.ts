/**
 * Reine Stadtwechsel-Entscheidung (ohne RN).
 * Session-Open = App neu gestartet, nicht aus dem Hintergrund geholt.
 */

export const IN_CITY_KM = 12;
/** Ein Stadtwechsel-Vorschlag, der nächste erst nach einer Stunde. */
export const CITY_SWITCH_PROMPT_COOLDOWN_MS = 60 * 60_000;

export type CityRef = { id?: string | null; name?: string | null };

export type SessionOpenCityDecision =
  | { action: 'skip_same' }
  | { action: 'no_target' }
  | { action: 'prompt'; via: 'catalog' | 'soft' };

function normCityKey(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function identityKey(ref: CityRef): string {
  const id = normCityKey(ref.id).replace(/^soft/, '');
  if (id) return id;
  return normCityKey(ref.name);
}

function cityFamilyKey(ref: CityRef): string {
  const k = identityKey(ref);
  if (k.startsWith('berlin')) return 'berlin';
  return k;
}

export function isSameCity(a: CityRef, b: CityRef): boolean {
  const aId = identityKey(a);
  const bId = identityKey(b);
  if (aId && bId && aId === bId) return true;
  const aName = normCityKey(a.name);
  const bName = normCityKey(b.name);
  return Boolean(aName && bName && aName === bName);
}

export function isSameCityFamily(a: CityRef, b: CityRef): boolean {
  if (isSameCity(a, b)) return true;
  const aFam = cityFamilyKey(a);
  const bFam = cityFamilyKey(b);
  return Boolean(aFam && bFam && aFam === bFam && aFam === 'berlin');
}

export function decideSessionOpenCitySwitch(input: {
  selected: { id: string; name: string };
  selectedKm: number | null;
  nearest: { id: string; name: string; km: number } | null;
  locality: { name: string; km: number } | null;
  inCityKm?: number;
}): SessionOpenCityDecision {
  const inCityKm = input.inCityKm ?? IN_CITY_KM;
  const selected = input.selected;
  const nearest = input.nearest;
  const locality = input.locality;

  if (locality && isSameCityFamily({ name: locality.name }, selected)) {
    return { action: 'skip_same' };
  }

  if (nearest && nearest.km <= inCityKm) {
    if (isSameCityFamily(nearest, selected)) return { action: 'skip_same' };
    return { action: 'prompt', via: 'catalog' };
  }

  if (locality && !isSameCityFamily({ name: locality.name }, selected)) {
    if (
      nearest &&
      isSameCity(nearest, { name: locality.name }) &&
      nearest.km <= inCityKm * 3
    ) {
      return { action: 'prompt', via: 'catalog' };
    }
    return { action: 'prompt', via: 'soft' };
  }

  if (input.selectedKm != null && input.selectedKm <= inCityKm) {
    return { action: 'skip_same' };
  }

  return { action: 'no_target' };
}

/** Global — nicht pro Stadt. Ein Prompt, dann Pause. */
export function shouldHoldCitySwitchPrompt(input: {
  lastPromptAtMs: number;
  nowMs?: number;
  cooldownMs?: number;
}): boolean {
  const last = input.lastPromptAtMs;
  if (!(last > 0)) return false;
  const now = input.nowMs ?? Date.now();
  const cd = input.cooldownMs ?? CITY_SWITCH_PROMPT_COOLDOWN_MS;
  return now - last < cd;
}

/**
 * Distanz zur „gewählten“ Stadt für den Wechsel-Vergleich.
 * Soft-Pin am User (GPS), obwohl die Stadt nicht der Ortsname ist
 * (z. B. Sticky „Athen“ mit Prisdorf-Koordinaten) → nicht als Stadtzentrum werten.
 */
export function pickSelectedCityKm(input: {
  catalogKm: number | null;
  softKm: number | null;
  /** Soft-Zentrum ≈ User, Stadt aber ≠ GPS-Ort */
  softIsGluedAwayFromLocality: boolean;
  fallbackKm: number | null;
}): number | null {
  if (input.catalogKm != null && Number.isFinite(input.catalogKm)) {
    return input.catalogKm;
  }
  if (
    input.softKm != null &&
    Number.isFinite(input.softKm) &&
    !input.softIsGluedAwayFromLocality
  ) {
    return input.softKm;
  }
  if (input.fallbackKm != null && Number.isFinite(input.fallbackKm)) {
    return input.fallbackKm;
  }
  return null;
}
