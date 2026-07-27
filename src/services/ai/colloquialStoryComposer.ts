/**
 * Offline Colloquial Story Composer — ohne Cloud/Gemini.
 * Baut aus gefilterten Fakten EINE zusammenhängende Vorlese-Story:
 * umgangssprachlich, persönlich (du/dein/Name), Hook-Auflösung, kein Fakt-Dump.
 */

import type { UserProfile } from '../../types/userProfile';
import { createDefaultProfile } from '../../types/userProfile';
import { getCachedUserProfile } from '../userProfileService';
import {
  resolvePersonalEngagement,
  resolvePromptStyleSettings,
  resolveStorytellingControls,
  type FindusPersonality,
} from './promptBuilder';
import type { FindusStoryBrief } from './findusTourDirector';

export type ComposerCoreFacts = {
  intro: string;
  origin: string;
  now: string;
  highlight: string;
  explore: string;
  poiName: string;
};

export type ComposeColloquialStoryInput = {
  facts: ComposerCoreFacts;
  hookSentence: string;
  /** Bereits gesprochene Einführung — wird nicht wiederholt */
  firstBodySentence?: string;
  profile?: UserProfile | null;
  tourBrief?: FindusStoryBrief | null;
};

const HOLLOW_RE =
  /(ganz anders erleben|anders erleben als|ganz erleben als|erleben als (früher|vorher)|kann man es .*erleben|gehört zum alltag|zum dorfleben|teil des alltags|voller details.*übersieht)/i;

const LABEL_RE =
  /^(highlight|fun\s*facts?|funfakt|historie|heute|abschluss|quiz|intro|origin|now|explore|einführung|teaser|erzählung|narration|detail|kurzfakt)\s*:\s*/i;

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)] ?? list[0];
}

function cleanFact(raw: string): string {
  return raw
    .replace(/^[-*•\d.)\]]+\s*/u, '')
    .replace(LABEL_RE, '')
    .replace(/^\[([^\]]+)\]\s*/u, '')
    .replace(/^["„“]|["„“]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBlob(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function echoes(candidate: string, spoken: string[]): boolean {
  const c = normalizeBlob(candidate);
  if (c.length < 12) return false;
  for (const s of spoken) {
    const n = normalizeBlob(s);
    if (!n) continue;
    if (c === n) return true;
    const cWords = c.split(' ').filter((w) => w.length > 3);
    const nWords = n.split(' ').filter((w) => w.length > 3);
    if (cWords.length >= 5 && nWords.length >= 5) {
      const nJoined = ` ${nWords.join(' ')} `;
      for (let i = 0; i <= cWords.length - 5; i++) {
        if (nJoined.includes(` ${cWords.slice(i, i + 5).join(' ')} `)) {
          return true;
        }
      }
    }
    if (n.includes(c) || c.includes(n)) {
      const shorter = Math.min(c.length, n.length);
      const longer = Math.max(c.length, n.length);
      if (shorter >= 16 && shorter / longer >= 0.45) return true;
    }
  }
  return false;
}

function softenLead(fact: string): string {
  let t = cleanFact(fact);
  if (!t) return '';
  // Steife Amtsanfänge etwas menschlicher
  t = t.replace(/^(Das |Die |Der )/, (m) => m.toLowerCase());
  if (/^[a-zäöü]/.test(t)) {
    t = t.charAt(0).toUpperCase() + t.slice(1);
  }
  return t;
}

function withName(
  name: string | null,
  withNameFn: (n: string) => string,
  without: string,
): string {
  return name ? withNameFn(name) : without;
}

/**
 * Haupteinstieg: liefert Sätze für TTS (ohne bereits gesprochenen Hook).
 */
export function composeColloquialStory(
  input: ComposeColloquialStoryInput,
): string[] {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const personal = resolvePersonalEngagement(profile);
  const controls = resolveStorytellingControls(profile);
  const style = resolvePromptStyleSettings(profile);
  const name = personal.firstName;
  const poi = input.facts.poiName || 'dieser Ort';

  const facts = mergeBriefFacts(input.facts, input.tourBrief);
  const spoken = [
    input.hookSentence,
    input.firstBodySentence ?? '',
    facts.intro,
  ]
    .map(cleanFact)
    .filter(Boolean);

  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const s = cleanFact(raw ?? '');
    if (!s || s.length < 8) return;
    if (HOLLOW_RE.test(s)) return;
    // Abgeschnittene Fragmente / Roboter-Outros verwerfen
    if (
      /(keine fragen mehr|alles gesehen hast und keine fragen|lass uns gerne zusammen weitergehen)/i.test(
        s,
      )
    ) {
      return;
    }
    if (
      !/[.!?…]$/.test(s) &&
      /\b(auf den ersten|ehrlich gesagt|sieht das auf)\b/i.test(s)
    ) {
      return;
    }
    if (echoes(s, [...spoken, ...out])) return;
    out.push(s);
  };

  // 1) Hook sofort einlösen (wenn Intro noch nicht die Auflösung war)
  push(
    buildHookResolution({
      hook: input.hookSentence,
      intro: facts.intro,
      poiName: poi,
      name,
      firstBody: input.firstBodySentence,
      personality: style.personality,
    }),
  );

  // 2) Persönliche Du-Brücke
  push(buildPersonalBeat(poi, input.hookSentence, name, style.personality));

  // 3) Damals / Anfang
  if (facts.origin) {
    push(wrapOrigin(facts.origin, name, style.personality));
  }

  // 4) Heute (nur neuer Stoff)
  if (facts.now) {
    push(wrapNow(facts.now, name, style.personality));
  }

  // 5) Fun / Quiz
  if (controls.quizMode) {
    push(wrapQuiz(facts, [...spoken, ...out], name));
  } else if (controls.funFactsEnabled && facts.highlight) {
    push(wrapFun(facts.highlight, name, style.personality));
  } else if (facts.highlight) {
    push(wrapFun(facts.highlight, name, style.personality));
  }

  // 6) Handlung / Einladung
  push(
    wrapAction(facts.explore || facts.highlight, poi, name, style.personality),
  );

  // Mindestens 2 Body-Sätze
  if (out.length < 2) {
    push(
      withName(
        name,
        (n) =>
          `${n}, komm — lass uns ${poi} einmal in Ruhe anschauen, ich bleib bei dir.`,
        `Komm, lass uns ${poi} einmal in Ruhe anschauen — ich bleib bei dir.`,
      ),
    );
  }

  return out;
}

function mergeBriefFacts(
  base: ComposerCoreFacts,
  brief?: FindusStoryBrief | null,
): ComposerCoreFacts {
  if (!brief) return base;
  const join = (xs: string[]) =>
    xs.map(cleanFact).filter(Boolean).filter((t) => !HOLLOW_RE.test(t));
  const origin = join([...brief.beats.origin, ...brief.beats.story]).join(' ');
  const now = join(brief.beats.now).join(' ');
  const highlight = join(brief.beats.fun).join(' ');
  const explore = join(brief.beats.action).join(' ');
  return {
    ...base,
    origin: origin || base.origin,
    now: now || base.now,
    highlight: highlight || base.highlight,
    explore: explore || base.explore,
    poiName: brief.poiName || base.poiName,
  };
}

function buildHookResolution(input: {
  hook: string;
  intro: string;
  poiName: string;
  name: string | null;
  firstBody?: string;
  personality: FindusPersonality;
}): string | null {
  const hook = input.hook.trim();
  const intro = softenLead(input.intro);
  if (!hook) return intro || null;

  // firstBody hat die Auflösung oft schon geliefert
  if (input.firstBody?.trim()) {
    const fb = cleanFact(input.firstBody);
    if (fb && intro && echoes(intro, [fb])) return null;
    // Nur nachschieben, wenn Intro noch echten Mehrwert hat
    if (intro && !echoes(intro, [fb, hook])) {
      return pick([
        `Und genau das steckt dahinter: ${intro}`,
        `Pass auf — ${intro}`,
        withName(
          input.name,
          (n) => `${n}, kurz gesagt: ${intro}`,
          `Kurz gesagt: ${intro}`,
        ),
      ]);
    }
    return null;
  }

  const h = hook.toLowerCase();
  const body = intro || `Vor dir liegt ${input.poiName} — mehr als der erste Blick verrät.`;

  if (/pollen|allergie/i.test(h)) {
    return pick([
      withName(
        input.name,
        (n) =>
          `Ob Allergie oder nicht, ${n}: hier vor dir wächst’s ordentlich — ${body}`,
        `Ob Allergie oder nicht: hier vor dir wächst’s ordentlich — ${body}`,
      ),
      `Für deine Nase wird’s hier spannend — ${body}`,
    ]);
  }
  if (/baumschule|gärtnerei|gaertnerei/i.test(h)) {
    return `Genau, wir stehen mitten in dem Grün: ${body}`;
  }
  if (/abschlag|handicap|green|golf/i.test(h)) {
    return `Dann bist du hier genau richtig: ${body}`;
  }
  if (/einsteigen|tüt|bahnhof|gleis/i.test(h)) {
    return `Genau, wir sind am ${input.poiName}: ${body}`;
  }
  if (
    /badehose|erfrisch/i.test(h) &&
    !/(ehrenmal|denkmal|gedenk|krieger)/i.test(
      `${h} ${input.poiName}`.toLowerCase(),
    )
  ) {
    return `Keine Sorge, wir bleiben erstmal trocken — ${body}`;
  }
  if (/aperol|drink|kaffee|lust auf/i.test(h)) {
    return `Passt — wir sind am richtigen Spot: ${body}`;
  }
  if (/warum|wieso|weshalb/i.test(h)) {
    return `Die Antwort steckt direkt hier: ${body}`;
  }
  if (/mauern|pst|skandal|ehrenmal|gedenk/i.test(h)) {
    return body;
  }

  return pick([
    body,
    withName(
      input.name,
      (n) => `${n}, schau — ${body}`,
      `Schau — ${body}`,
    ),
  ]);
}

function buildPersonalBeat(
  poiName: string,
  hook: string,
  name: string | null,
  personality: FindusPersonality,
): string {
  const blob = `${poiName} ${hook}`.toLowerCase();
  const hey = name ? `${name}, ` : '';
  const casual =
    personality === 'gen_z' ||
    personality === 'default' ||
    personality === 'erzaehler' ||
    personality === 'party';

  if (/(pollen|allergie|baumschule|gärtnerei|natur|wald|wiese|park)/i.test(blob)) {
    return pick([
      `${hey}sag mal — hast du eine Pollenallergie? Und warst du schon mal in einer Baumschule? Hier vor dir blüht’s echt — passt das für deine Nase?`,
      `${hey}riechst du das auch? Für deine Nase wird’s hier interessant.`,
      withName(
        name,
        (n) => `${n}, warst du schon mal an so einem Grün-Spot — oder ist das neu für dich?`,
        `Warst du schon mal an so einem Grün-Spot — oder ist das neu für dich?`,
      ),
    ]);
  }
  if (/(bahnhof|gleis|zug|haltepunkt)/i.test(blob)) {
    return `${hey}warst du hier schon mal umsteigen — oder ist das dein erster Stopp am ${poiName}?`;
  }
  if (/(golf|fairway|green|abschlag)/i.test(blob)) {
    return `${hey}ist Golf dein Ding, oder schaust du dir die Greens nur an?`;
  }
  if (/(kirche|dom|kapelle)/i.test(blob)) {
    return `${hey}bist du eher Kirchen-Mensch, oder ziehst du eher an sowas vorbei?`;
  }
  if (/(museum|galerie)/i.test(blob)) {
    return `${hey}magst du Museen — oder brauchst du erst den richtigen Köder?`;
  }
  if (/(café|cafe|kaffee|bäck)/i.test(blob)) {
    return `${hey}Kaffee für dich — oder eher Tee-Fraktion?`;
  }
  if (/(see|fluss|strand|hafen|wasser|bade)/i.test(blob)) {
    return `${hey}hättest du jetzt spontan Lust, deine Schuhe auszuziehen?`;
  }

  if (casual) {
    return pick([
      `${hey}schau mal genau hin — was fällt dir als Erstes auf?`,
      `${hey}echt jetzt: was denkst du, wenn du das hier siehst?`,
      withName(
        name,
        (n) => `Hey ${n}, bleib kurz stehen — das hier lohnt den Blick.`,
        `Bleib kurz stehen — das hier lohnt den Blick.`,
      ),
    ]);
  }

  return `${hey}schau mal genau hin — was fällt dir als Erstes auf?`;
}

function wrapOrigin(
  origin: string,
  name: string | null,
  personality: FindusPersonality,
): string {
  const fact = softenLead(origin);
  if (!fact) return '';
  const leads =
    personality === 'historiker'
      ? [
          `Früher fing das so an: ${fact}`,
          `Der Anfang sieht so aus: ${fact}`,
          `Damals war das der Startpunkt: ${fact}`,
        ]
      : [
          `Damals fing’s so an: ${fact}`,
          `Weißt du, wie das losging? ${fact}`,
          withName(
            name,
            (n) => `${n}, kurz zurückgespult: ${fact}`,
            `Kurz zurückgespult: ${fact}`,
          ),
          `Und wie das alles anfing: ${fact}`,
        ];
  return pick(leads);
}

function wrapNow(
  now: string,
  name: string | null,
  personality: FindusPersonality,
): string {
  const fact = softenLead(now);
  if (!fact) return '';
  if (/^heute/i.test(fact)) return fact;
  const leads =
    personality === 'prinzessin'
      ? [
          `Und heute? ${fact}`,
          `Wenn du jetzt hinschaust: ${fact}`,
        ]
      : [
          `Und heute? ${fact}`,
          `Wenn du jetzt hinschaust: ${fact}`,
          withName(
            name,
            (n) => `${n}, und was draus geworden ist: ${fact}`,
            `Und was draus geworden ist: ${fact}`,
          ),
          `Heute siehst du das so: ${fact}`,
        ];
  return pick(leads);
}

function wrapFun(
  highlight: string,
  name: string | null,
  _personality: FindusPersonality,
): string {
  const fact = softenLead(highlight);
  if (!fact) return '';
  if (/^(und |weißt|kennst|rate)/i.test(fact)) return fact;
  return pick([
    `Und weißt du was? ${fact}`,
    withName(
      name,
      (n) => `${n}, das hier ist richtig gut: ${fact}`,
      `Das hier ist richtig gut: ${fact}`,
    ),
    // Vollständigen Satz — nie „Ehrlich gesagt —“ an Fragment hängen
    fact.length > 40 && /[.!?]$/.test(fact)
      ? `Ehrlich gesagt: ${fact}`
      : `Und das Spannende: ${fact}`,
    `Das Lustige daran: ${fact}`,
  ]);
}

function wrapQuiz(
  facts: ComposerCoreFacts,
  already: string[],
  name: string | null,
): string {
  const pool = [facts.highlight, facts.explore, facts.now, facts.origin]
    .map(softenLead)
    .filter((t) => t && !echoes(t, already) && !HOLLOW_RE.test(t));
  if (pool.length === 0) return '';
  const answer = pool[0];
  const blob = `${facts.poiName} ${answer}`.toLowerCase();
  let q: string;
  if (/(güter|gueter|gleis|bahn)/i.test(blob)) {
    q = 'Rate mal — wozu hat das hier früher wirklich gedient?';
  } else if (/(gebaut|entstand|jahr)/i.test(answer)) {
    q = 'Wann ist das hier eigentlich entstanden — hast du eine Idee?';
  } else if (/(pflanzen|baum|natur|pollen)/i.test(blob)) {
    q = withName(
      name,
      (n) => `${n}, kleine Schätzfrage: Was wächst hier wohl am liebsten?`,
      'Kleine Schätzfrage: Was wächst hier wohl am liebsten?',
    );
  } else {
    q = withName(
      name,
      (n) => `${n}, rate mal, was hier früher wirklich abging?`,
      'Rate mal, was hier früher wirklich abging?',
    );
  }
  return `${q} ${answer}`;
}

function wrapAction(
  explore: string,
  poiName: string,
  name: string | null,
  _personality: FindusPersonality,
): string {
  const e = softenLead(explore);
  const hey = name ? `${name}, ` : '';

  if (!e || HOLLOW_RE.test(e)) {
    return pick([
      `${hey}genieß den Moment kurz — und wenn du soweit bist, schlendern wir entspannt weiter.`,
      `${hey}geh ruhig ein paar Schritte näher ran, ich erzähl dir weiter.`,
      withName(
        name,
        (n) => `${n}, nimm dir ruhig noch kurz die Zeit — dann ziehen wir weiter.`,
        `Nimm dir ruhig noch kurz die Zeit — dann ziehen wir weiter.`,
      ),
    ]);
  }
  if (/(allee|weg|meter)/i.test(e)) {
    return `${hey}willst du kurz dahinlaufen? ${e}`;
  }
  if (/(bahnsteig|zugang|gleis|eingang|fassade)/i.test(e)) {
    return `${hey}schau dir das mal ganz genau an: ${e}`;
  }
  if (/(clubhaus|restaurant|biergarten|hotel|rein|hinein)/i.test(e)) {
    return `${hey}lust reinzuschauen? ${e}`;
  }
  return pick([
    `${hey}komm, lass uns das konkret ansehen: ${e}`,
    `${hey}hier noch für dich: ${e}`,
    withName(
      name,
      (n) => `${n}, dein Blick dahin: ${e}`,
      `Dein Blick dahin: ${e}`,
    ),
  ]);
}

/**
 * Kurzer Single-Shot Prompt für lokales Llama (wenn Modellpfad gesetzt).
 * Composer bleibt Fallback.
 */
export function buildColloquialSingleShotPrompt(input: {
  facts: ComposerCoreFacts;
  hookSentence: string;
  firstBodySentence?: string;
  profile?: UserProfile | null;
  tourBrief?: FindusStoryBrief | null;
}): string {
  const profile =
    input.profile ?? getCachedUserProfile() ?? createDefaultProfile();
  const personal = resolvePersonalEngagement(profile);
  const style = resolvePromptStyleSettings(profile);
  const name = personal.firstName;
  const facts = mergeBriefFacts(input.facts, input.tourBrief);

  return `Du bist Findus — bester Freund, zeigst deine Stadt. Schreibe EINE zusammenhängende Vorlese-Story (4–7 kurze Sätze), umgangssprachlich, einladend.
Kein Audioguide. Keine Labels. Keine Fakt-Liste. Jeder Fakt nur einmal.
Rede mit „du / dein / deine"${name ? ` und nutze den Namen „${name}“ 1–2×` : ''}.
Hook wurde schon gesagt — nicht wiederholen, aber einlösen.
Keine erfundenen Fakten. Keine Adressen. Kein „ganz anders erleben als früher“.

Persona: ${style.personalityLabel}

Bereits gesprochen:
Hook: „${input.hookSentence}"
${input.firstBodySentence ? `Intro: „${input.firstBodySentence}"` : ''}

Stoff (nur das):
ORT: ${facts.poiName}
INTRO: ${facts.intro}
ORIGIN: ${facts.origin}
NOW: ${facts.now}
FUN: ${facts.highlight}
ACTION: ${facts.explore}

Schreibe jetzt nur den fließenden Text (keine Meta-Kommentare):`;
}
