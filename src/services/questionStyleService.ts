/**
 * Spiegelt Formulierungen/Wörter des Users (bro, Jugendsprache, Bayrisch, Beamten-Deutsch).
 * Antwortlänge bleibt unverändert — nur Ton & Wortwahl.
 * Soft: Negationen („nenn mich nicht Bro“) spiegeln NICHT — kein erzwungenes Bro.
 */

import { getCachedUserProfile } from './userProfileService';
import { useUserProfileStore } from '../store/useUserProfileStore';
import { extractPreferencesFast } from './memory/preferenceCaptureMiddleware';

type VoiceFlavor =
  | 'neutral'
  | 'bro'
  | 'youth'
  | 'bavarian'
  | 'formal';

const hits: Record<VoiceFlavor, number> = {
  neutral: 0,
  bro: 0,
  youth: 0,
  bavarian: 0,
  formal: 0,
};

const APPLY_AFTER = 2;

function detectFlavor(t: string): VoiceFlavor {
  // Soft constraint: Negation der Anrede → kein bro-Mirroring
  const prefs = extractPreferencesFast(t);
  if (prefs.some((p) => p.kind === 'addressing' && p.negated)) {
    return 'neutral';
  }
  if (
    /\b(Sie|Ihnen|würden\s+Sie|könnten\s+Sie|hiermit|hiermit\s+möchte|sehr\s+geehrte)\b/u.test(
      t,
    )
  ) {
    return 'formal';
  }
  if (
    /\b(bro|bruder|digga|diggi|alter|ey\s+alter|wallah|yallah)\b/iu.test(t)
  ) {
    return 'bro';
  }
  if (
    /\b(oida|servus|pfiat|gell|ned|koa|i\s+mog|schau\s+mal|bazi|gsuffa)\b/iu.test(
      t,
    )
  ) {
    return 'bavarian';
  }
  if (
    /\b(krass|lol|haha|nice|lowkey|sus|cap|no\s+cap|slay|vibe|mood|shit|wtf|omg)\b/iu.test(
      t,
    ) ||
    /[!?]{2,}/.test(t)
  ) {
    return 'youth';
  }
  return 'neutral';
}

function flavorFact(flavor: VoiceFlavor): string | null {
  switch (flavor) {
    case 'bro':
      return (
        'Rede-Stil: locker street — Slang (bro/digga) nur extrem sparsam ' +
        'und nur wenn 100% natürlich, nie erzwungen. Kumpel-Ton behalten.'
      );
    case 'youth':
      return 'Rede-Stil: Jugendslang — spiegle Formulierungen (vibe, krass, nice), ohne Antwort länger zu machen.';
    case 'bavarian':
      return 'Rede-Stil: bayrisch/österreichisch angehaucht (servus, gell, oida) — leicht spiegeln, nicht übertreiben.';
    case 'formal':
      return 'Rede-Stil: förmlich / Beamten-Deutsch — Siezen, sachlich, keine Kumpel-Floskeln.';
    default:
      return null;
  }
}

/**
 * Beobachtet User-Äußerung. Persistiert nur Wortwahl-Stil, nie Antwortlänge.
 */
export async function observeUserQuestionStyle(text: string): Promise<void> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 3) return;
  if (/^(ja|nein|ok|okay|stopp|stop|weiter|danke)$/iu.test(t)) return;

  // Explizite Anrede-Prefs: Middleware hat Vorrang, kein Style-Override
  if (extractPreferencesFast(t).some((p) => p.kind === 'addressing')) {
    return;
  }

  const flavor = detectFlavor(t);
  if (flavor === 'neutral') return;
  hits[flavor] += 1;
  if (hits[flavor] < APPLY_AFTER) return;

  const fact = flavorFact(flavor);
  if (!fact) return;

  const profile = getCachedUserProfile();
  if (!profile) return;
  const facts = profile.learnedFacts ?? [];
  const already = facts.some((f) =>
    f.toLowerCase().includes(fact.slice(0, 24).toLowerCase()),
  );
  if (already) return;

  const cleaned = facts.filter((f) => !/^Rede-Stil:/i.test(f));
  try {
    await useUserProfileStore.getState().patchProfile({
      learnedFacts: [...cleaned, fact].slice(-24),
    });
  } catch (err) {
    console.warn('[questionStyle] persist failed:', err);
  }
}

/** Prompt: nur Formulierungen spiegeln — Länge nicht ändern. Soft Slang. */
export function questionStylePromptHint(): string {
  const p = getCachedUserProfile();
  const facts = (p?.learnedFacts ?? []).filter(
    (f) => /^Rede-Stil:/i.test(f) || /^Anrede:/i.test(f),
  );
  const lines: string[] = [
    '=== NUTZER-WORTWAHL (SOFT) ===',
    '- Spiegle Formulierungen natürlich (bayrisch→leicht bayrisch, förmlich→Siezen).',
    '- Slang (Bro, Digga, Dicker) nur extrem sparsam, nie erzwungen, nur wenn 100% natürlich.',
    '- KEINE harten Verbote („Sag niemals Bro“) — bleib Kumpel-Ton, sparsam mit Slang.',
    '- Wenn unsicher zur Anrede: charmant fragen („Hey, wie soll ich dich eigentlich am liebsten nennen?“).',
    '- AntwortLÄNGE nicht ändern wegen Stil — gleich knackig wie sonst.',
  ];
  for (const f of facts.slice(-3)) {
    lines.push(`- ${f}`);
  }
  return lines.join('\n');
}
