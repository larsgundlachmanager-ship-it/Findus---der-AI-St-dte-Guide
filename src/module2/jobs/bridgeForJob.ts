/**
 * Job-aware Bridge — menschlich, intent-passend, keine Recherche-Meta-Floskeln.
 * Nur Ack/Motivation/Emotion — nie die Hauptantwort vorwegnehmen.
 */

import type { JobClassification } from './types';
import type { FindusJobId } from './types';

/** Anti-Repeat kurz */
const recent = new Map<string, number>();
const ANTI_MS = 20 * 60_000;

function pick(pool: string[], seed: string): string {
  const now = Date.now();
  for (const [k, t] of recent) {
    if (now - t > ANTI_MS) recent.delete(k);
  }
  const fresh = pool.filter((p) => {
    const last = recent.get(p);
    return !last || now - last > ANTI_MS;
  });
  const list = fresh.length ? fresh : pool;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const line = list[h % list.length]!;
  recent.set(line, now);
  return line;
}

const BY_JOB: Partial<Record<FindusJobId, string[]>> = {
  tonight_live: [
    'Kino-Abend — nice Idee.',
    'Filmabend klingt stark.',
    'Jo, Abendprogramm — ich bin dabei.',
    'Gute Wahl, raus und Leinwand.',
  ],
  dining_hard_match: [
    'Spezifischer Geschmack — mag ich.',
    'Klare Wünsche, dann wird’s gut.',
    'Jo, wir finden den Match.',
    'Anspruchsvoll — passt.',
  ],
  dining_open: [
    'Hunger gecheckt.',
    'Essen — ich leg Optionen vor.',
    'Guter Call, was Leckeres.',
  ],
  activity_sport: [
    'Spikeball-Energie — ich wär gern dabei.',
    'Bewegung draußen — stark.',
    'Sport-Idee — mag ich.',
    'Frischluft-Plan — top.',
  ],
  fact_number: [
    'Glückwunsch erstmal — stark.',
    'Nice, Respekt.',
    'Mega, erste Runde.',
    'Starke Nummer.',
  ],
  emergency_care: [
    'Sofort — Hilfe zuerst.',
    'Alles klar, wir regeln das jetzt.',
    'Kurz und klar zur nächsten Hilfe.',
  ],
  safety_lost: [
    'Mist — wir sortieren das jetzt.',
    'Ok, Schritt für Schritt.',
    'Ruhe — nächster sinnvoller Schritt.',
  ],
  transit_live: [
    'Verbindung — kommt gleich sauber.',
    'ÖPNV, ich sortier das.',
    'Fahrplan-Check, ohne Chaos.',
  ],
  stay_search: [
    'Unterkunft mit Filtern — verstanden.',
    'Hotel-Suche mit deinen Must-Haves.',
    'Schlafplatz — wir filtern hart.',
  ],
  weather_outfit: [
    'Outfit-Check — sinnvoll.',
    'Wetter und Kleidung, klar.',
    'Gut, dass du vorher fragst.',
  ],
  nightlife_vibe: [
    'Nachtleben — gute Energie.',
    'Party-Plan — ich bin dran.',
    'Abend raus — mag ich.',
  ],
  museum_theme: [
    'Theme-Museum — spannend.',
    'Gute Spur für die Ausstellung.',
    'Kultur-Stop — jo.',
  ],
  sight_recommend: [
    'Entdecken — ich hab Ideen.',
    'Stadt zeigen — gerne.',
    'Gute Frage für den Tag.',
  ],
  day_plan_budget: [
    'Kombi-Plan — ich bau den.',
    'Mehrere Wünsche, ein Ablauf.',
    'Tagespuzzle — kommt.',
  ],
  nav_route: [
    'Route klar machen.',
    'Weg — ich nehm den schnellsten sinnvollen.',
  ],
  friction_now: [
    'Kurz und nah — kommt.',
    'Praktisches zuerst.',
  ],
  parking_ev: [
    'Parken/Laden — check.',
    'Stellplatz — ich sortier Optionen.',
  ],
  mobility_rent: [
    'Leihsachen — gute Idee.',
    'Mobilität vor Ort — jo.',
  ],
  taxi_rideshare: [
    'Taxi/Uber — klar.',
    'Fahrdienst — ich check Optionen.',
  ],
  poi_identify: [
    'Spannende Frage.',
    'Was steht da — hol ich.',
  ],
  shopping_errand: [
    'Erledigung — ich find den Spot.',
    'Praktisch — kommt.',
  ],
  luggage_practical: [
    'Gepäck-Spot — gleich.',
    'Zwischenlagern — sinnvoll.',
  ],
  smalltalk_general: [
    'Hey — ich bin da.',
    'Moin.',
    'Jo, erzähl.',
  ],
};

/** Sieg/Turnier → cheer, auch wenn Job fact_number */
function cheerOverride(userText: string): string | null {
  if (
    /\b(gewonnen|gewinn|sieg|geschafft|erste\s+runde|turnier)\b/iu.test(
      userText,
    )
  ) {
    return pick(
      [
        'Mega, Glückwunsch — stark.',
        'Nice, erste Runde — Respekt.',
        'Krass, Glückwunsch!',
        'Super, das freut mich.',
      ],
      userText,
    );
  }
  return null;
}

/** Spikeball/Sport motivation ohne die spätere Empfehlung zu spoilern */
function sportOverride(userText: string): string | null {
  if (/\bspikeball\b/iu.test(userText)) {
    return pick(
      [
        'Spikeball — richtig geile Sportart.',
        'Spikeball bei dem Wetter — ich wär gern mit dabei.',
        'Spikeball-Plan — mag ich total.',
        'Spikeball, nice — frische Luft pur.',
      ],
      userText,
    );
  }
  return null;
}

/**
 * Kurze Bridge-Zeile für Job (max ~12 Wörter Ziel).
 */
export function bridgeLineForJob(
  classification: JobClassification,
  userText: string,
): string {
  const cheer = cheerOverride(userText);
  if (cheer) return cheer;
  const sport = sportOverride(userText);
  if (sport && classification.jobId === 'activity_sport') return sport;

  const pool =
    BY_JOB[classification.jobId] ??
    BY_JOB.sight_recommend ??
    ['Alles klar.'];
  return pick(pool, `${classification.jobId}|${userText}`);
}

/**
 * Fire-and-forget Bridge sprechen (Zero-Latency vor Router).
 */
export function speakJobBridgeFireAndForget(
  classification: JobClassification,
  userText: string,
): string | null {
  const line = bridgeLineForJob(classification, userText).trim();
  if (!line || line.length < 3) return null;

  void (async () => {
    try {
      const { getCachedUserProfile } = await import(
        '../../services/userProfileService'
      );
      const { getVoiceSettingsForTour } = await import(
        '../../services/ttsService'
      );
      const { speakRuntimeText } = await import('../../runtime/speechModule');
      const { latencyMark } = await import(
        '../../services/debug/latencyTiming'
      );
      latencyMark('ack', `job:${classification.jobId}`);
      const cached = getCachedUserProfile();
      const voice = cached
        ? { voiceId: cached.voiceId, speechRate: 1 as const }
        : await getVoiceSettingsForTour();
      await speakRuntimeText(
        line,
        { voiceId: voice.voiceId, speechRate: voice.speechRate },
        { priority: 'system', deliveryKind: 'assistant' },
      );
    } catch {
      /* soft */
    }
  })();

  return line;
}
