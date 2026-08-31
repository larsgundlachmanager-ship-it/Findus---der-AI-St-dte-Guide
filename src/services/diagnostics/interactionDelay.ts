/**
 * Tap → nächster sichtbarer Frame. Kein Abbruch — nur Messung.
 * >16 ms = ein Ruckler; >200 ms fühlt sich tot an.
 */

export type InteractionDelaySample = {
  label: string;
  ms: number;
  atMs: number;
};

const MAX = 24;
const samples: InteractionDelaySample[] = [];
const pending = new Map<string, number>();

function push(label: string, ms: number): void {
  samples.push({ label, ms, atMs: Date.now() });
  if (samples.length > MAX) samples.shift();
  if (__DEV__ && ms >= 200) {
    console.warn(`[ui-delay] ${label} ${Math.round(ms)}ms`);
  }
}

/** Start: User hat getippt. */
export function noteUiTap(label: string): void {
  pending.set(label, Date.now());
  requestAnimationFrame(() => {
    const t0 = pending.get(label);
    if (t0 == null) return;
    push(`${label}:frame`, Date.now() - t0);
  });
}

/** Overlay/Chrome ist sichtbar. */
export function noteUiVisible(label: string): void {
  const t0 = pending.get(label);
  pending.delete(label);
  if (t0 == null) return;
  push(`${label}:visible`, Date.now() - t0);
}

export function getInteractionDelaySnapshot(): {
  last: InteractionDelaySample[];
  p95Ms: number | null;
} {
  if (samples.length === 0) return { last: [], p95Ms: null };
  const sorted = [...samples].map((s) => s.ms).sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * 0.95),
  );
  return { last: [...samples], p95Ms: sorted[idx] ?? null };
}
