/**
 * Persönlichkeits-Matrix → Prompt-Struktur (keine Scripts, nur Blaupausen).
 */

import type { UserProfile } from '../../types/userProfile';
import type {
  CoreRoleId,
  KnowledgeStyleId,
  SpleenId,
  VibeToneId,
} from '../../constants/personalityMatrix';
import {
  CORE_ROLES,
  KNOWLEDGE_STYLES,
  SPLEENS,
  VIBE_TONES,
  migrateLegacyPersonality,
} from '../../constants/personalityMatrix';
import { FINDUS_FEW_SHOT_DISCLAIMER } from '../concierge/findusResponsePolicy';
import {
  buildCompactBridgeVoiceHint,
  buildMatrixSpeechStyleBlock,
} from './matrixSpeechStyle';

export type EffectivePersonalityMatrix = {
  coreRole: CoreRoleId;
  vibeTone: VibeToneId;
  knowledgeStyle: KnowledgeStyleId;
  spleens: SpleenId[];
};

export function resolveEffectivePersonalityMatrix(
  profile?: UserProfile | null,
): EffectivePersonalityMatrix {
  const p = profile;
  const hasMatrixField =
    p?.coreRole != null ||
    p?.vibeTone != null ||
    p?.knowledgeStyle != null ||
    (p?.spleens?.length ?? 0) > 0;

  if (hasMatrixField && p?.coreRole) {
    return {
      coreRole: p.coreRole,
      vibeTone: p.vibeTone ?? 'balanced',
      knowledgeStyle: p.knowledgeStyle ?? 'clear_essence',
      spleens: [...(p.spleens ?? [])].slice(0, 2),
    };
  }

  if ((p?.characters?.length ?? 0) > 0 || (p?.tonalities?.length ?? 0) > 0) {
    return migrateLegacyPersonality({
      characters: p?.characters,
      tonalities: p?.tonalities,
    });
  }

  return {
    coreRole: 'classic_guide',
    vibeTone: 'balanced',
    knowledgeStyle: 'clear_essence',
    spleens: [],
  };
}

/** Früher Aristokrat = Sie; Founder-Regel: Yorro siezt nie. */
export function matrixUsesFormalAddress(_coreRole: CoreRoleId): boolean {
  return false;
}

export function matrixUsesBuddyAddress(coreRole: CoreRoleId): boolean {
  return coreRole === 'buddy' || coreRole === 'nerd';
}

function optionHint<T extends string>(
  list: { id: T; labelDe: string; infoDe: string }[],
  id: T,
): string {
  const o = list.find((x) => x.id === id);
  if (!o) return '';
  return `${o.labelDe}: ${o.infoDe}`;
}

/** Struktur-Hints für Master-Prompt / Synthese — Wortlaut frei. */
export function buildPersonalityMatrixPromptBlock(
  profile?: UserProfile | null,
  opts?: {
    activeSpleens?: SpleenId[] | null;
    /** Rucksack/Call-2 wenn kein volles Profil geladen */
    matrixOverride?: EffectivePersonalityMatrix | null;
  },
): string {
  const m = opts?.matrixOverride ?? resolveEffectivePersonalityMatrix(profile);
  const spleens = (opts?.activeSpleens ?? m.spleens).slice(0, 2);

  const addressRule = matrixUsesBuddyAddress(m.coreRole)
    ? '- Anrede: IMMER Du, auf Augenhöhe — locker, aber respektvoll; kein erzwungenes Bro/Digga. Nie Siezen.'
    : m.coreRole === 'innocent_child'
      ? '- Anrede: IMMER Du. Tempo und Dynamik wie die Kind-Hörprobe: schneller, impulsiv, staunend, kurze Sätze, echte Neugier — kein ruhiger Erwachsenen-Vortrag. Nie Siezen.'
      : m.coreRole === 'aristocrat'
        ? '- Anrede: IMMER Du — gepflegt und edel, aber nie Siezen. Respekt über Wortwahl, nicht über Sie.'
        : '- Anrede: IMMER Du (Standard-Reisebegleiter), warm und klar. Nie Siezen.';

  const tempoRule =
    m.vibeTone === 'mystic'
      ? '- Tempo: zügig wie ein Podcast — Spannung über Wortwahl, nicht durch lange Pausen oder Schnecken-Vorlesen.'
      : null;

  const antiFluffRule =
    m.vibeTone === 'mystic' || m.knowledgeStyle === 'myth_hunter'
      ? '- FAKTEN-PFLICHT: Mystik/„man munkelt“/Aura/Geheimnis NUR mit belegtem Stoff aus dem Datensatz. Ist der Datensatz dünn → kurz und ehrlich die echten Fakten, KEIN atmosphärisches Gelaber, KEINE erfundenen Koordinaten-Mythen.'
      : null;

  const speechStyleBlock = buildMatrixSpeechStyleBlock(m);

  const roleHint = optionHint(CORE_ROLES, m.coreRole);
  const vibeHint = optionHint(VIBE_TONES, m.vibeTone);
  const knowHint = optionHint(KNOWLEDGE_STYLES, m.knowledgeStyle);
  const spleenHints = spleens
    .map((id) => optionHint(SPLEENS, id))
    .filter(Boolean)
    .map((h) => `  · ${h}`)
    .join('\n');

  const gigglerRule = spleens.includes('giggler')
    ? '- Gekicher: Humor nur über Wortwahl und Interpunktion. Nie die Wörter kichern, kichert, lacht, hihi, haha in den Vorlese-Text schreiben — TTS liest sie wörtlich vor.'
    : null;

  const rel: string[] = [];
  if (profile?.humorOk) rel.push('Humor explizit ok — Witze dosiert.');
  if (profile?.geekMode) rel.push('Geek-Mode: Details/Popkultur-Vergleiche willkommen.');
  if (profile?.freeChatOk) rel.push('Smalltalk/Plaudern ok — nicht jedes Mal zur Tour zurücklenken.');
  try {
    const {
      getForegroundThread,
      listResumableThreads,
    } = require('../memory/conversationThreads') as {
      getForegroundThread: () => { label: string } | null;
      listResumableThreads: () => Array<{ label: string; id: string }>;
    };
    const fg = getForegroundThread();
    const parked = listResumableThreads()
      .filter((t) => t.label && t.label !== fg?.label)
      .slice(0, 3)
      .map((t) => t.label);
    if (fg?.label) {
      rel.push(`Aktiver Gesprächsthread: ${fg.label} — Bezüge nur hierher.`);
    }
    if (parked.length) {
      rel.push(
        `Geparkte Themen (nur bei Resume): ${parked.join('; ')}`,
      );
    }
    // Kein Fallback auf profile.openThreads — das belebt gelöschte Fäden.
  } catch {
    /* Keine toten Profil-Fäden als Fallback */
  }

  return `${speechStyleBlock}
${antiFluffRule ? `${antiFluffRule}\n` : ''}${tempoRule ? `${tempoRule}\n` : ''}=== PERSÖNLICHKEITS-MATRIX (Feintuning — Wortlaut frei) ===
${addressRule}
- Rolle (Kat. 1): ${roleHint}
- Vibe (Kat. 2): ${vibeHint}
- Wissensstil (Kat. 3): ${knowHint}
${spleenHints ? `- Spleens (Kat. 4, dosiert):\n${spleenHints}` : '- Spleens: keine — zurückhaltend bleiben.'}
${gigglerRule ? `${gigglerRule}\n` : ''}
${rel.length ? `- Beziehung/Kontext:\n${rel.map((l) => `  · ${l}`).join('\n')}` : ''}
${FINDUS_FEW_SHOT_DISCLAIMER}`;
}

export function buildCharacterFlavorFromMatrix(
  profile?: UserProfile | null,
): string {
  const m = resolveEffectivePersonalityMatrix(profile);
  const parts = [
    optionHint(CORE_ROLES, m.coreRole),
    optionHint(VIBE_TONES, m.vibeTone),
    optionHint(KNOWLEDGE_STYLES, m.knowledgeStyle),
  ].filter(Boolean);
  for (const s of m.spleens.slice(0, 2)) {
    const h = optionHint(SPLEENS, s);
    if (h) parts.push(h);
  }
  return parts.join(' | ');
}

/** Modul-1: gewählte Matrix als Stimme — Struktur bleibt immersiv. */
export function formatModule1CharacterVoice(
  profile?: UserProfile | null,
): string {
  const m = resolveEffectivePersonalityMatrix(profile);
  const flavor = buildCharacterFlavorFromMatrix(profile);
  const speech = buildMatrixSpeechStyleBlock(m);
  const address = matrixUsesBuddyAddress(m.coreRole)
    ? 'Anrede: Du, auf Augenhöhe — nie Siezen'
    : m.coreRole === 'innocent_child'
      ? 'Anrede: Du, staunend/kurz — nie Siezen'
      : m.coreRole === 'aristocrat'
        ? 'Anrede: Du, gepflegt — nie Siezen'
        : 'Anrede: Du — nie Siezen';
  return `${speech}
STIMME / CHARAKTER (färbt immersive Story, nicht die Struktur):
${address} · ${flavor}
Dieselbe Szene → Brücke → Payoff — in GENAU dieser Stimme, mündlich und umgangssprachlich, nicht als Einheits-Bot.`;
}

export { buildCompactBridgeVoiceHint, buildMatrixSpeechStyleBlock } from './matrixSpeechStyle';
