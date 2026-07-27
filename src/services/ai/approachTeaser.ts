/**
 * Approach-/Wegweiser-Teaser aus dem VOLLEN Hauptort-Datensatz.
 * Anteasert Skandal, Legende, Person, Besonderheit — ohne „Wegweiser“ und ohne Spoiler-Wüste.
 */

import type { Fact, PoiWithFacts } from '../../db/types';
import type { UserProfile } from '../../types/userProfile';
import { getPoiWithFacts } from '../../db/database';
import { getCachedUserProfile } from '../userProfileService';
import { generatePromptText, hasTextEngine } from '../localAiService';
import { resolveMasterPromptContext } from '../personaEngine';
import {
  buildWegweiserHook,
  extractWegweiserDestination,
  isBoringApproachTeaser,
} from './fastHook';
import { humanizePoiTitleForSpeech } from './promptBuilder';
import { isAddressDumpFact, isTransitTrashFact } from './deepStoryFilter';

export type TeaseKind =
  | 'scandal'
  | 'legend'
  | 'person'
  | 'quirk'
  | 'unique'
  | 'story';

export type TeaseHook = {
  kind: TeaseKind;
  text: string;
  score: number;
};

const PREFIX_RE =
  /^\[(Kurzfakt|Erzählung|Detail|Thema:[^\]]+|Teaser|Hook|Narration|Topic:[^\]]+|FAQ|User-Frage)\]\s*/iu;

function stripPrefix(text: string): string {
  return text.replace(PREFIX_RE, '').trim();
}

function cleanFactBody(raw: string): string {
  let t = stripPrefix(raw);
  // FAQ-Zeilen: nur die spannende Antwort / Kernsatz behalten
  t = t
    .replace(/^User-Frage:\s*.+?\s*Antwort:\s*/i, '')
    .replace(/^Schätzfrage:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Adressen/Telefon raus
  t = t
    .replace(/\b(Peiner Hag|Schnickenfeld|Werkstraße|Hudenbarg)\s*\d+[a-z]?\b/gi, '')
    .replace(/Tel\.?\s*[\d\s/-]{6,}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

function classifyTease(text: string): { kind: TeaseKind; score: number } | null {
  const lower = text.toLowerCase();
  if (text.length < 28) return null;
  if (isTransitTrashFact(text) || isAddressDumpFact(text)) return null;
  if (/^➔/.test(text) && text.length < 50) return null;

  if (
    /(skandal|vandal|streit|brand|krieg|drama|panne|betrug|affäre|affaere|skandalös)/i.test(
      lower,
    )
  ) {
    return { kind: 'scandal', score: 100 + Math.min(40, text.length / 8) };
  }
  if (/(legende|sage|mythos|geister|geheimnis|überlieferung|ueberlieferung)/i.test(lower)) {
    return { kind: 'legend', score: 92 + Math.min(30, text.length / 10) };
  }
  if (
    /(berühm|promi|geboren|gestorben|bürgermeister|buergermeister|familie\s+\w+|namensgeber|architekt|baumeister|künstler|kuenstler|stiftete|gespendet)/i.test(
      lower,
    )
  ) {
    return { kind: 'person', score: 88 + Math.min(30, text.length / 10) };
  }
  if (
    /(einzige|einzigartig|selten|kaum|älteste|aelteste|größte|groesste|erste[rn]?\b|kurios|besonders|besonderheit|ungewöhnlich|ungewoehnlich|absolut keine|deutschlandweit)/i.test(
      lower,
    )
  ) {
    return { kind: 'unique', score: 85 + Math.min(35, text.length / 8) };
  }
  if (
    /(denkmal|gerettet|saniert|übergeben|uebergeben|verschwand|früher|frueher|heute noch|Schmuckstück|schmuckstueck|Walmdach|Fachwerk)/i.test(
      lower,
    )
  ) {
    return { kind: 'quirk', score: 72 + Math.min(25, text.length / 10) };
  }
  if (
    /(weil|deshalb|seit\s+\d{4}|im jahr|geschichte|bedeutung|tradition|seit\s+über|seit\s+ueber)/i.test(
      lower,
    ) &&
    text.length > 60
  ) {
    return { kind: 'story', score: 55 + Math.min(20, text.length / 12) };
  }
  return null;
}

/** Rankt Fakten für Approach-Anteaser (Skandal > Legende > Person > Besonderheit). */
export function extractTeaseHooks(facts: Fact[], limit = 6): TeaseHook[] {
  const out: TeaseHook[] = [];
  const seen = new Set<string>();

  for (const f of facts) {
    const text = cleanFactBody(f.fact_text);
    if (!text || text.length < 28) continue;
    const key = text.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    const hit = classifyTease(text);
    if (!hit) continue;
    seen.add(key);
    out.push({ kind: hit.kind, text, score: hit.score });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

function shortenForTease(text: string, maxLen = 110): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 40 ? cut.slice(0, sp) : cut).replace(/[,:;–-]$/, '')}…`;
}

function teaseLead(kind: TeaseKind, name: string): string {
  switch (kind) {
    case 'scandal':
      return `Pst — bei ${name} steckt ein echter Skandal-Faden`;
    case 'legend':
      return `Bei ${name} hängt eine Legende in der Luft`;
    case 'person':
      return `Zu ${name} gehört eine Personengeschichte, die man nicht kommen sieht`;
    case 'unique':
      return `${name} hat eine echte Besonderheit`;
    case 'quirk':
      return `Bei ${name} gibt’s ein Detail, das die meisten übersehen`;
    default:
      return `Zu ${name} hab ich eine Story, die sich lohnt`;
  }
}

/**
 * Offline: interaktiver Lockruf + Anteaser aus dem besten Datensatz-Fakt.
 */
export function buildApproachTeaserOffline(
  source: PoiWithFacts,
  profile?: UserProfile | null,
  approachPoi?: PoiWithFacts | null,
): string {
  const p = profile ?? getCachedUserProfile();
  const name = humanizePoiTitleForSpeech(
    extractWegweiserDestination(source.name),
  );
  const firstName = p?.firstName?.trim() || '';
  const hooks = extractTeaseHooks(source.facts, 5);
  const top = hooks[0];

  if (!top) {
    return buildWegweiserHook(approachPoi ?? source, p);
  }

  const snippet = shortenForTease(top.text, 100);
  const lead = teaseLead(top.kind, name);
  const hey = firstName ? `${firstName}, ` : '';

  const variants = [
    `${hey}${lead}. ${snippet} Magst du näher ran — ich erzähl dir den Rest vor Ort?`,
    `${hey}Da vorne liegt ${name}. ${snippet} Lust auf die ganze Geschichte?`,
    `${hey}${lead}: ${snippet} Komm näher, dann pack ich’s richtig aus.`,
  ];

  // Personen / Skandal etwas direkter
  if (top.kind === 'scandal' || top.kind === 'person') {
    variants.unshift(
      `${hey}Kurz anteasern: ${snippet} — das gehört zu ${name}. Reinzoomen?`,
    );
  }
  if (top.kind === 'unique') {
    variants.unshift(
      `${hey}Wusstest du das über ${name}? ${snippet}`,
    );
  }

  const pick = variants[Math.floor(Math.random() * variants.length)] ?? variants[0];
  return pick
    .replace(/\bWegweiser\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function polishTeaserWithLlm(
  source: PoiWithFacts,
  hooks: TeaseHook[],
  profile?: UserProfile | null,
): Promise<string | null> {
  if (!hasTextEngine() || hooks.length === 0) return null;

  const name = humanizePoiTitleForSpeech(source.name);
  const firstName = profile?.firstName?.trim() || '';
  const factLines = hooks
    .slice(0, 4)
    .map((h, i) => `${i + 1}. [${h.kind}] ${shortenForTease(h.text, 140)}`)
    .join('\n');

  const prompt = `Du bist Findus, Audioguide im Ohr. Schreibe GENAU 1–2 kurze Sätze als Approach-Teaser (Annäherung an den Ort).

Ort: ${name}
${firstName ? `Nutzer: ${firstName} (gerne einmal ansprechen).` : ''}

Datensatz-Hooks (NUR daraus anteasern, nichts erfinden):
${factLines}

Pflicht:
- Sprich den User direkt an (du/dein). Interesse anstupsen, dann einladen näher zu kommen.
- Anteasere Skandal, Legende, Person ODER Besonderheit — ohne die ganze Story zu spoilern.
- NIEMALS das Wort „Wegweiser“.
- NIEMALS Selbstgespräch („Was ist das? Ah okay…“).
- NIEMALS Adressen, Telefon, Listen, Überschriften.
- Max. 2 Sätze, flüssig zum Vorlesen.

Nur den gesprochenen Text ausgeben.`;

  try {
    const raw = await Promise.race([
      generatePromptText(prompt, {
        maxTokens: 120,
        temperature: 0.85,
        useFindusSystem: true,
        masterContext: resolveMasterPromptContext({
          poi: source,
        }),
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 2800)),
    ]);
    const text = (raw ?? '')
      .replace(/^["«]|["»]$/g, '')
      .replace(/\bWegweiser\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 40 || text.length > 320) return null;
    if (/was ist das\??\s*(ah|genau)/i.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Lädt den Hauptort inkl. aller Fakten (Approach → parent_poi_id).
 */
export async function resolveApproachStorySource(
  approachOrArea: PoiWithFacts,
): Promise<PoiWithFacts> {
  const kind = approachOrArea.kind ?? 'legacy';
  if (kind !== 'approach') {
    // Schon Hauptort / Sub: wenn Facts dünn und parent existiert, Parent laden
    if (
      approachOrArea.facts.length < 3 &&
      approachOrArea.parent_poi_id != null
    ) {
      const parent = await getPoiWithFacts(approachOrArea.parent_poi_id);
      if (parent && parent.facts.length > approachOrArea.facts.length) {
        return parent;
      }
    }
    return approachOrArea;
  }

  if (approachOrArea.parent_poi_id != null) {
    const parent = await getPoiWithFacts(approachOrArea.parent_poi_id);
    if (parent) return parent;
  }

  return approachOrArea;
}

/**
 * Baut den Approach-Teaser: voller Datensatz → beste Hooks → optional Gemini → Offline.
 */
export async function buildRichApproachTeaser(
  approachPoi: PoiWithFacts,
  profile?: UserProfile | null,
  packTeaser?: string | null,
): Promise<string> {
  const p = profile ?? getCachedUserProfile();
  const source = await resolveApproachStorySource(approachPoi);
  const hooks = extractTeaseHooks(source.facts, 6);

  // Pack-Teaser nur behalten, wenn er schon spannend ist UND wir keine Dataset-Hooks haben
  const pack = (packTeaser ?? '').trim();
  if (hooks.length === 0) {
    if (pack && !isBoringApproachTeaser(pack)) return pack;
    return buildWegweiserHook(approachPoi, p);
  }

  // Immer Dataset bevorzugen, wenn Hooks da sind (auch wenn Pack-Teaser „ok“ klingt)
  const llm = await polishTeaserWithLlm(source, hooks, p);
  if (llm) return llm;

  return buildApproachTeaserOffline(source, p, approachPoi);
}

/** Debug / Tests */
export function __testClassifyTease(text: string): TeaseKind | null {
  return classifyTease(cleanFactBody(text))?.kind ?? null;
}
