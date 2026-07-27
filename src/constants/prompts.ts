import { uiLang } from '../types/userProfile';
import type { MasterPromptContext } from '../types/userProfile';
import { getCachedUserProfile } from '../services/userProfileService';
import type { Fact, PoiWithFacts } from '../db/types';
import {
  AUDIO_GUIDE_SPEECH_RULES_DE,
  FOLLOW_UP_ANSWER_RULES_DE,
} from '../services/audioGuideScript';
import {
  buildMasterSystemInstruction,
  resolveMasterPromptContext,
} from '../services/personaEngine';

export const OPENAI_MODEL = 'gpt-4o-mini';
export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/** @deprecated Re-export — Text-Engine ist Gemini. */
export {
  GEMINI_MODEL,
  GEMINI_TEMPERATURE,
  FINDUS_GEMINI_SYSTEM_INSTRUCTION,
} from './gemini';

/**
 * Wissens- & Rechercheprotokoll: damit Findus viele Fakten sortiert,
 * differenziert, wiederfindet und sinnvoll kombiniert – ohne zu halluzinieren.
 */
export const FINDUS_RESEARCH_PROTOCOL_DE = `## Wissens- & Rechercheprotokoll (verbindlich)

Du arbeitest wie ein Orts-Archiv mit Index – nicht wie ein freies Raten.

### 1) Fakten sortieren & speichern (mentaler Index)
Für JEDEN mitgelieferten Fakt merke dir still:
- ORT (aktueller Spot / Name)
- TYP: [Kurzfakt] | [Erzählung] | [Detail] | [Thema:<tag>]
- THEMEN (z. B. Geschichte, Verkehr, Vereine, Natur, Einkaufen, Zeiten, Personen, Zahlen)
- ANKER: Jahre, Namen, Institutionen (keine Adressen vorlesen)
- BEZUG: gehört dieser Fakt nur hierher oder verbindet er Orte/Themen?

### 2) Recherche bei jeder Frage (Reihenfolge)
1. Exakte Treffer: gleiche Namen, Jahre, Orte, Tags.
2. Typ-Treffer: [Thema:…] und Keywords in Tags.
3. Verwandte Kurzfakten am aktuellen Ort.
4. Erzählung nur als Einstieg/Ton – nicht als alleinige Quelle für harte Daten.
5. Details ([Detail]/[Thema:]) für Tiefenfragen („warum“, „wie lange“, „wie komme ich…“).
6. Wenn mehrere passen: priorisiere aktuellen Ort → gleiche Themen-Tags → klarste Zahlen/Daten.
7. POI-Story: Fehlt etwas → sag klar, was in den Fakten nicht steht. ERFINDE NICHTS.
8. RÜCKFRAGEN des Users: Wenn lokale Fakten nicht reichen, darfst und sollst du OpenAI-Wissen nutzen, um kurz und hilfreich zu antworten — der User fragt oft genau das, was Findus noch nicht gesagt hat.

### 3) Kombinieren
- Verbinde 2–4 passende Fakten zu einer schlüssigen Antwort (Ursache→Wirkung, Damals→Heute, Ort→Nutzen).
- Keine Widersprüche vermischen; bei Konflikt den präziseren Fakt wählen und den anderen weglassen.
- Zahlen und Jahre wörtlich aus den Fakten übernehmen; Adressen/Telefon nie vorlesen.
- Keine Fakten „aufblasen“ über den Beleg hinaus (außer bei Rückfragen mit klarer Online-Ergänzung).

### 4) Differenzierung (was wofür)
- [Kurzfakt]: harte Kernaussagen → Fragen & Faktenantworten.
- [Erzählung]: warmes Ankommen / Atmosphäre → Begrüßung, nicht als Beleg für Details.
- [Detail] / [Thema:…]: Tiefenwissen, Spezialfragen, Vergleiche.

### 5) Antwortstil (Audio)
3–6 Sätze, klar zum Zuhören. Fließtext ohne Rubriken.
Bei Rückfragen: DIREKT antworten — Frage nicht wiederholen; kein „weiter radeln“-Outro.`;


export const FINDUS_RESEARCH_PROTOCOL_EN = `## Knowledge & research protocol (mandatory)

Work like a place archive with an index — never free guessing.

### 1) Sort & store facts (mental index)
For EVERY provided fact note:
- PLACE (current spot / name)
- TYPE: [Hook] | [Narration] | [Detail] | [Topic:<tag>]
- TOPICS (history, transport, clubs, nature, shopping, hours, people, numbers)
- ANCHORS: years, names, addresses, distances, opening hours, institutions
- LINKS: spot-only vs cross-place/theme

### 2) Research order on every question
1. Exact matches: names, years, places, tags.
2. Type/tag matches: [Topic:…] and tag keywords.
3. Related hooks at the current place.
4. Narration for tone/intro only — not sole source for hard data.
5. Details for deep questions.
6. If several match: current place → same topic tags → clearest numbers/dates.
7. If missing: say what is not in the facts. NEVER invent.

### 3) Combining
- Weave 2–4 matching facts into one coherent answer.
- Do not mix contradictions; prefer the more precise fact.
- Copy numbers, years, phones, hours verbatim from facts.
- Do not embellish beyond the evidence.

### 4) Differentiation
- [Hook]: hard core claims → Q&A.
- [Narration]: warm arrival → greeting only.
- [Detail] / [Topic:…]: deep / specialist questions.

### 5) Spoken style
3–6 sentences. Lead with the hit, optionally one related fact.
If unsure: say you have no evidence here — do not speculate.`;

/**
 * Q&A / Voice-System-Prompt = Master Engine + knappes Rechercheprotokoll.
 * Legacy-Persona-/Forbidden-Blöcke sind entfernt.
 */
export function buildFindusSystemPrompt(
  context?: MasterPromptContext,
): string {
  const profile = getCachedUserProfile();
  const master = buildMasterSystemInstruction(
    profile,
    context ?? resolveMasterPromptContext(),
  );
  const city = profile?.cityName ?? 'der Stadt';

  return `${master}

Aktuelle Stadt: ${city}. Antworte auf Deutsch, fließend zum Vorlesen.
${AUDIO_GUIDE_SPEECH_RULES_DE}

${FOLLOW_UP_ANSWER_RULES_DE}

${FINDUS_RESEARCH_PROTOCOL_DE}`;
}

/** Statischer Fallback (Tests / Boot ohne Profil). */
export const FINDUS_SYSTEM_PROMPT = `Du BIST Findus — lebendiger Kumpel neben dem Nutzer, kein Roboter.
Sprich warm, klar und flüssig – ideal fürs Zuhören unterwegs (ca. 3–6 Sätze).
Nutze die mitgelieferten Fakten als Grundlage, erfinde keine Daten.
Antworte auf Deutsch. Keine Rubriken, keine Adressen vorlesen.

${AUDIO_GUIDE_SPEECH_RULES_DE}

${FOLLOW_UP_ANSWER_RULES_DE}

${FINDUS_RESEARCH_PROTOCOL_DE}`;

/** @deprecated Use FINDUS_SYSTEM_PROMPT */
export const FINNUS_SYSTEM_PROMPT = FINDUS_SYSTEM_PROMPT;

export type FactKind = 'hook' | 'narration' | 'detail' | 'topic';

const FACT_PREFIX =
  /^\[(Kurzfakt|Erzählung|Detail|Thema:[^\]]+|Hook|Narration|Topic:[^\]]+)\]\s*/u;

/**
 * Parst typisierte Fakten (`[Kurzfakt] …`, `[Thema:xyz] …`) für sortierte Recherche-Kontexte.
 */
export function classifyFact(factText: string): {
  kind: FactKind;
  tag?: string;
  body: string;
  label: string;
} {
  const m = factText.match(FACT_PREFIX);
  if (!m) {
    return { kind: 'hook', body: factText.trim(), label: 'Kurzfakt' };
  }
  const raw = m[1];
  const body = factText.slice(m[0].length).trim();
  if (raw === 'Erzählung' || raw === 'Narration') {
    return { kind: 'narration', body, label: raw };
  }
  if (raw === 'Detail') {
    return { kind: 'detail', body, label: raw };
  }
  if (raw.startsWith('Thema:') || raw.startsWith('Topic:')) {
    const tag = raw.split(':')[1]?.trim();
    return { kind: 'topic', tag, body, label: raw };
  }
  return { kind: 'hook', body, label: raw };
}

const KIND_ORDER: Record<FactKind, number> = {
  hook: 0,
  narration: 1,
  detail: 2,
  topic: 3,
};

/**
 * Sortiert und gruppiert Fakten für maximale Auffindbarkeit in Prompts.
 */
export function buildSortedFactBlock(
  facts: Fact[],
  lang: 'de' | 'en' = 'de',
): string {
  const classified = facts.map((f) => ({
    ...classifyFact(f.fact_text),
    id: f.id,
  }));

  classified.sort((a, b) => {
    const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (ko !== 0) return ko;
    if (a.tag && b.tag) return a.tag.localeCompare(b.tag);
    return a.id - b.id;
  });

  const headers =
    lang === 'en'
      ? {
          hook: '## Hooks (core facts)',
          narration: '## Narration (arrival tone only)',
          detail: '## Details',
          topic: '## Topic details (search by tag)',
        }
      : {
          hook: '## Kurzfakten (Kernaussagen)',
          narration: '## Erzählung (nur Einstieg/Ton)',
          detail: '## Details',
          topic: '## Themen-Details (nach Tag suchen)',
        };

  const sections: string[] = [];
  let current: FactKind | null = null;
  let currentTag: string | undefined;

  for (const item of classified) {
    if (item.kind !== current) {
      current = item.kind;
      currentTag = undefined;
      sections.push(headers[item.kind]);
    }
    if (item.kind === 'topic' && item.tag && item.tag !== currentTag) {
      currentTag = item.tag;
      sections.push(`### ${item.tag}`);
    }
    const prefix =
      item.kind === 'topic' && item.tag
        ? `[Thema:${item.tag}]`
        : `[${item.label}]`;
    sections.push(`- ${prefix} ${item.body}`);
  }

  const indexHint =
    lang === 'en'
      ? `\n## Quick index\n${buildTagIndex(classified, 'en')}`
      : `\n## Schnellindex\n${buildTagIndex(classified, 'de')}`;

  return `${sections.join('\n')}${indexHint}`;
}

function buildTagIndex(
  items: Array<{ kind: FactKind; tag?: string; body: string }>,
  lang: 'de' | 'en',
): string {
  const byTag = new Map<string, number>();
  for (const it of items) {
    if (it.kind === 'topic' && it.tag) {
      byTag.set(it.tag, (byTag.get(it.tag) ?? 0) + 1);
    }
  }
  const hooks = items.filter((i) => i.kind === 'hook').length;
  const narr = items.filter((i) => i.kind === 'narration').length;
  const details = items.filter((i) => i.kind === 'detail').length;
  const tags =
    [...byTag.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, n]) => `${t}(${n})`)
      .join(', ') || '—';

  return `Kurzfakten=${hooks}, Erzählungen=${narr}, Details=${details}, Themen: ${tags}`;
}

/** Vollständiger Orts-Kontext für Chat / Recherche. */
export function buildPoiResearchContext(poi: PoiWithFacts): string {
  const lang = uiLang(getCachedUserProfile()?.language ?? 'de');
  const factBlock = buildSortedFactBlock(poi.facts, lang);
  return `${buildFindusSystemPrompt()}

# Aktueller Ort: ${poi.name}
# Fakten-Archiv (sortiert für Recherche)
${factBlock}`;
}
