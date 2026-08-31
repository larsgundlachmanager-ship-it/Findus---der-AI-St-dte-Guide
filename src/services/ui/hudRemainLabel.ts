/**
 * HUD-Restzeit: immer Stunden + Minuten, nie nur „1409 Min“.
 */

export function formatHudRemain(remainMs: number): string {
  const totalMin = Math.max(0, Math.round(remainMs / 60_000));
  if (totalMin < 60) return `noch ${totalMin} Min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) return hours === 1 ? 'noch 1 Std' : `noch ${hours} Std`;
  return `noch ${hours} Std ${mins} Min`;
}

export function sameLocalCalendarDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
