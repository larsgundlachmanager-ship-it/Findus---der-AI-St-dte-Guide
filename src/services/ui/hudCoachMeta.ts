/**
 * Live-HUD: Coach-/„Tippen“-Beisätze sind interne UX-Hinweise —
 * User sieht sie höchstens 1× (Header-Coach), nie dauerhaft in Card-Meta.
 */

const TIPPEN_LINE =
  /^(?:😊\s*)?(?:Tippen(?:\s*(?:für|→|=|zum).*)?|tippen für .+)$/iu;

const TIPPEN_SUFFIX =
  /\s*[·|]\s*(?:😊\s*)?Tippen(?:\s*(?:für|→|=|zum).*)?$/iu;

/** Entfernt dauerhafte Tippen-/Coach-Suffixe aus HUD-Meta. */
export function stripHudCoachMeta(meta?: string | null): string | undefined {
  if (!meta) return undefined;
  const cleaned = meta
    .split(/\n/)
    .map((line) => line.replace(TIPPEN_SUFFIX, '').trim())
    .filter((line) => line.length > 0 && !TIPPEN_LINE.test(line))
    .join('\n')
    .trim();
  return cleaned || undefined;
}
