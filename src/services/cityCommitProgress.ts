/**
 * Stadtwechsel-Commit-Fortschritt (Home-HUD).
 * Sofort nach Speichern/Wechsel — User sieht: Klick angekommen, Historie lädt.
 * Progress nur vorwärts — nie zurück auf 1 % nach „fertig“.
 */

export type CityCommitProgress = {
  cityId: string;
  cityName: string;
  /** 0..1 — 1 = Historie bereit / Speech startet */
  progress: number;
  phase: 'welcome' | 'done';
} | null;

type Listener = (p: CityCommitProgress) => void;

let current: CityCommitProgress = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
/** Nach done kurz keine neuen begins — verhindert 100 % → 8 % Flicker. */
let suppressBeginUntilMs = 0;
const listeners = new Set<Listener>();

export function getCityCommitProgress(): CityCommitProgress {
  return current;
}

export function subscribeCityCommitProgress(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(current);
    } catch {
      /* soft */
    }
  }
}

function clearClearTimer(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

/** Sync — vor Settings-Close, damit der Balken sofort da ist. */
export function beginCityCommitProgress(opts: {
  cityId: string;
  cityName: string;
}): void {
  const cityId = String(opts.cityId || '').trim().toLowerCase();
  if (!cityId) return;
  if (Date.now() < suppressBeginUntilMs) return;

  const name = String(opts.cityName || cityId).trim() || cityId;

  // Schon aktiv für dieselbe Stadt: Progress nie zurücksetzen.
  if (current && current.cityId === cityId) {
    if (current.phase === 'done') return;
    current = {
      ...current,
      cityName: name || current.cityName,
    };
    emit();
    return;
  }

  clearClearTimer();
  current = {
    cityId,
    cityName: name,
    progress: 0.08,
    phase: 'welcome',
  };
  emit();
}

export function setCityCommitProgress(ratio: number): void {
  if (!current) return;
  if (current.phase === 'done') return;
  const progress = Math.max(current.progress, Math.min(1, ratio));
  current = {
    ...current,
    progress,
    phase: progress >= 1 ? 'done' : 'welcome',
  };
  emit();
}

export function endCityCommitProgress(): void {
  if (!current) return;
  clearClearTimer();
  current = { ...current, progress: 1, phase: 'done' };
  emit();
  const cityId = current.cityId;
  // Kein zweites begin, das den Balken wieder auf 8 % zieht.
  suppressBeginUntilMs = Date.now() + 900;
  clearTimer = setTimeout(() => {
    clearTimer = null;
    if (current?.cityId === cityId && current.phase === 'done') {
      current = null;
      emit();
    }
  }, 520);
}

export function clearCityCommitProgress(): void {
  clearClearTimer();
  current = null;
  emit();
}
