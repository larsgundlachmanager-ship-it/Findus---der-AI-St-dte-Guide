/**
 * Route-Hindernis-Puffer (Bahnübergang / Brücke / Treppe).
 * SSOT für Leave-by & ETA — reine Mathematik, keine I/O.
 */

export type RouteObstacleKind = 'crossing' | 'bridge' | 'stairs';

export type RouteObstacleHit = {
  kind: RouteObstacleKind;
  lat: number;
  lng: number;
  /** Entlang der Route vom Start (m), wenn bekannt */
  alongM?: number | null;
  label?: string | null;
};

export type RouteObstacleSummary = {
  crossings: number;
  bridges: number;
  stairs: number;
  /** Extra-Minuten für Leave-by / ETA */
  bufferMin: number;
  hits: RouteObstacleHit[];
};

/**
 * Bahnübergänge skaliert:
 * 1. → +5 · 2. → +3 · ab 3. → jeweils +1
 */
export function crossingBufferMinutes(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return 0;
  let total = 0;
  for (let i = 1; i <= n; i++) {
    if (i === 1) total += 5;
    else if (i === 2) total += 3;
    else total += 1;
  }
  return total;
}

/**
 * Treppen: pauschal +1 Min sobald mindestens eine auf der Route liegt.
 * Brücken: 0 Min (nur Audio).
 */
export function summarizeRouteObstacles(
  hits: RouteObstacleHit[],
): RouteObstacleSummary {
  let crossings = 0;
  let bridges = 0;
  let stairs = 0;
  for (const h of hits) {
    if (h.kind === 'crossing') crossings += 1;
    else if (h.kind === 'bridge') bridges += 1;
    else if (h.kind === 'stairs') stairs += 1;
  }
  const bufferMin =
    crossingBufferMinutes(crossings) + (stairs > 0 ? 1 : 0);
  return { crossings, bridges, stairs, bufferMin, hits };
}

export function formatObstacleBufferHint(summary: RouteObstacleSummary): string {
  const parts: string[] = [];
  if (summary.crossings > 0) {
    parts.push(
      `${summary.crossings} Bahnübergang${summary.crossings === 1 ? '' : 'änge'} (+${crossingBufferMinutes(summary.crossings)} Min)`,
    );
  }
  if (summary.stairs > 0) {
    parts.push(`Treppen (+1 Min)`);
  }
  if (summary.bridges > 0) {
    const foot = summary.hits.filter(
      (h) =>
        h.kind === 'bridge' &&
        /fu[ßss]?g[äa]ngerbr[uü]cke|fussgaengerbruecke/i.test(h.label || ''),
    ).length;
    if (foot > 0 && foot === summary.bridges) {
      parts.push(
        `${foot} Fußgängerbrücke${foot === 1 ? '' : 'n'} (Ansage, kein Zeitpuffer)`,
      );
    } else if (foot > 0) {
      parts.push(
        `${summary.bridges} Brücke${summary.bridges === 1 ? '' : 'n'} inkl. ${foot} Fußgängerbrücke${foot === 1 ? '' : 'n'} (Ansage, kein Zeitpuffer)`,
      );
    } else {
      parts.push(
        `${summary.bridges} Brücke${summary.bridges === 1 ? '' : 'n'} (Ansage, kein Zeitpuffer)`,
      );
    }
  }
  if (!parts.length) return '';
  return `Routen-Puffer: ${parts.join(' · ')} → +${summary.bufferMin} Min.`;
}
