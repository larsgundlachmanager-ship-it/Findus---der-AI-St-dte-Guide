/**
 * Preference Capture Middleware — vor TTS:
 * Extrahiert Prefs/Regeln/Fakten und schreibt sie persistent.
 * Soft constraints: Kumpel-Ton bleibt, Slang sparsam — keine steifen Verbote.
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { getCachedUserProfile } from '../userProfileService';
import { useUserProfileStore } from '../../store/useUserProfileStore';
import type { UserProfile } from '../../types/userProfile';

export type CapturedPreference = {
  kind: 'addressing' | 'dislike' | 'like' | 'fact' | 'ask_name';
  value: string;
  /** true = User will das NICHT */
  negated?: boolean;
  replyHint?: string;
};

const SLANG_WORDS =
  'bro|bruder|digga|diggi|dicker|alter|kumpel|mate|buddy|homie';

const NEG_ADDRESS =
  new RegExp(
    `\\b(?:nenn\\s+mich\\s+nicht(?:\\s+so)?|nicht\\s+(?:mehr\\s+)?|kein(?:en)?|ohne|hör\\s+auf(?:\\s+mich)?\\s+(?:zu\\s+)?nennen(?:\\s+mit)?|hoer\\s+auf(?:\\s+mich)?\\s+(?:zu\\s+)?nennen(?:\\s+mit)?|sag\\s+(?:nicht|nie)|bitte\\s+nicht)\\s+(?:so\\s+)?(?:ein(?:en)?\\s+)?(${SLANG_WORDS})\\b`,
    'iu',
  );

const POS_ADDRESS = new RegExp(
  `\\b(?:nenn\\s+mich|sag\\s+(?:ruhig\\s+)?|du\\s+darfst\\s+mich|ich\\s+(?:bin|heiß(?:e)?)\\s+)\\s*(?:gerne\\s+)?(${SLANG_WORDS}|[A-ZÄÖÜ][a-zäöüß]{1,20})\\b`,
  'iu',
);

const ASK_NAME =
  /\b(?:wie\s+(?:soll|darf|kann)\s+ich\s+dich\s+(?:nennen|heißen)|wie\s+heißt\s+du|mein\s+name\s+ist)\b/iu;

function uniqPush(list: string[], item: string): string[] {
  const t = item.trim();
  if (!t) return list;
  const lower = t.toLowerCase();
  if (list.some((x) => x.toLowerCase() === lower)) return list;
  return [...list, t].slice(-40);
}

/** Deterministische Extraktion — Negation hat Vorrang vor Stil-Spiegelung. */
export function extractPreferencesFast(text: string): CapturedPreference[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return [];
  const out: CapturedPreference[] = [];

  const neg = t.match(NEG_ADDRESS);
  if (neg?.[1]) {
    const word = neg[1].toLowerCase();
    out.push({
      kind: 'addressing',
      value: word,
      negated: true,
      replyHint: `Alles klar — ich halte mich mit „${word}“ zurück und bleib locker-natürlich.`,
    });
  }

  // Positiv nur wenn keine Negation
  if (!neg && /\bnenn\s+mich\b/iu.test(t)) {
    const pos = t.match(
      /\bnenn\s+mich\s+(?:gerne\s+|ruhig\s+)?([A-Za-zÄÖÜäöüß]{2,24})\b/iu,
    );
    if (pos?.[1] && !NEG_ADDRESS.test(t)) {
      out.push({
        kind: 'addressing',
        value: pos[1].toLowerCase(),
        negated: false,
        replyHint: `Passt — ich nenn dich ${pos[1]}.`,
      });
    }
  }

  const merk = t.match(
    /\b(?:merk\s+dir|bitte\s+merken|nicht\s+vergessen)[,:]?\s+(.{4,120})$/iu,
  );
  if (merk?.[1]) {
    const fact = merk[1].replace(/\s*(bitte|danke|ok)\s*$/iu, '').trim();
    if (fact.length >= 4) {
      out.push({
        kind: 'fact',
        value: fact.charAt(0).toUpperCase() + fact.slice(1),
        replyHint: `Hab ich mir gemerkt: ${fact}.`,
      });
    }
  }

  if (
    /\b(?:ich\s+(?:mag|hasse|will)\s+nicht|bitte\s+nicht|nie\s+wieder)\b/iu.test(
      t,
    ) &&
    !neg
  ) {
    const cleaned = t
      .replace(/^.*?\b(?:ich\s+(?:mag|hasse|will)\s+nicht|bitte\s+nicht|nie\s+wieder)\s+/iu, '')
      .replace(/\s*(bitte|danke)\s*$/iu, '')
      .trim()
      .slice(0, 100);
    if (cleaned.length >= 4) {
      out.push({
        kind: 'dislike',
        value: cleaned,
        negated: true,
        replyHint: `Verstanden — ich lass das mit „${cleaned}“.`,
      });
    }
  }

  return out;
}

/** Companion-Flags aus natürlicher Sprache (soft, fire-and-forget). */
export function extractRelationshipFlags(text: string): Partial<{
  humorOk: boolean;
  geekMode: boolean;
  freeChatOk: boolean;
  openThreads: string[];
}> {
  const t = text.replace(/\s+/g, ' ').trim();
  const out: Partial<{
    humorOk: boolean;
    geekMode: boolean;
    freeChatOk: boolean;
    openThreads: string[];
  }> = {};
  if (/\b(mag\s+witze|humor\s+ist\s+ok|darf\s+witzig|lach\s+gerne)\b/iu.test(t)) {
    out.humorOk = true;
  }
  if (/\b(kein\s+humor|ernst\s+bleiben|nicht\s+witzig)\b/iu.test(t)) {
    out.humorOk = false;
  }
  if (/\b(nerd|geek|details\s+gerne|technik\s+fan)\b/iu.test(t)) {
    out.geekMode = true;
  }
  if (/\b(plaudern|quatschen|smalltalk|nur\s+reden)\b/iu.test(t)) {
    out.freeChatOk = true;
  }
  const thread = t.match(
    /\b(?:später\s+noch|offen\s+lassen|merk\s+dir\s+für\s+später)[,:]?\s+(.{6,100})$/iu,
  );
  if (thread?.[1]) {
    out.openThreads = [thread[1].trim()];
  }
  return out;
}

async function extractPreferencesLlm(
  text: string,
): Promise<CapturedPreference[]> {
  if (!hasGeminiApiKey()) return [];
  if (text.length < 12) return [];
  // Nur wenn Pref-Signal
  if (
    !/\b(?:nenn|merk|bitte\s+nicht|mag\s+nicht|ich\s+(?:bin|will|hasse)|sag\s+nicht|ohne|kein)\b/iu.test(
      text,
    )
  ) {
    return [];
  }

  const prompt = [
    'Extrahiere User-Präferenzen aus dem deutschen Satz. JSON only:',
    '{"prefs":[{"kind":"addressing|dislike|like|fact|ask_name","value":"string","negated":true|false}]}',
    'Regeln: Negationen erkennen (nicht Bro). Keine Halluzinationen. Max 3 Prefs.',
    `Satz: ${text.slice(0, 400)}`,
  ].join('\n');

  try {
    const raw = await generateGeminiText(prompt, {
      task: 'intent',
      maxTokens: 180,
      temperature: 0.1,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as {
      prefs?: Array<{
        kind?: string;
        value?: string;
        negated?: boolean;
      }>;
    };
    const prefs = Array.isArray(parsed.prefs) ? parsed.prefs : [];
    return prefs
      .filter((p) => p.value && p.kind)
      .slice(0, 3)
      .map((p) => ({
        kind: (p.kind as CapturedPreference['kind']) || 'fact',
        value: String(p.value).trim().slice(0, 120),
        negated: !!p.negated,
      }));
  } catch {
    return [];
  }
}

/**
 * Soft addressing fact for persona — sparsam, natürlich, Rückfrage bei Unsicherheit.
 */
function softAddressingFact(word: string, negated: boolean): string {
  if (negated) {
    return (
      `Anrede: „${word}" nur extrem sparsam und nur wenn 100% natürlich — ` +
      `nie erzwungen. Kumpel-Tonality behalten. ` +
      `Wenn unsicher, charmant fragen: „Hey, wie soll ich dich eigentlich am liebsten nennen?“`
    );
  }
  return `Anrede-OK: User mag „${word}" — sparsam und natürlich einsetzen.`;
}

export async function persistCapturedPreferences(
  prefs: CapturedPreference[],
): Promise<CapturedPreference[]> {
  if (!prefs.length) return [];
  const store = useUserProfileStore.getState();
  const profile = getCachedUserProfile();
  if (!profile) return prefs;

  let facts = [...(profile.learnedFacts ?? [])];
  let dislikes = [
    ...(profile.personaEngine?.preferences?.dislikes ?? []),
  ];
  const pe = { ...(profile.personaEngine ?? {}) };
  const pePrefs = { ...(pe.preferences ?? {}) };

  for (const p of prefs) {
    if (p.kind === 'addressing') {
      // Remove conflicting Rede-Stil that forces the word
      facts = facts.filter(
        (f) =>
          !/^Rede-Stil:.*\b(bro|digga|kumpel)\b/i.test(f) &&
          !/^Anrede:/i.test(f),
      );
      facts = uniqPush(facts, softAddressingFact(p.value, !!p.negated));
      if (p.negated) {
        dislikes = uniqPush(dislikes, `Anrede „${p.value}" sparsam`);
      } else {
        facts = uniqPush(facts, `Mag Anrede ${p.value}`);
      }
      // Soft: keep kumpelhaft tonality — don't force ernst
    } else if (p.kind === 'dislike') {
      dislikes = uniqPush(dislikes, p.value);
      facts = uniqPush(facts, `Mag nicht: ${p.value}`);
    } else if (p.kind === 'like') {
      facts = uniqPush(facts, `Mag: ${p.value}`);
    } else if (p.kind === 'fact') {
      facts = uniqPush(facts, p.value);
    }
  }

  pePrefs.dislikes = dislikes.slice(-24);
  pe.preferences = pePrefs;

  await store.patchProfile({
    learnedFacts: facts.slice(-40),
    personaEngine: pe as UserProfile['personaEngine'],
  });

  return prefs;
}

/**
 * Haupt-Middleware: vor Gemini-Antwort ODER vor TTS aufrufen.
 * Gibt optionale Reply-Hints zurück (für kurze Bestätigung).
 */
export async function runPreferenceCaptureMiddleware(
  userText: string,
): Promise<{ prefs: CapturedPreference[]; replyHint: string | null }> {
  let prefs = extractPreferencesFast(userText);
  const rel = extractRelationshipFlags(userText);
  if (
    rel.humorOk != null ||
    rel.geekMode != null ||
    rel.freeChatOk != null ||
    rel.openThreads?.length
  ) {
    const store = useUserProfileStore.getState();
    const profile = getCachedUserProfile();
    if (profile) {
      await store.patchProfile({
        ...(rel.humorOk != null ? { humorOk: rel.humorOk } : {}),
        ...(rel.geekMode != null ? { geekMode: rel.geekMode } : {}),
        ...(rel.freeChatOk != null ? { freeChatOk: rel.freeChatOk } : {}),
        ...(rel.openThreads?.length
          ? {
              openThreads: uniqPush(
                profile.openThreads ?? [],
                rel.openThreads[0]!,
              ).slice(-12),
            }
          : {}),
      });
      if (rel.openThreads?.[0]) {
        try {
          const { addOpenLoopToForeground } = await import(
            './conversationThreads'
          );
          addOpenLoopToForeground(rel.openThreads[0]);
        } catch {
          /* soft */
        }
      }
    }
  }
  if (!prefs.length) {
    prefs = await extractPreferencesLlm(userText);
  }
  if (!prefs.length) {
    return { prefs: [], replyHint: null };
  }
  await persistCapturedPreferences(prefs);
  const replyHint =
    prefs.map((p) => p.replyHint).find((h) => !!h)?.trim() ?? null;
  return { prefs, replyHint };
}

/** Prompt-Block: Soft Kumpel + sparsame Anrede. */
export function softAddressingPromptBlock(): string {
  const profile = getCachedUserProfile();
  const facts = (profile?.learnedFacts ?? []).filter((f) =>
    /^Anrede:/i.test(f),
  );
  const lines = [
    '=== ANREDE / KUMPEL-TON (SOFT) ===',
    '- Bleib im Kumpel-Ton: warm, locker, Du-Form — nicht steif, nicht Beamten-Deutsch.',
    '- Slang (Bro, Digga, Dicker, Alter) nur extrem sparsam, nie erzwungen, nur wenn 100% natürlich.',
    '- KEINE harten Verbote wie „Sag niemals Bro“ — das macht dich unnatürlich.',
    '- Wenn unsicher, wie der User angesprochen werden will: charmant fragen',
    '  („Hey, wie soll ich dich eigentlich am liebsten nennen?“).',
  ];
  for (const f of facts.slice(-3)) {
    lines.push(`- ${f}`);
  }
  return lines.join('\n');
}

/** Post-check: Gemini behauptet eine Pref gemerkt zu haben → sicherstellen dass sie im Store ist. */
export async function ensurePreferencePersistedFromAssistantSpeech(
  userText: string,
  assistantSpeech: string,
): Promise<void> {
  if (
    !/\b(?:merk|gemerkt|notiert|verstanden|alles\s+klar|hab\s+ich)\b/iu.test(
      assistantSpeech,
    )
  ) {
    return;
  }
  const { prefs } = await runPreferenceCaptureMiddleware(userText);
  void prefs;
}
