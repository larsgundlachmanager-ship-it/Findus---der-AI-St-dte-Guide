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

/** Küchen-Timer: Sekunden-Countdown `M:SS` / `H:MM:SS`. */
export function formatTimerCountdown(remainMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
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
