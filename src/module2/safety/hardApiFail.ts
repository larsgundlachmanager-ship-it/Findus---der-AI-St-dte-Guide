/**
 * Globaler Hard-API-Fail Handler (Logik-Knoten / Agent-Runner).
 */

import type { AgentResult } from '../types';

export type ApiFailKind =
  | 'maps'
  | 'transit'
  | 'flight'
  | 'places'
  | 'weather'
  | 'llm'
  | 'generic';

const CHARM: Record<ApiFailKind, string> = {
  maps: 'Die Kartenschnittstelle antwortet gerade nicht. Lass uns das in fünf Minuten nochmal prüfen — bis dahin können wir etwas anderes klären.',
  transit:
    'Die Schnittstelle für die Bahndaten antwortet gerade nicht. Lass uns das in fünf Minuten nochmal prüfen, wollen wir bis dahin was anderes machen?',
  flight:
    'Die Flugdaten kommen gerade nicht durch. Ich merke mir deine Frage und wir prüfen das gleich nochmal.',
  places:
    'Die Ortssuche hängt gerade. Ich nutze lokale Alternativen, sobald etwas greifbar ist — oder wir versuchen es in fünf Minuten erneut.',
  weather:
    'Der Wetterdienst meldet sich nicht. Ich arbeite mit dem letzten lokalen Forecast weiter.',
  llm: 'Meine Denk-Verbindung stockt kurz. Deine Frage ist gespeichert — einen Moment, dann versuche ich es erneut.',
  generic:
    'Eine Schnittstelle antwortet gerade nicht. Lass uns das in fünf Minuten nochmal prüfen.',
};

export function charmForApiFail(kind: ApiFailKind): string {
  return CHARM[kind] ?? CHARM.generic;
}

export function agentResultFromApiFail(
  agent: AgentResult['agent'],
  kind: ApiFailKind,
  detail?: string,
): AgentResult {
  return {
    agent,
    ok: false,
    draftText: charmForApiFail(kind),
    bullets: ['Schnittstelle offline', 'In fünf Minuten erneut'].slice(0, 3),
    buttons: [
      {
        id: 'retry_api',
        label: '🔄 Nochmal',
        payload: { kind: 'ui', action: 'retry_api', data: { kind } },
      },
    ],
    error: {
      code: `api_fail_${kind}`,
      message: detail ?? kind,
      retryAfterSec: 300,
    },
  };
}

export async function withHardApiFail<T>(
  kind: ApiFailKind,
  fn: () => Promise<T>,
  timeoutMs = 5000,
): Promise<{ ok: true; value: T } | { ok: false; kind: ApiFailKind; error: unknown }> {
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout_${timeoutMs}`)), timeoutMs),
      ),
    ]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, kind, error };
  }
}
