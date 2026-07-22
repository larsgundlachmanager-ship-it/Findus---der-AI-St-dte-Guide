import { uiLang } from '../types/userProfile';
import { getCachedUserProfile } from '../services/userProfileService';
import {
  CHARACTER_CATEGORIES,
  EXPERIENCE_CARDS,
} from './onboardingOptions';
import { getVoice } from './voices';
import type { Fact, PoiWithFacts } from '../db/types';
import {
  buildDynamicSystemPrompt,
  buildPersonalityStyleBlock,
  POI_NARRATION_SYSTEM_RULES,
  resolvePromptStyleSettings,
} from '../services/ai/PromptBuilderService';
import type { VisitedHistory } from '../services/ai/types';

export const OPENAI_MODEL = 'gpt-4o-mini';
export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

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
- ANKER: Jahre, Namen, Adressen, Entfernungen, Öffnungszeiten, Institutionen
- BEZUG: gehört dieser Fakt nur hierher oder verbindet er Orte/Themen?

### 2) Recherche bei jeder Frage (Reihenfolge)
1. Exakte Treffer: gleiche Namen, Jahre, Orte, Tags.
2. Typ-Treffer: [Thema:…] und Keywords in Tags.
3. Verwandte Kurzfakten am aktuellen Ort.
4. Erzählung nur als Einstieg/Ton – nicht als alleinige Quelle für harte Daten.
5. Details ([Detail]/[Thema:]) für Tiefenfragen („warum“, „wie lange“, „wie komme ich…“).
6. Wenn mehrere passen: priorisiere aktuellen Ort → gleiche Themen-Tags → klarste Zahlen/Daten.
7. Fehlt etwas: sag klar, was in den Fakten nicht steht. ERFINDE NICHTS.

### 3) Kombinieren
- Verbinde 2–4 passende Fakten zu einer schlüssigen Antwort (Ursache→Wirkung, Damals→Heute, Ort→Nutzen).
- Keine Widersprüche vermischen; bei Konflikt den präziseren Fakt wählen und den anderen weglassen.
- Zahlen, Jahre, Telefonnummern, Öffnungszeiten wörtlich aus den Fakten übernehmen.
- Keine Fakten „aufblasen“ oder ausschmücken über den Beleg hinaus.

### 4) Differenzierung (was wofür)
- [Kurzfakt]: harte Kernaussagen → Fragen & Faktenantworten.
- [Erzählung]: warmes Ankommen / Atmosphäre → Begrüßung, nicht als Beleg für Details.
- [Detail] / [Thema:…]: Tiefenwissen, Spezialfragen, Vergleiche.

### 5) Antwortstil (Audio)
3–6 Sätze, klar zum Zuhören. Erst Treffer nennen, dann optional 1 verwandten Fakt.
Bei Unsicherheit: „Dazu habe ich hier keinen Beleg“ statt spekulieren.`;

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

function labelForOption(id: string, lang: 'de' | 'en'): string {
  for (const cat of CHARACTER_CATEGORIES) {
    const opt = cat.options.find((o) => o.id === id);
    if (opt) return lang === 'de' ? opt.labelDe : opt.labelEn;
  }
  return id;
}

function experienceHints(
  prefs: Record<string, string>,
  lang: 'de' | 'en',
): { like: string[]; avoid: string[] } {
  const like: string[] = [];
  const avoid: string[] = [];
  for (const card of EXPERIENCE_CARDS) {
    const v = prefs[card.id];
    const label = lang === 'de' ? card.labelDe : card.labelEn;
    if (v === 'yes') like.push(label);
    if (v === 'no') avoid.push(label);
  }
  return { like, avoid };
}

/**
 * Dynamischer System-Prompt aus dem lokalen User-Profil + Rechercheprotokoll
 * + Persönlichkeit/Tonfall (PromptBuilderService).
 */
export function buildFindusSystemPrompt(sessionMemory?: VisitedHistory): string {
  const profile = getCachedUserProfile();
  const lang = uiLang(profile?.language ?? 'de');
  const research = FINDUS_RESEARCH_PROTOCOL_DE;

  if (!profile?.setupComplete) {
    const style = buildPersonalityStyleBlock(resolvePromptStyleSettings(profile));
    const base = `Du bist Findus, ein lockerer, freundlicher Audio-Tourguide. Sprich warm, klar und kurz (ca. 3–6 Sätze). Antworte auf Deutsch.`;
    return `${base}

${style}

${research}`;
  }

  const voice = getVoice(profile.voiceId);
  const styleSettings = resolvePromptStyleSettings(profile);
  const chars = [
    ...profile.characters,
    ...profile.tonalities,
    ...profile.motives,
    ...profile.socialDynamics,
    ...profile.extraTraits,
  ].map((id) => labelForOption(id, lang));

  const access = profile.accessibility.map((id) => labelForOption(id, lang));
  const { like, avoid } = experienceHints(profile.experiencePrefs, lang);
  const city = profile.cityName ?? 'der Stadt';

  const memorySection =
    sessionMemory?.entries?.length &&
    sessionMemory.entries.length > 0
      ? `\n## Tour-Gedächtnis\nBereits besucht: ${sessionMemory.entries
          .slice(-5)
          .map((e) => e.name)
          .join(', ')}.\nKnüpfe an, wiederhole aber keine bereits genannten Kernfakten.\n`
      : '';

  return `${buildDynamicSystemPrompt({ profile, cityName: city })}
${memorySection}
Stimm-Persona (Audio): ${voice.id} — Stilsteuerung über Text/Interpunktion, nicht über Tempo-Drosselung.
Gewählte Optionen: ${chars.join(', ') || styleSettings.personalityLabel}.
Bevorzuge: ${like.slice(0, 8).join(', ') || 'allgemeine Highlights'}.
Vermeide oder halte knapp: ${avoid.slice(0, 8).join(', ') || 'nichts Besonderes'}.
Barrierefreiheit/Bedürfnisse: ${access.join(', ') || 'keine'}.
Zusätzlich erleben: ${profile.wantToExperience || '—'}. Nicht erleben: ${profile.avoidExperience || '—'}.

${POI_NARRATION_SYSTEM_RULES}

${research}`;
}

/** Statischer Fallback (Tests / Boot ohne Profil). */
export const FINDUS_SYSTEM_PROMPT = `Du bist Findus, ein lockerer, freundlicher Audio-Tourguide.
Sprich warm, klar und kurz – ideal fürs Zuhören unterwegs (ca. 3–6 Sätze).
Nutze die mitgelieferten Fakten als Grundlage, erfinde keine erfundenen Daten.
Antworte auf Deutsch.

${FINDUS_RESEARCH_PROTOCOL_DE}`;

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
