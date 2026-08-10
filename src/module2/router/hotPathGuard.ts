/**
 * Hot-Path Guard — Fragen gehören dem Concierge-Manager, nicht Legacy-Routern.
 */

/** Explizites Merken / Hotel-Confirm — darf Memory-Pfad. */
export function looksLikeExplicitMemoryUtterance(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return (
    /\b(merk\s+dir|merke\s+dir|erinner\s+mich|erinnerst\s+du|was\s+weißt\s+du\s+noch|lösch\s+das|vergiss)\b/iu.test(
      t,
    ) ||
    /\b(mein\s+hotel\s+ist|hotel\s+heißt|als\s+hotel\s+speichern)\b/iu.test(t)
  );
}

/** Abendziel / Blaupause — nicht Modul-5, nicht Legacy-Intent-LLM. */
export function looksLikeManagerBlueprintUtterance(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (
    /\b(grill|grillen|bbq|picknick)\b/iu.test(t) &&
    !/\b(tagesplan|durchplanen|und\s+dann.{0,30}theater)\b/iu.test(t)
  ) {
    return true;
  }
  if (
    /\b(kino|cinema|filmtheater|kinoprogramm|ins\s+kino|film\s+schauen)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(croque|burger|pizza|restaurant|essen\s+gehen|wo\s+essen)\b/iu.test(t) &&
    !/\b(und\s+dann|danach).{0,40}\b(museum|theater|hotel)\b/iu.test(t)
  ) {
    return true;
  }
  if (/\b(was\s+geht\s+(heute|morgen)|events?\s+heute|party\s+heute)\b/iu.test(t)) {
    return true;
  }
  if (
    /\b(was\s+ist\s+das|was\s+für\s+(ein\s+)?gebäude|welches\s+gebäude)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Mic: diese Fragen gehen direkt an runModule2Pipeline (Manager). */
export function shouldSkipLegacyIntentSteal(text: string): boolean {
  return looksLikeManagerBlueprintUtterance(text);
}
