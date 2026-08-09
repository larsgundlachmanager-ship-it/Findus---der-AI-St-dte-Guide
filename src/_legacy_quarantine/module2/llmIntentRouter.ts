/**
 * LLM-Intent-Router — versteht die User-Absicht (kein Regex-Primary).
 * Muss IMMER genau einen Agenten wählen. Smalltalk = echter Chat-Agent, kein Menü-Fallback.
 * Ortsbezug: unabhängig vom City-Pack (Nachbarstadt / Sidequest ok).
 * Mapping-Beispiele sind abstrakte Blaupausen — nie ortsgebunden.
 */

import {
  generateGeminiText,
  hasGeminiApiKey,
} from '../../services/geminiService';
import type { AgentIntent } from '../types';
import { bridgingLineForIntent } from './taskSplitter';
import {
  FINDUS_DYNAMIC_STRUCTURE_DOCTRINE,
  FINDUS_FEW_SHOT_DISCLAIMER,
} from '../../services/concierge/findusResponsePolicy';

export type IntentRoute = {
  intent: AgentIntent;
  city: string | null;
  subject: string | null;
  bridgingLine: string;
  confidence: number;
};

const INTENTS: AgentIntent[] = [
  'emergency',
  'gastro',
  'mobility',
  'knowledge',
  'booking',
  'umwelt',
  'system',
  'memory',
  'translation',
  'trigger',
  'deep_research',
  'smalltalk',
];

const SYSTEM = `Du bist der Intent-Router für Findus (Reise-Assistent).
Wähle GENAU EINEN intent für die User-Nachricht.
Erzeuge zusätzlich eine kurze bridging-Zeile (Ack vorm Ergebnis) — frei formuliert, intent-passend, keine feste Phrase.
Max ~12 Wörter. Emotional anerkennen wenn passend (Sieg, gute Idee rauszugehen), dann Richtung der Recherche — nie die volle Antwort vorwegnehmen.

${FINDUS_DYNAMIC_STRUCTURE_DOCTRINE}

Intents:
- emergency: Notfall, Arzt, Apotheke, Toilette dringend
- umwelt: Wetter, Kleidung, anziehen, Outfit, Jacke/Hose, kalt/warm — AUCH wenn „heute Abend raus“ dabei steht. Nicht als Plan missverstehen.
- gastro: Essen, Restaurant, Hunger, Durst, Speisekarte, Cuisine-Suche, Tisch reservieren; Anruf beim Restaurant wenn Gastro-Kontext (auch „da anrufen“ nach Gastro-Turn); „was auf der Karte/Speisekarte empfehlen“ / Gerichte wählen bei bekanntem Restaurant = gastro (Gerichte), NICHT knowledge/Stadtplan
- booking: Unterkunft, Hotel, Zimmer, Übernachtung, Ferienwohnung, Gepäck/Bounce, Ticket buchen — NICHT Tischreservierung im Restaurant
- mobility: Navigation, Route, Weg, bring mich zu, Bahn/Bus zur Anfahrt
- knowledge: Geschichte/Info zu Ort/Objekt, „mehr zu …“, „was ist das“, Tagesplan-Ideen, Multi-Stop-Vorschläge, „was soll ich machen“, Wanderweg-/Fahrradweg-Vorschläge — NICHT Speisekarten-Gerichte empfehlen
- umwelt: Wetter, Kleidung, anziehen, kalt/warm
- trigger: Erinnerung, Alarm, Timer, Wecker, Powernap / Nickerchen mit Dauer
- memory: „weißt du noch“, gestern, gespeicherte Erlebnisse
- translation: übersetzen
- system: App-Einstellungen, Lautstärke, Stimme, Taschenlampe, App-Hilfe / Selbsterklärung
- deep_research: aufwändige aktuelle Recherche
- smalltalk: plaudern, Begrüßung, Scherzen — NUR wenn wirklich Smalltalk, sonst lieber knowledge/gastro/…

Ortsregeln (universell):
- Modul 2 ist UNABHÄNGIG vom ausgewählten Städtedatensatz / City-Pack.
- city = Ort, den der User meint (auch Nachbarstadt), ODER null wenn „hier“ / kein Ort genannt.
- Niemals eine Pack-Stadt erfinden, nur weil sie im Profil steht.

ABSTRAKTE MAPPING-BLAUPAUSEN (Struktur der Zuordnung — keine Orts-/Wortwahl-Vorlage):
- „[Venue-Typ] in [genannte Stadt]“ → passender Intent + city=genannte Stadt (auch wenn Pack-Stadt anders ist).
- „Was gibt's hier zu [Bedarf]?“ → Intent aus Bedarf, city=null.
- „mehr zu [Objekt]“ → knowledge, subject=[Objekt].
- Unterkunft/Hotel brauchen → booking.
- Tisch reservieren / Restaurant anrufen / „kann ich bei X anrufen“ → gastro (nie Stay22/Hotel).
- Erinnern/Wecken mit Zeit → trigger.
- Stimme/Taschenlampe/Einstellungen/„Was kannst du?“ → system.
- Plattdeutsch/Dialekt/Tippfehler: trotzdem sinnvoll zuordnen.
- Nie „unknown“. Im Zweifel: knowledge wenn Ort/Objekt, sonst smalltalk.
- Kino/Film/Vorstellung/Kinoprogramm (auch „führ mich zum Kino“) → knowledge (Spielzeiten + nahe Kinos), NICHT mobility, NICHT planning/Timeline.
- Wanderweg / Fahrradweg / Radroute / „wo kann ich wandern/radeln“ → knowledge (Weg vorschlagen + Nav zum Einstieg), NICHT mobility ohne konkreten Zielnamen, NICHT leere Timeline.
- „will X km / X Stunden unterwegs sein“ (ohne Zielort) → knowledge (Wendepunkt passend zur Distanz/Dauer + Nav), NICHT leere Timeline.
- Supermarkt-Angebot / Prospekt / „welches Bier im Angebot“ → knowledge (Prospekt recherchieren), NICHT nur Navigation.

${FINDUS_FEW_SHOT_DISCLAIMER}

bridging: 1 kurze Ack-Zeile auf Deutsch (max ~12 Wörter). Spiegelt Emotion/Richtung der Frage, variiert — kein Script, keine volle Antwort.
VERBOTEN in bridging: „ich guck nach“, „ich schau mal“, „warte kurz“, „lass mich recherchieren“, Wiederholung der User-Frage.
Stattdessen: kurzer Hit — anerkennen / Laune / Richtung (z. B. „Spannende Frage.“ / „Cool, dass du noch rausgehst.“ / „Glückwunsch — Punkte check ich.“).
Beispiele nur als Ablauf-Logik: Sieg → Glückwunsch + Richtung; Outfit → Idee anerkennen; absurde Wissensfrage → „Spannende Frage.“ ${FINDUS_FEW_SHOT_DISCLAIMER}

Antwort NUR JSON:
{"intent":"knowledge","city":null,"subject":null,"bridging":"...","confidence":0.0}`;

function parseJson(raw: string): Record<string, unknown> | null {
  const t = raw.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asIntent(v: unknown): AgentIntent {
  const s = String(v ?? '').toLowerCase().trim() as AgentIntent;
  return INTENTS.includes(s) ? s : 'knowledge';
}

/** Nur echter Notfall — schneller Bypass vor LLM */
export function isEmergencyFastPath(text: string): boolean {
  return /\b(notfall|notruf|112|verletzt|arzt\b|apotheke|kotz|übel|uebel)\b/i.test(
    text,
  );
}

export async function routeIntentWithLlm(opts: {
  userText: string;
  /** Live-Ortslabel (optional) — kein Pack */
  liveLocationLabel: string | null;
  lastCity: string | null;
  signal?: AbortSignal;
}): Promise<IntentRoute> {
  if (isEmergencyFastPath(opts.userText)) {
    return {
      intent: 'emergency',
      city: opts.lastCity,
      subject: null,
      bridgingLine: bridgingLineForIntent('emergency'),
      confidence: 1,
    };
  }

  if (!hasGeminiApiKey()) {
    return {
      intent: 'knowledge',
      city: opts.lastCity,
      subject: opts.userText.slice(0, 80),
      bridgingLine: bridgingLineForIntent('knowledge'),
      confidence: 0.2,
    };
  }

  const prompt = `Live-Ort (GPS-Nähe, optional): ${opts.liveLocationLabel ?? '—'}
Zuletzt genannte Stadt im Gespräch: ${opts.lastCity ?? '—'}
Hinweis: City-Pack/Profil-Stadt ist für diese Entscheidung IRRELEVANT.
User: """${opts.userText.replace(/"""/g, '')}"""`;

  try {
    const raw = await generateGeminiText(prompt, {
      systemInstruction: SYSTEM,
      useFindusSystem: false,
      responseJson: true,
      jsonMimeOnly: true,
      maxTokens: 180,
      temperature: 0.1,
      signal: opts.signal,
      allowProEscalate: false,
    });
    const j = parseJson(raw);
    if (!j) throw new Error('no json');
    const intent = asIntent(j.intent);
    const bridging =
      typeof j.bridging === 'string' && j.bridging.trim()
        ? j.bridging.trim()
        : bridgingLineForIntent(intent);
    return {
      intent,
      city: typeof j.city === 'string' && j.city.trim() ? j.city.trim() : null,
      subject:
        typeof j.subject === 'string' && j.subject.trim()
          ? j.subject.trim()
          : null,
      bridgingLine: bridging.slice(0, 90),
      confidence:
        typeof j.confidence === 'number' ? j.confidence : 0.7,
    };
  } catch {
    return {
      intent: 'knowledge',
      city: opts.lastCity,
      subject: opts.userText.slice(0, 80),
      bridgingLine: bridgingLineForIntent('knowledge'),
      confidence: 0.25,
    };
  }
}
