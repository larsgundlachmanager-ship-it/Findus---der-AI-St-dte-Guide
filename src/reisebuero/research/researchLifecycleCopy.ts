/** Pure Copy-Helfer für Fertig-Push (kein RN). */

export function resolveResearchNotifyFirstName(
  profileFirstName?: string | null,
): string | null {
  const name = (profileFirstName ?? '').trim().split(/\s+/)[0];
  if (!name || name.length < 2) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function buildResearchDoneBody(firstName?: string | null): string {
  const name = resolveResearchNotifyFirstName(firstName);
  return name ? `Hey ${name}, ich bin fertig.` : 'Hey, ich bin fertig.';
}
